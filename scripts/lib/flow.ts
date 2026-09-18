// The PRD 8.4 end-to-end flow on one SealedDAO, shared by the testnet run and the anvil dry run:
// fund the treasury, propose "pay 1 USDC to member 3", three sealed votes (For, For, Against, like mainnet proof 1),
// wait for the close round, reveal every vote with the SDK (unsealProposal + revealBatch, sent by member 2), wait for
// the end of the 24 h reveal window, finalize, execute, then member 3 claims the payout and member 2 the bounty.
//
// Idempotent: every step first looks at the state file and then at the chain, so a re-run skips what is done,
// resumes a transaction that was sent but not confirmed, and never sends the same action twice.
import {
  type BeaconSource,
  type Choice,
  claim,
  execute,
  finalize,
  getProposal,
  getSealedLogs,
  getStatus,
  type Logger,
  listProposals,
  type Proposal,
  propose,
  REVEAL_WINDOW,
  REVEALED_COMMITMENT,
  readClaimable,
  readCommitmentOf,
  readRevealBounty,
  readRevealOpen,
  readSealingOpen,
  readTotalClaimable,
  roundTime,
  sealAndVote,
  vote,
  waitForSuccess,
} from '@arcseal/sdk';
import {
  type Account,
  type Address,
  type Chain,
  erc20Abi,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from 'viem';
import type { Clock } from './clock.js';
import { formatDuration, formatTime } from './clock.js';
import { ARC_MAINNET_ID, ARC_TESTNET_ID, txUrl } from './config.js';
import { feeInUsdcBaseUnits, formatInt, formatUsdc } from './format.js';
import { describeBounty, planReveal, revealOutcome, sendRevealBatch } from './reveal.js';
import type { RunState, StateStore } from './state.js';

export type MemberIndex = 1 | 2 | 3;
export type Wallet = WalletClient<Transport, Chain, Account>;

/** Mainnet proof 1 of PRD 10.2: For, For, Against. It passes (2 > 1) with every member sealed. */
export const VOTES: readonly { member: MemberIndex; choice: Choice }[] = [
  { member: 1, choice: 'for' },
  { member: 2, choice: 'for' },
  { member: 3, choice: 'against' },
];
/** Sends revealBatch (credited the reveal bounty: the demo proposal meets quorum), finalize and execute. */
export const REVEALER: MemberIndex = 2;
/** Payout target: "Pay 1 USDC to WALLET_C". */
export const PAYEE: MemberIndex = 3;

const ZERO32 = `0x${'0'.repeat(64)}`;

export interface FlowContext {
  chainId: number;
  client: PublicClient;
  explorer: string;
  dao: Address;
  usdc: Address;
  /** Wallet of member 1..3; the testnet run decrypts each keystore on first use. */
  signer: (member: MemberIndex) => Promise<Wallet>;
  clock: Clock;
  /** Close-round beacon for unsealProposal (committed offline, or fetched from drand). */
  beaconSource: BeaconSource;
  votingSeconds: number;
  /** TransferUSDC amount in USDC base units (6 decimals). */
  payout: bigint;
  store: StateStore;
  logger: Logger;
  say: (line: string) => void;
  /** Called whenever a transaction is sent or confirmed (the caller persists proofTxs). */
  onTx?: ((state: Readonly<RunState>) => void) | undefined;
  /** Dry run: the propose block gets this timestamp, so the close round has a committed beacon. */
  proposeAt?: number | undefined;
  /** Dry run: the close round the propose transaction must produce. */
  expectedCloseRound?: bigint | undefined;
  /** Dry run: runs before funding (mints MockUSDC to member 1). */
  beforeFund?: ((runner: Runner) => Promise<void>) | undefined;
}

export interface Tally {
  sealed: number;
  revealed: number;
  for: number;
  against: number;
  abstain: number;
  memberSnapshot: number;
  passed: boolean;
}

export type FlowResult =
  | { status: 'done'; sent: number; proposalId: bigint; tally: Tally }
  | {
      status: 'paused';
      sent: number;
      proposalId: bigint;
      resumeAt: number;
      waitSeconds: number;
      what: string;
    }
  | { status: 'failed'; sent: number; reason: string };

/** Runs single transaction steps with resume and skip logic, and counts what it sends. */
export class Runner {
  sent = 0;

  constructor(readonly ctx: FlowContext) {}

  /**
   * One transaction step. Already confirmed: nothing. Sent but unconfirmed: wait for it, or forget it when it
   * reverted or vanished. Then `check` may skip the step (optionally recovering the hash of a transaction an
   * interrupted run sent), else `send` runs and the hash is saved before waiting for the receipt.
   */
  async tx(
    key: string,
    label: string,
    step: {
      check?: () => Promise<{ skip: string; hash?: Hash | undefined } | null>;
      send: () => Promise<Hash>;
    },
  ): Promise<TransactionReceipt | null> {
    const settled = await this.settle(key);
    if (settled !== undefined) return settled;
    const verdict = await step.check?.();
    if (verdict) {
      if (verdict.hash) {
        const receipt = await waitForSuccess(this.ctx.client, verdict.hash, label);
        this.confirm(key, label, receipt);
        return receipt;
      }
      this.ctx.say(`[skip] ${label}: ${verdict.skip}`);
      return null;
    }
    const hash = await step.send();
    this.sent++;
    this.ctx.store.update((d) => {
      d.txs[key] = { label, hash, status: 'pending' };
    });
    this.ctx.onTx?.(this.ctx.store.get());
    const receipt = await waitForSuccess(this.ctx.client, hash, label);
    this.confirm(key, label, receipt);
    return receipt;
  }

  /**
   * Resolves a recorded transaction: its receipt when it is (or becomes) confirmed, null when it was confirmed by an
   * earlier run, undefined when there is nothing recorded (or it reverted or vanished, and was forgotten).
   */
  async settle(key: string): Promise<TransactionReceipt | null | undefined> {
    const recorded = this.ctx.store.get().txs[key];
    if (!recorded) return undefined;
    if (recorded.status === 'success') {
      this.ctx.say(`[done] ${recorded.label} ${recorded.hash}`);
      return null;
    }
    const hash = recorded.hash as Hash;
    const receipt = await this.ctx.client
      .waitForTransactionReceipt({ hash, timeout: 60_000 })
      .catch(() => null);
    if (receipt?.status === 'success') {
      this.confirm(key, recorded.label, receipt);
      return receipt;
    }
    this.ctx.say(
      `[retry] ${recorded.label}: ${hash} ${receipt ? 'reverted' : 'was not mined'}; deciding again`,
    );
    this.ctx.store.update((d) => {
      delete d.txs[key];
    });
    return undefined;
  }

  /** Records a confirmed transaction and prints its hash, gas and (on Arc) fee in USDC. */
  confirm(key: string, label: string, receipt: TransactionReceipt): void {
    const onArc = this.ctx.chainId === ARC_MAINNET_ID || this.ctx.chainId === ARC_TESTNET_ID;
    const fee = feeInUsdcBaseUnits(receipt.gasUsed, receipt.effectiveGasPrice);
    this.ctx.store.update((d) => {
      d.txs[key] = {
        label,
        hash: receipt.transactionHash,
        status: 'success',
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        ...(onArc ? { costUsdc: fee.toString() } : {}),
      };
    });
    this.ctx.onTx?.(this.ctx.store.get());
    const url = txUrl(this.ctx.explorer, receipt.transactionHash);
    const cost = onArc ? `, fee ${formatUsdc(fee)}` : '';
    this.ctx.say(
      `[tx] ${label} ${receipt.transactionHash} (block ${receipt.blockNumber}, gas ${formatInt(receipt.gasUsed)}${cost})`,
    );
    if (url) this.ctx.say(`     ${url}`);
  }

  /** Address of member `m`; loads the signer and pins the address in the state (a keystore must not change). */
  async address(m: MemberIndex): Promise<Address> {
    const wallet = await this.ctx.signer(m);
    const address = wallet.account.address;
    const pinned = this.ctx.store.get().members[String(m)];
    if (pinned && pinned !== address) {
      throw new Error(`member ${m} now resolves to ${address}, but this run started with ${pinned}`);
    }
    if (!pinned) {
      this.ctx.store.update((d) => {
        d.members[String(m)] = address;
      });
    }
    return address;
  }
}

/** Runs (or resumes) the whole flow. Returns 'paused' when the next step is far in the future (testnet). */
export async function runTransferFlow(ctx: FlowContext): Promise<FlowResult> {
  const r = new Runner(ctx);
  const { client, dao, say } = ctx;
  const revealBounty = await readRevealBounty(client, { dao });

  // 1. Treasury: payout + one bounty per vote, as a plain USDC ERC-20 transfer from member 1.
  await ctx.beforeFund?.(r);
  const needed = ctx.payout + revealBounty * BigInt(VOTES.length);
  await r.tx('fundTreasury', 'fund treasury (member 1)', {
    check: async () => {
      if (ctx.store.get().proposal) return { skip: 'the proposal already exists' };
      const free = (await usdcBalance(ctx, dao)) - (await readTotalClaimable(client, { dao }));
      return free >= needed
        ? { skip: `free treasury ${formatUsdc(free)} already covers ${formatUsdc(needed)}` }
        : null;
    },
    send: async () => {
      const free = (await usdcBalance(ctx, dao)) - (await readTotalClaimable(client, { dao }));
      const amount = needed - (free > 0n ? free : 0n);
      const wallet = await ctx.signer(1);
      const balance = await usdcBalance(ctx, wallet.account.address);
      if (balance < amount) {
        throw new Error(
          `member 1 (${wallet.account.address}) holds ${formatUsdc(balance)}, needs ${formatUsdc(amount)} to fund the treasury`,
        );
      }
      say(`funding the treasury with ${formatUsdc(amount)} (payout ${formatUsdc(ctx.payout)} + 3 bounties)`);
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: ctx.usdc,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [dao, amount],
      });
      return wallet.writeContract(request);
    },
  });

  // 2. Propose. The description carries the run tag, so an interrupted propose is found again instead of repeated.
  const proposal = await proposeStep(r);
  const id = BigInt(proposal.id);
  const closeRound = BigInt(proposal.closeRound);
  const revealEndRound = BigInt(proposal.revealEndRound);
  say(
    `proposal ${id}: voting closes at drand round ${closeRound} (${formatTime(roundTime(closeRound))}); ` +
      `reveals are accepted until round ${revealEndRound} (${formatTime(roundTime(revealEndRound))})`,
  );

  // 3. Three sealed votes. The ballot (salt, choice, ciphertext) is saved before the transaction exists.
  for (const { member, choice } of VOTES) {
    await r.tx(`transferVotes.${member}`, `vote member ${member} (${choice}, sealed)`, {
      check: async () => {
        const voter = await r.address(member);
        const onchain = await readCommitmentOf(client, { dao, proposalId: id, voter });
        if (onchain !== ZERO32) {
          const logs = await getSealedLogs(client, {
            dao,
            proposalId: id,
            fromBlock: BigInt(proposal.block),
          });
          const hash = logs.find((l) => l.voter === voter)?.transactionHash;
          return { skip: `member ${member} already sealed`, hash };
        }
        if (!(await readSealingOpen(client, { dao, proposalId: id }))) {
          return { skip: `sealing closed before member ${member} voted` };
        }
        return null;
      },
      send: async () => {
        const wallet = await ctx.signer(member);
        const saved = ctx.store.get().ballots[String(member)];
        if (saved) {
          return vote(wallet, {
            dao,
            proposalId: id,
            commitment: saved.commitment as Hex,
            ciphertext: saved.ciphertext as Hex,
          });
        }
        const sent = await sealAndVote(wallet, {
          dao,
          proposalId: id,
          choice,
          closeRound,
          onSealed: (b) => {
            ctx.store.update((d) => {
              d.ballots[String(member)] = {
                voter: b.voter,
                choice: b.choice,
                salt: b.salt,
                commitment: b.commitment,
                ciphertext: b.ciphertext,
                closeRound: b.closeRound.toString(),
              };
            });
          },
        });
        return sent.hash;
      },
    });
  }

  // 4. Wait for the close round (10 minutes after propose by default).
  const closeAt = roundTime(closeRound);
  const closed = await ctx.clock.waitUntil(closeAt, `the close round ${closeRound}`);
  if (!closed.ready) return paused(r, id, closed.resumeAt, `the close round ${closeRound}`);

  // 5. Reveal: decrypt every sealed vote with the close-round beacon and send revealBatch from member 2.
  await revealStep(r, id, BigInt(proposal.block));

  // 6. Wait for the end of the 24 h reveal window (PRD D5: finalize only after it).
  const endAt = roundTime(revealEndRound);
  const ended = await ctx.clock.waitUntil(endAt, 'the end of the 24 h reveal window');
  if (!ended.ready) return paused(r, id, ended.resumeAt, 'the end of the 24 h reveal window');

  // 7. Finalize and execute (anyone may; member 2 sends them).
  await r.tx('transferFinalize', 'finalize', {
    check: async () =>
      (await getProposal(client, { dao, proposalId: id })).finalized ? { skip: 'already finalized' } : null,
    send: async () => finalize(await ctx.signer(REVEALER), { dao, proposalId: id }),
  });
  const final = await getProposal(client, { dao, proposalId: id });
  const tally = tallyOf(final);
  say(
    `tally: ${tally.for} for, ${tally.against} against, ${tally.abstain} abstain; ${tally.revealed} revealed of ` +
      `${tally.sealed} sealed; ${final.memberSnapshot} members at proposal time -> ${tally.passed ? 'PASSED' : 'FAILED'}`,
  );
  if (!final.passed) return { status: 'failed', sent: r.sent, reason: 'the proposal did not pass' };

  await r.tx('transferExecute', 'execute (credits the payout to claimable)', {
    check: async () => {
      const status = await getStatus(client, { dao, proposalId: id });
      if (status === 'Executed') return { skip: 'already executed' };
      if (status === 'Expired')
        throw new Error('the proposal expired: execute is allowed for 7 days after the window');
      return null;
    },
    send: async () => execute(await ctx.signer(REVEALER), { dao, proposalId: id }),
  });

  // 8. Pull payments (D13): the payee and the revealer claim.
  const payee = proposal.target as Address;
  await claimStep(r, 'transferClaim', `claim payout (member ${PAYEE}, payee)`, PAYEE, payee);
  await claimStep(r, 'transferBountyClaim', `claim bounty (member ${REVEALER}, revealer)`, REVEALER);

  if (!ctx.store.get().completedAt) {
    ctx.store.update((d) => {
      d.completedAt = new Date().toISOString();
    });
  }
  return { status: 'done', sent: r.sent, proposalId: id, tally };
}

