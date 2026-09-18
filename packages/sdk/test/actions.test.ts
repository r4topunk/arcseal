import {
  type Address,
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
  parseAbi,
  toHex,
} from 'viem';
import { foundry } from 'viem/chains';
import { describe, expect, it, vi } from 'vitest';
import {
  ContractRevertError,
  GAS_MARGIN_PERCENT,
  InvalidBeaconError,
  InvalidInputError,
  MAX_DESCRIPTION_URI_BYTES,
  ProposalNotFoundError,
  proposeInputSchema,
  REVEALED_COMMITMENT,
  revealBatch,
  sealedDaoAbi,
  toContractRevertError,
  unsealProposal,
  vote,
  WalletRequiredError,
  withGasMargin,
} from '../src/index.js';
import { beaconFor } from './fixtures.js';

const DAO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MEMBER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const errorAbi = parseAbi(['error Error(string)', 'error Panic(uint256)']);

/** What viem throws for a reverted readContract / simulateContract carrying `data`. */
function revertWith(data: Hex) {
  const cause = new ContractFunctionRevertedError({ abi: sealedDaoAbi, data, functionName: 'vote' });
  return new ContractFunctionExecutionError(cause, {
    abi: sealedDaoAbi,
    functionName: 'vote',
    args: [1n, toHex(1, { size: 32 }), '0x'],
  });
}

describe('toContractRevertError', () => {
  it('decodes SealedDAO custom errors, including those inherited from Sealed', () => {
    for (const errorName of [
      'SealingClosed',
      'NotMember',
      'BadCiphertextLength',
      'UnknownProposal',
    ] as const) {
      const err = toContractRevertError(
        revertWith(encodeErrorResult({ abi: sealedDaoAbi, errorName })),
        'vote',
      );
      expect(err).toBeInstanceOf(ContractRevertError);
      expect(err).toMatchObject({ code: 'CONTRACT_REVERT', functionName: 'vote', errorName, args: [] });
    }
  });

  it('decodes Error(string) (a USDC blocklist revert) and Panic(uint256)', () => {
    const blocked = encodeErrorResult({
      abi: errorAbi,
      errorName: 'Error',
      args: ['Blacklistable: account is blacklisted'],
    });
    expect(toContractRevertError(revertWith(blocked), 'claim')).toMatchObject({
      errorName: 'Error',
      args: ['Blacklistable: account is blacklisted'],
    });
    const panic = encodeErrorResult({ abi: errorAbi, errorName: 'Panic', args: [0x11n] });
    expect(toContractRevertError(revertWith(panic), 'propose')).toMatchObject({
      errorName: 'Panic',
      args: [0x11n],
    });
  });

  it('reports unknown selectors and empty revert data as Unknown, and keeps the viem error as cause', () => {
    const unknown = toContractRevertError(revertWith('0xdeadbeef'), 'vote') as ContractRevertError;
    expect(unknown.errorName).toBe('Unknown');
    expect(unknown.args).toEqual(['0xdeadbeef']);
    expect(unknown.cause).toBeInstanceOf(BaseError);
    expect(toContractRevertError(revertWith('0x'), 'vote')).toMatchObject({ errorName: 'Unknown', args: [] });
  });

  it('returns non-revert errors unchanged', () => {
    const network = new Error('fetch failed');
    expect(toContractRevertError(network, 'vote')).toBe(network);
    const rpc = new BaseError('user rejected');
    expect(toContractRevertError(rpc, 'vote')).toBe(rpc);
    const own = new WalletRequiredError('vote');
    expect(toContractRevertError(own, 'vote')).toBe(own);
  });
});

