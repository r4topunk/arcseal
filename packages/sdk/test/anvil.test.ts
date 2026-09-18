/**
 * End-to-end on a throwaway local anvil (PRD 8.2): MockUSDC + SealedDAO from the Foundry artifacts, 5 members, one
 * proposal, 5 sealed votes (one garbage ciphertext) spread over > 20,000 blocks, unsealProposal, revealBatch, tally,
 * finalize, execute and claim. Offline: anvil starts in the past so that the proposal's close round is a round whose
 * quicknet beacon is committed in packages/tlock/test/vectors/beacons.json. Reads go through a transport that refuses
 * eth_getLogs ranges above 10,000 blocks, like Arc's public RPC. Skipped only when the anvil binary is missing.
 */
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  getAddress,
  type Hex,
  http,
  type PublicClient,
  parseEventLogs,
  type TestClient,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildRevealBatch,
  ContractRevertError,
  claim,
  createLogger,
  execute,
  finalize,
  getProposal,
  getStatus,
  hashVote,
  InvalidInputError,
  listProposals,
  ProposalNotFoundError,
  propose,
  REVEAL_WINDOW,
  readClaimable,
  readCommitmentOf,
  readHashVote,
  readIsMember,
  readMemberCount,
  readProposalCount,
  readQuorumBps,
  readRevealBounty,
  readRevealOpen,
  readSealingOpen,
  readTotalClaimable,
  readUsdc,
  revealBatch,
  roundTime,
  type SealedBallot,
  sealAndVote,
  sealedDaoAbi,
  sealedDaoBytecode,
  type UnsealProposalResult,
  unsealProposal,
  vote,
  WalletRequiredError,
  waitForSuccess,
  withGasMargin,
} from '../src/index.js';
import { beaconFor } from './fixtures.js';
import { anvilAvailable, foundryArtifact, startAnvil } from './helpers/anvil.js';

// The proposal closes at a round whose beacon is committed, so the whole flow runs without drand.
const CLOSE_ROUND = 32_000_000n;
const VOTING_SECONDS = 86_400; // one day: room for the > 20,000 one-second blocks mined between votes
const PROPOSE_AT = roundTime(CLOSE_ROUND) - VOTING_SECONDS; // roundAfter(PROPOSE_AT + VOTING_SECONDS) = CLOSE_ROUND
const QUORUM_BPS = 5_000;
const BOUNTY = 10_000n; // 0.01 USDC per revealed vote
const PAYOUT = 1_000_000n; // 1 USDC
const ARC_GETLOGS_CAP = 10_000n;

const title = anvilAvailable
  ? 'SealedDAO flow on local anvil'
  : 'SealedDAO flow on local anvil (skipped: the `anvil` binary is not on PATH; install Foundry)';