async function proposeStep(r: Runner): Promise<NonNullable<RunState['proposal']>> {
  const { ctx } = r;
  const { client, dao, store } = ctx;
  const existing = store.get().proposal;
  if (existing) {
    ctx.say(
      `[done] propose: proposal ${existing.id} (${store.get().txs.transferPropose?.hash ?? 'hash unknown'})`,
    );
    return existing;
  }
  const { runTag, proposeFromBlock } = store.get();
  if (proposeFromBlock) {
    const { proposals } = await listProposals(client, { dao, fromBlock: BigInt(proposeFromBlock) });
    const found = proposals.find((p) => p.description.includes(runTag));
    if (found) {
      ctx.say(`[recover] propose: found proposal ${found.id} sent by an interrupted run`);
      r.confirm('transferPropose', 'propose', await waitForSuccess(client, found.transactionHash, 'propose'));
      return saveProposal(r, found.id, found.closeRound, found.blockNumber, found.target, found.amount);
    }
  }

  const payee = await r.address(PAYEE);
  const proposer = await ctx.signer(1);
  await r.address(1);
  const block = await client.getBlockNumber();
  store.update((d) => {
    d.proposeFromBlock = block.toString();
  });
  if (ctx.proposeAt !== undefined) await ctx.clock.pinNextBlock?.(ctx.proposeAt);
  const created = await propose(proposer, {
    dao,
    kind: 'TransferUSDC',
    target: payee,
    amount: ctx.payout,
    flag: false,
    description: `ArcSeal e2e ${runTag}: pay ${formatUsdc(ctx.payout)} to member ${PAYEE}`,
    descriptionURI: '',
    votingSeconds: ctx.votingSeconds,
  });
  r.sent++;
  r.confirm('transferPropose', 'propose (TransferUSDC to member 3)', created.receipt);
  if (ctx.expectedCloseRound !== undefined && created.closeRound !== ctx.expectedCloseRound) {
    throw new Error(`close round ${created.closeRound}, expected ${ctx.expectedCloseRound}`);
  }
  return saveProposal(
    r,
    created.proposalId,
    created.closeRound,
    created.receipt.blockNumber,
    payee,
    ctx.payout,
  );
}