describe('write action validation (before any RPC call)', () => {
  const request = vi.fn(async () => {
    throw new Error('no RPC call expected');
  });
  const client = createWalletClient({ account: MEMBER, chain: foundry, transport: custom({ request }) });
  const salt = toHex(1, { size: 32 });

  it('propose params mirror the contract checks', () => {
    const base = {
      dao: DAO,
      kind: 'TransferUSDC',
      target: MEMBER,
      amount: 1n,
      description: 'x',
      votingSeconds: 600,
    } as const;
    expect(proposeInputSchema.parse(base)).toMatchObject({ flag: false, descriptionURI: '', amount: 1n });
    expect(proposeInputSchema.safeParse({ ...base, amount: 0n }).success).toBe(false); // BadAmount
    expect(proposeInputSchema.safeParse({ ...base, kind: 'SetMember', amount: 0n, flag: true }).success).toBe(
      true,
    );
    expect(proposeInputSchema.safeParse({ ...base, target: `0x${'00'.repeat(20)}` }).success).toBe(false); // BadTarget
    expect(proposeInputSchema.safeParse({ ...base, votingSeconds: 599 }).success).toBe(false); // BadDuration
    expect(proposeInputSchema.safeParse({ ...base, votingSeconds: 604_801 }).success).toBe(false);
    // DescriptionTooLong counts UTF-8 bytes: 128 two-byte characters fit, 129 do not.
    expect(proposeInputSchema.safeParse({ ...base, description: 'é'.repeat(128) }).success).toBe(true);
    expect(proposeInputSchema.safeParse({ ...base, description: 'é'.repeat(129) }).success).toBe(false);
    // BadTarget also covers the DAO itself (audit F6); the address is compared after checksumming.
    expect(proposeInputSchema.safeParse({ ...base, target: DAO.toLowerCase() }).success).toBe(false);
    expect(
      proposeInputSchema.safeParse({ ...base, kind: 'SetMember', target: DAO, flag: true }).success,
    ).toBe(false);
    // DescriptionURITooLong (audit F8): 2,048 UTF-8 bytes fit, one more does not.
    expect(MAX_DESCRIPTION_URI_BYTES).toBe(2_048);
    const uri = (bytes: number) => `https://${'a'.repeat(bytes - 8)}`;
    expect(proposeInputSchema.safeParse({ ...base, descriptionURI: uri(2_048) }).success).toBe(true);
    expect(proposeInputSchema.safeParse({ ...base, descriptionURI: uri(2_049) }).success).toBe(false);
    expect(
      proposeInputSchema.safeParse({ ...base, descriptionURI: `https://${'é'.repeat(1_021)}` }).success,
    ).toBe(false);
  });

  it('local accounts get a 20% gas margin over the estimate, rounded up', () => {
    expect(GAS_MARGIN_PERCENT).toBe(20n);
    expect(withGasMargin(175_108n)).toBe(210_130n); // ceil(175,108 * 1.2)
    expect(withGasMargin(100_000n)).toBe(120_000n);
    // the propose delta that audit F4 measured (70 gas) is far inside the margin
    expect(withGasMargin(175_108n)).toBeGreaterThan(175_178n);
  });

  it('vote and revealBatch refuse malformed arguments without touching the RPC', async () => {
    await expect(
      vote(client, { dao: DAO, proposalId: 1n, commitment: '0x12', ciphertext: `0x${'11'.repeat(423)}` }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(
      vote(client, { dao: DAO, proposalId: 1n, commitment: salt, ciphertext: `0x${'11'.repeat(1025)}` }),
    ).rejects.toThrow(/359\.\.1024 bytes, got 1025/);
    await expect(
      revealBatch(client, { dao: DAO, proposalId: 1n, voters: [MEMBER], choices: [1, 2], salts: [salt] }),
    ).rejects.toThrow(/same length/);
    const many: Address[] = Array.from({ length: 257 }, () => MEMBER);
    await expect(
      revealBatch(client, {
        dao: DAO,
        proposalId: 1n,
        voters: many,
        choices: many.map(() => 1 as const),
        salts: many.map(() => salt),
      }),
    ).rejects.toThrow(/at most 256 items/);
    expect(request).not.toHaveBeenCalled();
  });

  it('writes need an account', async () => {
    const readOnly = createWalletClient({ chain: foundry, transport: custom({ request }) });
    await expect(
      vote(readOnly, { dao: DAO, proposalId: 1n, commitment: salt, ciphertext: `0x${'11'.repeat(423)}` }),
    ).rejects.toBeInstanceOf(WalletRequiredError);
    expect(request).not.toHaveBeenCalled();
  });
});

/** `proposal(1)` return data: a TransferUSDC proposal closing at round 32,000,000. */
const proposalResult = encodeFunctionResult({
  abi: sealedDaoAbi,
  functionName: 'proposal',
  result: {
    proposer: MEMBER,
    kind: 0,
    target: MEMBER,
    amount: 1n,
    flag: false,
    description: 'd',
    descriptionURI: '',
    closeRound: 32_000_000n,
    revealEndRound: 32_028_800n,
    memberSnapshot: 3,
    sealedCount: 0,
    revealedCount: 0,
    forCount: 0,
    againstCount: 0,
    abstainCount: 0,
    finalized: false,
    passed: false,
    executed: false,
  },
});

describe('unsealProposal (mocked RPC)', () => {
  it('throws ProposalNotFoundError for an id that was never proposed, and fetches no beacon', async () => {
    // proposal(99) of an unknown id returns the all-zero struct: closeRound == 0.
    const zeroProposal = `0x${'00'.repeat(31)}20${'00'.repeat(32 * 20)}` as Hex;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_call') return zeroProposal;
      throw new Error(`unexpected ${method}`);
    });
    const client = createPublicClient({ chain: foundry, transport: custom({ request }) });
    const beaconSource = vi.fn();
    await expect(unsealProposal({ client, dao: DAO, proposalId: 99n, beaconSource })).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
    expect(beaconSource).not.toHaveBeenCalled();
  });

  it('returns no items and fetches no beacon when nobody sealed', async () => {
    const ranges: unknown[] = [];
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_call') return proposalResult;
      if (method === 'eth_blockNumber') return toHex(25_000);
      if (method === 'eth_getLogs') {
        ranges.push((params as [{ fromBlock: Hex; toBlock: Hex }])[0]);
        return [];
      }
      throw new Error(`unexpected ${method}`);
    });
    const client = createPublicClient({ chain: foundry, transport: custom({ request }) });
    const beaconSource = vi.fn();
    const result = await unsealProposal({
      client,
      dao: DAO,
      proposalId: 1n,
      fromBlock: 5_000n,
      beaconSource,
    });
    expect(result).toMatchObject({ items: [], skipped: [], skipReasons: [], closeRound: 32_000_000n });
    expect(beaconSource).not.toHaveBeenCalled();
    expect(ranges).toMatchObject([
      { fromBlock: toHex(5_000), toBlock: toHex(14_998) },
      { fromBlock: toHex(14_999), toBlock: toHex(24_997) },
      { fromBlock: toHex(24_998), toBlock: toHex(25_000) },
    ]);
  });

  it('refuses a beacon for another round or with a bad signature before decrypting anything', async () => {
    const sealedLog = {
      address: DAO,
      topics: encodeEventTopics({
        abi: sealedDaoAbi,
        eventName: 'Sealed',
        args: { groupId: 1n, sealer: MEMBER },
      }),
      data: encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes' }],
        [toHex(9, { size: 32 }), `0x${'11'.repeat(423)}`],
      ),
      blockNumber: toHex(10),
      blockHash: toHex(1, { size: 32 }),
      transactionHash: toHex(2, { size: 32 }),
      transactionIndex: '0x0',
      logIndex: '0x0',
      removed: false,
    };
    const client = createPublicClient({
      chain: foundry,
      transport: custom({
        async request({ method }: { method: string }) {
          if (method === 'eth_call') return proposalResult;
          if (method === 'eth_blockNumber') return toHex(20);
          if (method === 'eth_getLogs') return [sealedLog];
          throw new Error(`unexpected ${method}`);
        },
      }),
    });
    const other = beaconFor(31_415_926n);
    await expect(
      unsealProposal({ client, dao: DAO, proposalId: 1n, beaconSource: other }),
    ).rejects.toMatchObject({
      code: 'INVALID_BEACON',
      message: expect.stringMatching(/close round is 32000000/),
    });
    // The signature of round 31,415,926 presented as the close round's: fails the BLS check.
    const forged = { round: 32_000_000n, signature: other.signature };
    await expect(
      unsealProposal({ client, dao: DAO, proposalId: 1n, beaconSource: async () => forged }),
    ).rejects.toBeInstanceOf(InvalidBeaconError);
  });

  it('exports the REVEALED sentinel of Sealed.sol', () => {
    expect(REVEALED_COMMITMENT).toBe(toHex(1, { size: 32 }));
  });
});