describe.skipIf(!anvilAvailable)(title, () => {
  let stop: (() => Promise<void>) | undefined;
  let url: string;
  let publicClient: PublicClient;
  let test: TestClient;
  let accounts: Address[];
  let members: Address[];
  let revealer: Address;
  let payee: Address;
  let usdc: Address;
  let usdcAbi: ReturnType<typeof foundryArtifact>['abi'];
  let dao: Address;
  let deployBlock: bigint;
  let proposalId: bigint;
  const ballots: SealedBallot[] = [];
  const getLogsRanges: { from: bigint; to: bigint }[] = [];
  let unsealed: UnsealProposalResult;

  const wallet = (account: Address) =>
    createWalletClient({ account, chain: foundry, transport: http(url), pollingInterval: 50 });
  const mineAt = async (timestamp: number) => {
    await test.setNextBlockTimestamp({ timestamp: BigInt(timestamp) });
    await test.mine({ blocks: 1 });
  };
  const usdcBalance = (account: Address) =>
    publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [account] });

  beforeAll(async () => {
    const usdcArtifact = foundryArtifact('MockUSDC.sol', 'MockUSDC');
    usdcAbi = usdcArtifact.abi;
    ({ url, stop } = await startAnvil({ timestamp: PROPOSE_AT - 3_600 }));
    // Reads go through a transport that enforces Arc's eth_getLogs cap and records every range asked for.
    const rpc = http(url)({ chain: foundry, retryCount: 0 });
    publicClient = createPublicClient({
      chain: foundry,
      pollingInterval: 50,
      transport: custom({
        async request({ method, params }) {
          if (method === 'eth_getLogs') {
            const [filter] = params as [{ fromBlock: Hex; toBlock: Hex }];
            const range = { from: BigInt(filter.fromBlock), to: BigInt(filter.toBlock) };
            if (range.to - range.from + 1n > ARC_GETLOGS_CAP)
              throw new Error('eth_getLogs range above 10,000 blocks');
            getLogsRanges.push(range);
          }
          return rpc.request({ method, params });
        },
      }),
    });
    test = createTestClient({ chain: foundry, mode: 'anvil', transport: http(url) });
    accounts = await createWalletClient({ chain: foundry, transport: http(url) }).getAddresses();
    members = accounts.slice(0, 5);
    revealer = accounts[5]!;
    payee = accounts[6]!;

    const deployer = wallet(accounts[0]!);
    const h1 = await deployer.deployContract({ abi: usdcAbi, bytecode: usdcArtifact.bytecode });
    usdc = getAddress((await waitForSuccess(publicClient, h1)).contractAddress!);
    const h2 = await deployer.deployContract({
      abi: sealedDaoAbi,
      bytecode: sealedDaoBytecode,
      args: [usdc, members, QUORUM_BPS, BOUNTY],
    });
    const deployed = await waitForSuccess(publicClient, h2);
    dao = getAddress(deployed.contractAddress!);
    deployBlock = deployed.blockNumber;
    const h3 = await deployer.writeContract({
      address: usdc,
      abi: usdcAbi,
      functionName: 'mint',
      args: [dao, 2n * PAYOUT],
    });
    await waitForSuccess(publicClient, h3);
  }, 60_000);

  afterAll(async () => {
    await stop?.();
  });

  it('reads the deployment parameters', async () => {
    expect(await readMemberCount(publicClient, { dao })).toBe(5);
    expect(await readQuorumBps(publicClient, { dao })).toBe(QUORUM_BPS);
    expect(await readRevealBounty(publicClient, { dao })).toBe(BOUNTY);
    expect(await readUsdc(publicClient, { dao })).toBe(usdc);
    expect(await readProposalCount(publicClient, { dao })).toBe(0n);
    expect(await readTotalClaimable(publicClient, { dao })).toBe(0n);
    expect(await readIsMember(publicClient, { dao, account: members[4]! })).toBe(true);
    expect(await readIsMember(publicClient, { dao, account: revealer })).toBe(false);
    expect((await listProposals(publicClient, { dao, fromBlock: deployBlock })).proposals).toEqual([]);
  });

  it('propose: validated client-side, NotMember decoded, then id 1 closing at the committed round', async () => {
    const params = {
      dao,
      kind: 'TransferUSDC',
      target: payee,
      amount: PAYOUT,
      description: 'Pay 1 USDC to the payee',
      votingSeconds: VOTING_SECONDS,
    } as const;
    await expect(propose(wallet(members[0]!), { ...params, amount: 0n })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(propose(wallet(revealer), params)).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'NotMember',
    );

    await test.setNextBlockTimestamp({ timestamp: BigInt(PROPOSE_AT) });
    const created = await propose(wallet(members[0]!), params);
    proposalId = created.proposalId;
    expect(proposalId).toBe(1n);
    expect(created.closeRound).toBe(CLOSE_ROUND);

    const p = await getProposal(publicClient, { dao, proposalId });
    expect(p).toMatchObject({
      id: 1n,
      proposer: members[0],
      kind: 'TransferUSDC',
      target: payee,
      amount: PAYOUT,
      closeRound: CLOSE_ROUND,
      revealEndRound: CLOSE_ROUND + REVEAL_WINDOW,
      memberSnapshot: 5,
      sealedCount: 0,
      finalized: false,
    });
    expect(await getStatus(publicClient, { dao, proposalId })).toBe('Voting');
    expect(await readSealingOpen(publicClient, { dao, proposalId })).toBe(true);

    const listed = await listProposals(publicClient, { dao, fromBlock: deployBlock });
    expect(listed.proposals.map((x) => [x.id, x.kind, x.closeRound, x.description])).toEqual([
      [1n, 'TransferUSDC', CLOSE_ROUND, 'Pay 1 USDC to the payee'],
    ]);
    const again = await listProposals(publicClient, { dao, fromBlock: listed.nextFromBlock });
    expect(again.proposals).toEqual([]);
  });

  it('five sealed votes over > 20,000 blocks, one with a garbage ciphertext', async () => {
    // A caller-supplied closeRound that is not the proposal's is refused before sealing or sending (audit F10).
    const wrongRound = vi.fn();
    for (const closeRound of [CLOSE_ROUND - 1n, CLOSE_ROUND + 1n]) {
      await expect(
        sealAndVote(wallet(members[0]!), {
          dao,
          proposalId,
          choice: 'for',
          closeRound,
          onSealed: wrongRound,
        }),
      ).rejects.toThrow(/does not match proposal 1's close round 32000000/);
    }
    expect(wrongRound).not.toHaveBeenCalled();
    expect(await readCommitmentOf(publicClient, { dao, proposalId, voter: members[0]! })).toBe(
      toHex(0, { size: 32 }),
    );

    const choices = ['for', 'for', 'against', 'abstain'] as const;
    const onSealed = vi.fn(async (ballot: SealedBallot) => {
      // The receipt callback runs before the vote transaction exists.
      expect(await readCommitmentOf(publicClient, { dao, proposalId, voter: ballot.voter })).toBe(
        toHex(0, { size: 32 }),
      );
    });
    for (const [i, choice] of choices.entries()) {
      if (i === 1 || i === 2) await test.mine({ blocks: 10_500, interval: 1 });
      const ballot = await sealAndVote(wallet(members[i]!), { dao, proposalId, choice, onSealed });
      await waitForSuccess(publicClient, ballot.hash, 'vote');
      expect(ballot).toMatchObject({ proposalId, voter: members[i], choice, closeRound: CLOSE_ROUND });
      expect(ballot.ciphertext).toHaveLength(2 + 423 * 2);
      ballots.push(ballot);
    }
    expect(onSealed).toHaveBeenCalledTimes(4);

    // Member 5 posts 423 random bytes: the right length, but not a tlock ciphertext.
    const garbage = toHex(crypto.getRandomValues(new Uint8Array(423)));
    const hash = await vote(wallet(members[4]!), {
      dao,
      proposalId,
      commitment: toHex(crypto.getRandomValues(new Uint8Array(32))),
      ciphertext: garbage,
    });
    await waitForSuccess(publicClient, hash, 'vote');

    const b0 = ballots[0]!;
    expect(await readCommitmentOf(publicClient, { dao, proposalId, voter: members[0]! })).toBe(b0.commitment);
    expect(
      await readHashVote(publicClient, { dao, proposalId, voter: members[0]!, choice: 'for', salt: b0.salt }),
    ).toBe(hashVote({ proposalId, voter: members[0]!, choice: 'for', salt: b0.salt }));
    await expect(sealAndVote(wallet(members[0]!), { dao, proposalId, choice: 'against' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'AlreadySealed',
    );
    expect((await getProposal(publicClient, { dao, proposalId })).sealedCount).toBe(5);
    const latest = await publicClient.getBlock();
    expect(latest.number - deployBlock).toBeGreaterThan(20_000n);
    expect(Number(latest.timestamp)).toBeLessThan(roundTime(CLOSE_ROUND));
  });

  it('unsealProposal: 4 votes decrypted, the garbage one skipped, logs found across >= 3 windows', async () => {
    await mineAt(roundTime(CLOSE_ROUND));
    expect(await getStatus(publicClient, { dao, proposalId })).toBe('Revealing');
    expect(await readRevealOpen(publicClient, { dao, proposalId })).toBe(true);

    const windows: { fromBlock: bigint; toBlock: bigint; logs: number }[] = [];
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: { write: (l: string) => void lines.push(JSON.parse(l)) },
    });
    const beaconSource = vi.fn(async (round: bigint) => beaconFor(round));
    getLogsRanges.length = 0;

    unsealed = await unsealProposal({
      client: publicClient,
      dao,
      proposalId,
      fromBlock: deployBlock,
      beaconSource,
      logger,
      onWindow: (w) => windows.push(w),
    });

    expect(beaconSource).toHaveBeenCalledTimes(1);
    expect(beaconSource).toHaveBeenCalledWith(CLOSE_ROUND);
    expect(unsealed.closeRound).toBe(CLOSE_ROUND);
    expect(unsealed.items.map((x) => [x.voter, x.choice, x.salt, x.commitment])).toEqual(
      ballots.map((b) => [b.voter, b.choice, b.salt, b.commitment]),
    );
    expect(unsealed.skipped).toEqual([members[4]]);
    expect(unsealed.skipReasons).toEqual([{ voter: members[4], reason: 'undecryptable' }]);

    // Cursor: windows of at most 9,999 blocks, and the 5 Sealed logs sit in at least 3 different windows.
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const w of windows) expect(w.toBlock - w.fromBlock + 1n).toBeLessThanOrEqual(9_999n);
    expect(windows.filter((w) => w.logs > 0).length).toBeGreaterThanOrEqual(3);
    expect(windows.reduce((n, w) => n + w.logs, 0)).toBe(5);
    expect(getLogsRanges.length).toBe(windows.length);
    expect(windows[0]!.fromBlock).toBe(deployBlock);
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.fromBlock).toBe(windows[i - 1]!.toBlock + 1n);

    // Every log line of the call carries the same correlation id.
    expect(lines.length).toBeGreaterThan(3);
    expect(new Set(lines.map((l) => l.correlationId))).toEqual(new Set([unsealed.correlationId]));
    expect(lines.map((l) => l.msg)).toEqual(
      expect.arrayContaining(['unseal start', 'vote skipped', 'unseal done']),
    );
  });

  it('revealBatch reveals the 4 votes in one transaction; the tally matches and the bounty is credited', async () => {
    const batches = buildRevealBatch(unsealed.items);
    expect(batches).toHaveLength(1);
    const hash = await revealBatch(wallet(revealer), { dao, proposalId, ...batches[0]! });
    const receipt = await waitForSuccess(publicClient, hash, 'revealBatch');
    const events = parseEventLogs({ abi: sealedDaoAbi, logs: receipt.logs });
    expect(events.filter((e) => e.eventName === 'VoteRevealed')).toHaveLength(4);
    expect(events.filter((e) => e.eventName === 'RevealSkipped')).toHaveLength(0);
    expect(events.find((e) => e.eventName === 'BountyCredited')?.args).toMatchObject({ amount: 4n * BOUNTY });

    expect(await getProposal(publicClient, { dao, proposalId })).toMatchObject({
      sealedCount: 5,
      revealedCount: 4,
      forCount: 2,
      againstCount: 1,
      abstainCount: 1,
    });
    expect(await readClaimable(publicClient, { dao, account: revealer })).toBe(4n * BOUNTY);
    expect(await readTotalClaimable(publicClient, { dao })).toBe(4n * BOUNTY);

    // A replayed item and a guessed item for the garbage voter are skipped onchain, never reverted.
    const [replay] = buildRevealBatch([
      unsealed.items[0]!,
      { voter: members[4]!, choice: 'for', salt: toHex(7, { size: 32 }) },
    ]);
    const skipped = await waitForSuccess(
      publicClient,
      await revealBatch(wallet(revealer), { dao, proposalId, ...replay! }),
    );
    const skippedEvents = parseEventLogs({
      abi: sealedDaoAbi,
      logs: skipped.logs,
      eventName: 'RevealSkipped',
    });
    expect(skippedEvents.map((e) => e.args.voter)).toEqual([members[0], members[4]]);

    // Unsealing again finds nothing left to reveal: the sentinel marks the 4 votes as already revealed.
    const again = await unsealProposal({
      client: publicClient,
      dao,
      proposalId,
      fromBlock: deployBlock,
      beaconSource: beaconFor(CLOSE_ROUND),
    });
    expect(again.items).toEqual([]);
    expect(again.skipReasons.map((s) => s.reason)).toEqual([
      'already-revealed',
      'already-revealed',
      'already-revealed',
      'already-revealed',
      'undecryptable',
    ]);
  });

  it('finalize after the reveal window, execute, then claim (blocklist revert decoded, balance kept)', async () => {
    await expect(finalize(wallet(revealer), { dao, proposalId })).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'NotReady',
    );
    await mineAt(roundTime(CLOSE_ROUND + REVEAL_WINDOW));
    expect(await getStatus(publicClient, { dao, proposalId })).toBe('Ready');

    // A local account (a key signing in-process) sends the node's estimate plus the 20% margin (audit F4); a
    // JSON-RPC account like the others here leaves gas to the node or wallet.
    const local = privateKeyToAccount(generatePrivateKey());
    await test.setBalance({ address: local.address, value: 10n ** 18n });
    const localWallet = createWalletClient({
      account: local,
      chain: foundry,
      transport: http(url),
      pollingInterval: 50,
    });
    const estimate = await publicClient.estimateContractGas({
      address: dao,
      abi: sealedDaoAbi,
      functionName: 'finalize',
      args: [proposalId],
      account: local.address,
    });
    const finalized = await finalize(localWallet, { dao, proposalId });
    await waitForSuccess(publicClient, finalized);
    expect((await publicClient.getTransaction({ hash: finalized })).gas).toBe(withGasMargin(estimate));
    expect(await getStatus(publicClient, { dao, proposalId })).toBe('Passed');
    expect(await getProposal(publicClient, { dao, proposalId })).toMatchObject({
      finalized: true,
      passed: true,
    });

    await waitForSuccess(publicClient, await execute(wallet(revealer), { dao, proposalId }));
    expect(await getStatus(publicClient, { dao, proposalId })).toBe('Executed');
    expect(await readClaimable(publicClient, { dao, account: payee })).toBe(PAYOUT);

    await waitForSuccess(publicClient, await claim(wallet(payee), { dao }));
    expect(await usdcBalance(payee)).toBe(PAYOUT);
    expect(await readClaimable(publicClient, { dao, account: payee })).toBe(0n);
    await expect(claim(wallet(payee), { dao })).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'NothingToClaim',
    );

    // FiatToken-style blocklist: the revert string is decoded and the bounty stays claimable.
    const deployer = wallet(accounts[0]!);
    const block = (value: boolean) =>
      deployer
        .writeContract({ address: usdc, abi: usdcAbi, functionName: 'blacklist', args: [revealer, value] })
        .then((h) => waitForSuccess(publicClient, h));
    await block(true);
    const blocked = await claim(wallet(revealer), { dao }).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(ContractRevertError);
    expect(blocked).toMatchObject({ errorName: 'Error', args: ['Blacklistable: account is blacklisted'] });
    expect(await readClaimable(publicClient, { dao, account: revealer })).toBe(4n * BOUNTY);
    await block(false);
    await waitForSuccess(publicClient, await claim(wallet(revealer), { dao }));
    expect(await usdcBalance(revealer)).toBe(4n * BOUNTY);
    expect(await readTotalClaimable(publicClient, { dao })).toBe(0n);
  });

  it('decodes the remaining errors into typed SDK errors', async () => {
    await expect(getProposal(publicClient, { dao, proposalId: 99n })).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
    await expect(getStatus(publicClient, { dao, proposalId: 99n })).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'UnknownProposal',
    );
    await expect(sealAndVote(wallet(members[0]!), { dao, proposalId, choice: 'for' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'SealingClosed',
    );
    await expect(execute(wallet(revealer), { dao, proposalId })).rejects.toSatisfy(
      (e: unknown) => e instanceof ContractRevertError && e.errorName === 'AlreadyExecuted',
    );
    await expect(claim(publicClient, { dao })).rejects.toBeInstanceOf(WalletRequiredError);
    await expect(
      vote(wallet(members[0]!), {
        dao,
        proposalId,
        commitment: toHex(1, { size: 32 }),
        ciphertext: '0x1234',
      }),
    ).rejects.toThrow(/ciphertext must be 359\.\.1024 bytes/);
  });
});