function saveProposal(
  r: Runner,
  id: bigint,
  closeRound: bigint,
  block: bigint,
  target: Address,
  amount: bigint,
): NonNullable<RunState['proposal']> {
  const proposal = {
    id: id.toString(),
    closeRound: closeRound.toString(),
    revealEndRound: (closeRound + REVEAL_WINDOW).toString(),
    block: block.toString(),
    target,
    amount: amount.toString(),
  };
  r.ctx.store.update((d) => {
    d.proposal = proposal;
  });
  return proposal;
}

async function revealStep(r: Runner, id: bigint, fromBlock: bigint): Promise<void> {
  const { ctx } = r;
  const { client, dao, say } = ctx;
  // Settle reveal transactions an interrupted run left pending.
  const keys = Object.keys(ctx.store.get().txs).filter((k) => k.startsWith('transferRevealBatch.'));
  for (const key of keys) await r.settle(key);

  const voters = Object.values(ctx.store.get().members);
  const live = [];
  for (const voter of voters) {
    const c = await readCommitmentOf(client, { dao, proposalId: id, voter });
    if (c !== ZERO32 && c !== REVEALED_COMMITMENT) live.push(voter);
  }
  if (live.length === 0) {
    say('[skip] revealBatch: no sealed vote left to reveal');
    return;
  }
  if (!(await readRevealOpen(client, { dao, proposalId: id }))) {
    say(
      `[skip] revealBatch: the reveal window is closed; ${live.length} unrevealed vote(s) count as abstentions`,
    );
    return;
  }

  say('decrypting the sealed votes (unsealProposal: Sealed logs + close-round beacon)');
  const plan = await planReveal({
    client,
    dao,
    proposalId: id,
    fromBlock,
    beaconSource: ctx.beaconSource,
    logger: ctx.logger,
  });
  say(
    `decrypted ${plan.unsealed.items.length} vote(s)` +
      (plan.unsealed.skipReasons.length
        ? `, skipped ${plan.unsealed.skipReasons.map((s) => `${s.voter} (${s.reason})`).join(', ')}`
        : '') +
      ` [correlationId ${plan.unsealed.correlationId}]`,
  );
  let next = keys.length;
  for (const batch of plan.batches) {
    const key = `transferRevealBatch.${next++}`;
    const receipt = await r.tx(key, `revealBatch ${batch.voters.length} vote(s) (member ${REVEALER})`, {
      send: async () => sendRevealBatch(await ctx.signer(REVEALER), { dao, proposalId: id, batch }),
    });
    if (receipt) {
      const out = revealOutcome(receipt);
      say(
        `     revealed ${out.revealed}, skipped ${out.skipped.length}, ` +
          describeBounty(out, formatUsdc, 'to the revealer'),
      );
    }
  }
}

async function claimStep(r: Runner, key: string, label: string, member: MemberIndex, known?: Address) {
  const { client, dao } = r.ctx;
  await r.tx(key, label, {
    check: async () => {
      const account = known ?? (await r.address(member));
      const amount = await readClaimable(client, { dao, account });
      return amount === 0n ? { skip: 'nothing to claim' } : null;
    },
    send: async () => claim(await r.ctx.signer(member), { dao }),
  });
}

async function paused(r: Runner, id: bigint, resumeAt: number, what: string): Promise<FlowResult> {
  const waitSeconds = Math.max(0, resumeAt - (await r.ctx.clock.chainNow()));
  r.ctx.say(
    `[pause] ${what} is at ${formatTime(resumeAt)} (in ${formatDuration(waitSeconds)} of chain time)`,
  );
  return { status: 'paused', sent: r.sent, proposalId: id, resumeAt, waitSeconds, what };
}

function tallyOf(p: Proposal): Tally {
  return {
    sealed: p.sealedCount,
    revealed: p.revealedCount,
    for: p.forCount,
    against: p.againstCount,
    abstain: p.abstainCount,
    memberSnapshot: p.memberSnapshot,
    passed: p.passed,
  };
}

/** USDC ERC-20 view balance (6 decimals) of `account`. */
export function usdcBalance(ctx: Pick<FlowContext, 'client' | 'usdc'>, account: Address): Promise<bigint> {
  return ctx.client.readContract({
    address: ctx.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  });
}
