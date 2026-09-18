// viem actions for SealedDAO (PRD 5): one read or write per contract function, plus getProposal, getStatus,
// listProposals and sealAndVote. Every action takes a viem Client first (public, wallet or wagmi's), like viem's own
// actions. Writes are simulated before they are sent, so most reverts surface as a typed ContractRevertError before
// anything is sent; the web app maps `errorName` to a sentence. A transaction can still revert onchain when the state
// changes between the simulation and inclusion, which `waitForSuccess` reports as TransactionRevertedError.
import {
  type Abi,
  type Account,
  type Address,
  BaseError,
  type Chain,
  type Client,
  type ContractErrorName,
  ContractFunctionRevertedError,
  decodeErrorResult,
  getAbiItem,
  type Hash,
  type Hex,
  parseEventLogs,
  type TransactionReceipt,
  type Transport,
} from 'viem';
import {
  estimateContractGas,
  getBlockNumber,
  getLogs,
  readContract,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from 'viem/actions';
import { z } from 'zod';
import { sealedDaoAbi } from './abi/SealedDAO.js';
import {
  ArcSealError,
  ContractRevertError,
  EventNotFoundError,
  InvalidInputError,
  ProposalNotFoundError,
  TransactionRevertedError,
  WalletRequiredError,
} from './errors.js';
import { type OnWindow, scanWindows } from './logs.js';
import { MAX_VOTING, MIN_VOTING } from './round.js';
import {
  addressSchema,
  bytes32Schema,
  type Choice,
  choiceSchema,
  ciphertextSchema,
  parseInput,
  proposalIdSchema,
  roundSchema,
  saltSchema,
  uint256Schema,
} from './schemas.js';
import { type ChoiceIndex, choiceToIndex, type SealedVote, sealVote } from './seal.js';

/** Any viem client that can send JSON-RPC reads (public client, wallet client, wagmi client). */
export type ReadClient = Client<Transport, Chain | undefined, Account | undefined>;
/**
 * Client for writes: same type, but it must carry an account (`WalletRequiredError` otherwise) and its transport must
 * also answer eth_call (simulation) and receipt polling, which injected wallets and http transports do.
 */
export type WriteClient = ReadClient;

/** Proposal action kinds, in Solidity enum order. */
export const ACTION_KINDS = ['TransferUSDC', 'SetMember'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Derived proposal status (`SealedDAO.status`), in Solidity enum order. */
export const PROPOSAL_STATUSES = [
  'Voting',
  'Revealing',
  'Ready',
  'Passed',
  'Failed',
  'Executed',
  'Expired',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Custom error names of the SealedDAO ABI (including the inherited Sealed errors). Map these to UI sentences. */
export type SealedDaoErrorName = ContractErrorName<typeof sealedDaoAbi>;

/** `commitmentOf` returns this sentinel once a vote is revealed (`Sealed.REVEALED`, prevents a double reveal). */
export const REVEALED_COMMITMENT: Hex = '0x0000000000000000000000000000000000000000000000000000000000000001';

/** A proposal as `proposal(id)` returns it, with `kind` as a name and its `id` attached. */
export interface Proposal {
  id: bigint;
  proposer: Address;
  kind: ActionKind;
  target: Address;
  /** TransferUSDC amount in 6-decimal USDC units (ERC-20 view). */
  amount: bigint;
  /** SetMember: true adds `target`, false removes it. */
  flag: boolean;
  description: string;
  descriptionURI: string;
  closeRound: bigint;
  revealEndRound: bigint;
  memberSnapshot: number;
  sealedCount: number;
  revealedCount: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  finalized: boolean;
  passed: boolean;
  executed: boolean;
}

/** A `ProposalCreated` event, as `listProposals` returns it. */
export interface ProposalCreated {
  id: bigint;
  proposer: Address;
  kind: ActionKind;
  target: Address;
  amount: bigint;
  flag: boolean;
  closeRound: bigint;
  revealEndRound: bigint;
  memberSnapshot: number;
  description: string;
  descriptionURI: string;
  blockNumber: bigint;
  transactionHash: Hash;
}

const abi = sealedDaoAbi as Abi;
const sealedEvent = getAbiItem({ abi: sealedDaoAbi, name: 'Sealed' });
const proposalCreatedEvent = getAbiItem({ abi: sealedDaoAbi, name: 'ProposalCreated' });

const daoSchema = addressSchema;
const idParams = z.object({ dao: daoSchema, proposalId: proposalIdSchema });
const daoParams = z.object({ dao: daoSchema });

// ------------------------------------------------------------------------------------------------ error decoding

/**
 * Converts an error thrown by a viem contract read, simulation or write into a `ContractRevertError` when it is a
 * revert, decoding SealedDAO custom errors, `Error(string)` (for example a USDC blocklist message) and `Panic`.
 * Any other error (network, RPC, user rejection) is returned unchanged. Pass the result to `throw`.
 */
export function toContractRevertError(err: unknown, functionName: string): unknown {
  if (err instanceof ArcSealError || !(err instanceof BaseError)) return err;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return err;
  if (revert.data) {
    return new ContractRevertError(functionName, revert.data.errorName, revert.data.args ?? [], {
      cause: err,
    });
  }
  if (revert.raw && revert.raw !== '0x') {
    try {
      const decoded = decodeErrorResult({ abi, data: revert.raw });
      return new ContractRevertError(functionName, decoded.errorName, decoded.args ?? [], { cause: err });
    } catch {
      return new ContractRevertError(functionName, 'Unknown', [revert.raw], { cause: err });
    }
  }
  if (revert.reason) return new ContractRevertError(functionName, 'Error', [revert.reason], { cause: err });
  return new ContractRevertError(functionName, 'Unknown', [], { cause: err });
}

// ------------------------------------------------------------------------------------------------ internals

async function read<T>(
  client: ReadClient,
  dao: Address,
  functionName: string,
  args: readonly unknown[] = [],
) {
  try {
    return (await readContract(client, { address: dao, abi, functionName, args })) as T;
  } catch (err) {
    throw toContractRevertError(err, functionName);
  }
}

function requireAccount(client: WriteClient, action: string): Account {
  if (!client.account) throw new WalletRequiredError(action);
  return client.account;
}

/** Gas margin for local accounts, in percent of the node's estimate (the same 20 % as scripts/ and browser wallets). */
export const GAS_MARGIN_PERCENT = 20n;

/** `estimate` plus GAS_MARGIN_PERCENT, rounded up. Unused gas is not charged. */
export function withGasMargin(estimate: bigint): bigint {
  return (estimate * (100n + GAS_MARGIN_PERCENT) + 99n) / 100n;
}

/**
 * Simulates, then sends. For a local account (a key or keystore signing in-process) viem would send the node's exact
 * estimate as the gas limit, and a call whose gas depends on state that moves between estimate and inclusion (a
 * revealBatch that credits or skips the bounty, a window boundary) could then run out of gas although the
 * simulation passed. So local accounts send the estimate plus GAS_MARGIN_PERCENT. JSON-RPC accounts (browser wallets)
 * are left alone: the wallet estimates and adds its own margin.
 */
async function write(
  client: WriteClient,
  dao: Address,
  functionName: string,
  args: readonly unknown[],
): Promise<Hash> {
  const account = requireAccount(client, functionName);
  try {
    const { request } = await simulateContract(client, { address: dao, abi, functionName, args, account });
    const gas =
      account.type === 'local'
        ? withGasMargin(await estimateContractGas(client, { address: dao, abi, functionName, args, account }))
        : undefined;
    return await writeContract(client, {
      ...request,
      chain: client.chain ?? null,
      ...(gas === undefined ? {} : { gas }),
    });
  } catch (err) {
    throw toContractRevertError(err, functionName);
  }
}

/** Waits for a transaction and throws `TransactionRevertedError` unless it succeeded. */
export async function waitForSuccess(
  client: ReadClient,
  hash: Hash,
  functionName = 'transaction',
): Promise<TransactionReceipt> {
  const receipt = await waitForTransactionReceipt(client, { hash });
  if (receipt.status !== 'success') throw new TransactionRevertedError(functionName, hash);
  return receipt;
}

type RawProposal = Omit<Proposal, 'id' | 'kind'> & { kind: number };

// ABI decoding rejects enum values outside the Solidity enum, so the index lookups below always hit.
function toProposal(id: bigint, raw: RawProposal): Proposal {
  return { ...raw, id, kind: ACTION_KINDS[raw.kind]! };
}

async function latestBlock(client: ReadClient): Promise<bigint> {
  return getBlockNumber(client, { cacheTime: 0 });
}

// ------------------------------------------------------------------------------------------------ reads

/** `proposal(id)` as the contract returns it (kind as the enum index). Prefer `getProposal`. */
export async function readProposal(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number },
) {
  const { dao, proposalId } = parseInput(idParams, params, 'readProposal params');
  return read<RawProposal>(client, dao, 'proposal', [proposalId]);
}

/**
 * The proposal with `kind` as a name. Throws `ProposalNotFoundError` for an id that was never proposed
 * (every proposal has a non-zero close round).
 */
export async function getProposal(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number },
): Promise<Proposal> {
  const { dao, proposalId } = parseInput(idParams, params, 'getProposal params');
  const raw = await read<RawProposal>(client, dao, 'proposal', [proposalId]);
  if (raw.closeRound === 0n) throw new ProposalNotFoundError(proposalId);
  return toProposal(proposalId, raw);
}

/** `status(id)` as the Solidity enum index. Prefer `getStatus`. */
export async function readStatus(client: ReadClient, params: { dao: Address; proposalId: bigint | number }) {
  const { dao, proposalId } = parseInput(idParams, params, 'readStatus params');
  return read<number>(client, dao, 'status', [proposalId]);
}

/** Derived status of a proposal: 'Voting' | 'Revealing' | 'Ready' | 'Passed' | 'Failed' | 'Executed' | 'Expired'. */
export async function getStatus(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number },
): Promise<ProposalStatus> {
  const index = await readStatus(client, params);
  const status = PROPOSAL_STATUSES[index];
  if (!status) throw new ContractRevertError('status', 'Unknown', [index]);
  return status;
}

/** `commitmentOf(id, voter)`: zero if the voter did not seal, `REVEALED_COMMITMENT` once revealed. */
export async function readCommitmentOf(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number; voter: Address },
): Promise<Hex> {
  const p = parseInput(idParams.extend({ voter: addressSchema }), params, 'readCommitmentOf params');
  return read<Hex>(client, p.dao, 'commitmentOf', [p.proposalId, p.voter]);
}

/** `hashVote(id, voter, choice, salt)` computed by the contract. Equals the SDK's local `hashVote`. */
export async function readHashVote(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number; voter: Address; choice: Choice; salt: Hex },
): Promise<Hex> {
  const p = parseInput(
    idParams.extend({ voter: addressSchema, choice: choiceSchema, salt: saltSchema }),
    params,
    'readHashVote params',
  );
  return read<Hex>(client, p.dao, 'hashVote', [p.proposalId, p.voter, choiceToIndex(p.choice), p.salt]);
}

/** `isMember(account)`. */
export async function readIsMember(client: ReadClient, params: { dao: Address; account: Address }) {
  const p = parseInput(daoParams.extend({ account: addressSchema }), params, 'readIsMember params');
  return read<boolean>(client, p.dao, 'isMember', [p.account]);
}

/** `memberCount()`. */
export async function readMemberCount(client: ReadClient, params: { dao: Address }) {
  return read<number>(client, parseInput(daoParams, params, 'readMemberCount params').dao, 'memberCount');
}

/** `claimable(account)`: USDC (6 decimals) the account can pull with `claim`. */
export async function readClaimable(client: ReadClient, params: { dao: Address; account: Address }) {
  const p = parseInput(daoParams.extend({ account: addressSchema }), params, 'readClaimable params');
  return read<bigint>(client, p.dao, 'claimable', [p.account]);
}

/** `totalClaimable()`: USDC owed to all claimers; the free treasury is `usdc.balanceOf(dao) - totalClaimable`. */
export async function readTotalClaimable(client: ReadClient, params: { dao: Address }) {
  return read<bigint>(
    client,
    parseInput(daoParams, params, 'readTotalClaimable params').dao,
    'totalClaimable',
  );
}

/** `proposalCount()`: ids run from 1 to this value. */
export async function readProposalCount(client: ReadClient, params: { dao: Address }) {
  return read<bigint>(client, parseInput(daoParams, params, 'readProposalCount params').dao, 'proposalCount');
}

/** `usdc()`: the treasury token (Arc USDC at 0x3600…0000 on mainnet and testnet). */
export async function readUsdc(client: ReadClient, params: { dao: Address }) {
  return read<Address>(client, parseInput(daoParams, params, 'readUsdc params').dao, 'usdc');
}

/** `quorumBps()`: quorum over sealed votes, in basis points of the member snapshot. */
export async function readQuorumBps(client: ReadClient, params: { dao: Address }) {
  return read<number>(client, parseInput(daoParams, params, 'readQuorumBps params').dao, 'quorumBps');
}

/** `revealBounty()`: USDC (6 decimals) credited per validly revealed vote to the `revealBatch` sender. */
export async function readRevealBounty(client: ReadClient, params: { dao: Address }) {
  return read<bigint>(client, parseInput(daoParams, params, 'readRevealBounty params').dao, 'revealBounty');
}

/** `sealingOpen(id)`: true while `vote` is accepted (before `roundTime(closeRound)`). */
export async function readSealingOpen(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number },
) {
  const { dao, proposalId } = parseInput(idParams, params, 'readSealingOpen params');
  return read<boolean>(client, dao, 'sealingOpen', [proposalId]);
}

/** `revealOpen(id)`: true while `revealBatch` is accepted (24 h from the close round). */
export async function readRevealOpen(
  client: ReadClient,
  params: { dao: Address; proposalId: bigint | number },
) {
  const { dao, proposalId } = parseInput(idParams, params, 'readRevealOpen params');
  return read<boolean>(client, dao, 'revealOpen', [proposalId]);
}

/**
 * `ProposalCreated` events in [fromBlock, toBlock] (default: 0 to the latest block), read in windows of at most
 * 9,999 blocks. Pass the DAO deploy block as `fromBlock` the first time, then `nextFromBlock` to poll for new ones.
 */
export async function listProposals(
  client: ReadClient,
  params: {
    dao: Address;
    fromBlock?: bigint | undefined;
    toBlock?: bigint | undefined;
    windowSize?: bigint | undefined;
    onWindow?: OnWindow | undefined;
  },
): Promise<{ proposals: ProposalCreated[]; nextFromBlock: bigint }> {
  const dao = parseInput(daoSchema, params.dao, 'dao');
  const fromBlock = params.fromBlock ?? 0n;
  const toBlock = params.toBlock ?? (await latestBlock(client));
  const logs = await scanWindows(
    { fromBlock, toBlock, windowSize: params.windowSize, onWindow: params.onWindow },
    (w) => getLogs(client, { address: dao, event: proposalCreatedEvent, ...w, strict: true }),
  );
  const proposals = logs.map((log): ProposalCreated => {
    const a = log.args;
    return {
      id: a.id,
      proposer: a.proposer,
      kind: ACTION_KINDS[a.kind]!,
      target: a.target,
      amount: a.amount,
      flag: a.flag,
      closeRound: a.closeRound,
      revealEndRound: a.revealEndRound,
      memberSnapshot: a.memberSnapshot,
      description: a.description,
      descriptionURI: a.descriptionURI,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  });
  return { proposals, nextFromBlock: toBlock + 1n };
}

// ------------------------------------------------------------------------------------------------ writes

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
/** `SealedDAO.MAX_DESCRIPTION_URI_LENGTH`: bytes of `descriptionURI` (UTF-8). */
export const MAX_DESCRIPTION_URI_BYTES = 2_048;

/** Inputs of `propose`, validated like the contract does (so most reverts are caught before simulation). */
export const proposeInputSchema = z
  .object({
    dao: daoSchema,
    kind: z.enum(ACTION_KINDS, { error: "kind must be 'TransferUSDC' or 'SetMember'" }),
    target: addressSchema,
    amount: uint256Schema.default(0n),
    flag: z.boolean().default(false),
    description: z.string().refine((s) => utf8Bytes(s) <= 256, {
      error: 'description must be at most 256 bytes (UTF-8); put longer text behind descriptionURI',
    }),
    descriptionURI: z
      .string()
      .refine((s) => utf8Bytes(s) <= MAX_DESCRIPTION_URI_BYTES, {
        error: `descriptionURI must be at most ${MAX_DESCRIPTION_URI_BYTES} bytes (UTF-8)`,
      })
      .default(''),
    votingSeconds: z
      .int({ error: 'votingSeconds must be an integer' })
      .min(MIN_VOTING, { error: `votingSeconds must be at least ${MIN_VOTING} (10 minutes)` })
      .max(MAX_VOTING, { error: `votingSeconds must be at most ${MAX_VOTING} (7 days)` }),
  })
  .check((ctx) => {
    const p = ctx.value;
    if (p.target === ZERO_ADDRESS) {
      ctx.issues.push({ code: 'custom', message: 'target must not be the zero address', input: p.target });
    }
    if (p.target === p.dao) {
      // The DAO can never claim a payout or vote (BadTarget). The USDC token is refused onchain too.
      ctx.issues.push({ code: 'custom', message: 'target must not be the DAO itself', input: p.target });
    }
    if (p.kind === 'TransferUSDC' && p.amount === 0n) {
      ctx.issues.push({ code: 'custom', message: 'TransferUSDC amount must be > 0', input: p.amount });
    }
  });
export type ProposeInput = z.input<typeof proposeInputSchema>;

/**
 * `propose(kind, target, amount, flag, description, descriptionURI, votingSeconds)`, members only. Waits for the
 * receipt and returns the new proposal id from `ProposalCreated`.
 */
export async function propose(
  client: WriteClient,
  params: ProposeInput,
): Promise<{ hash: Hash; proposalId: bigint; closeRound: bigint; receipt: TransactionReceipt }> {
  const p = parseInput(proposeInputSchema, params, 'propose params');
  const hash = await write(client, p.dao, 'propose', [
    ACTION_KINDS.indexOf(p.kind),
    p.target,
    p.amount,
    p.flag,
    p.description,
    p.descriptionURI,
    p.votingSeconds,
  ]);
  const receipt = await waitForSuccess(client, hash, 'propose');
  const [created] = parseEventLogs({ abi: sealedDaoAbi, eventName: 'ProposalCreated', logs: receipt.logs });
  if (!created) throw new EventNotFoundError('ProposalCreated', hash);
  return { hash, proposalId: created.args.id, closeRound: created.args.closeRound, receipt };
}

/** `vote(id, commitment, ciphertext)`, members only, while sealing is open. Use `sealAndVote` to seal and send. */
export async function vote(
  client: WriteClient,
  params: { dao: Address; proposalId: bigint | number; commitment: Hex; ciphertext: Hex },
): Promise<Hash> {
  const p = parseInput(
    idParams.extend({ commitment: bytes32Schema, ciphertext: ciphertextSchema }),
    params,
    'vote params',
  );
  return write(client, p.dao, 'vote', [p.proposalId, p.commitment, p.ciphertext]);
}

const revealBatchParams = idParams
  .extend({
    voters: z.array(addressSchema).readonly(),
    choices: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).readonly(),
    salts: z.array(saltSchema).readonly(),
  })
  .check((ctx) => {
    const { voters, choices, salts } = ctx.value;
    if (voters.length !== choices.length || voters.length !== salts.length) {
      ctx.issues.push({
        code: 'custom',
        message: 'voters, choices and salts must have the same length',
        input: 0,
      });
    }
    if (voters.length > 256) {
      ctx.issues.push({ code: 'custom', message: 'at most 256 items per revealBatch', input: voters.length });
    }
  });

/**
 * `revealBatch(id, voters, choices, salts)`, anyone, while the reveal window is open. Items whose hash does not match
 * are skipped onchain (RevealSkipped), never reverted. Spread one `buildRevealBatch` chunk into it.
 */
export async function revealBatch(
  client: WriteClient,
  params: {
    dao: Address;
    proposalId: bigint | number;
    voters: readonly Address[];
    choices: readonly ChoiceIndex[];
    salts: readonly Hex[];
  },
): Promise<Hash> {
  const p = parseInput(revealBatchParams, params, 'revealBatch params');
  return write(client, p.dao, 'revealBatch', [p.proposalId, p.voters, p.choices, p.salts]);
}

/** `finalize(id)`, anyone, after the reveal window: records passed / failed. */
export async function finalize(client: WriteClient, params: { dao: Address; proposalId: bigint | number }) {
  const { dao, proposalId } = parseInput(idParams, params, 'finalize params');
  return write(client, dao, 'finalize', [proposalId]);
}

/** `execute(id)`, anyone, for a passed proposal within 7 days after the reveal window. */
export async function execute(client: WriteClient, params: { dao: Address; proposalId: bigint | number }) {
  const { dao, proposalId } = parseInput(idParams, params, 'execute params');
  return write(client, dao, 'execute', [proposalId]);
}

/** `claim()`: pulls `claimable[account]` in USDC to the sender. */
export async function claim(client: WriteClient, params: { dao: Address }) {
  return write(client, parseInput(daoParams, params, 'claim params').dao, 'claim', []);
}

/** A vote that was sealed and is about to be (or was) sent, with everything a local receipt needs. */
export interface SealedBallot extends SealedVote {
  proposalId: bigint;
  voter: Address;
  choice: Choice;
  closeRound: bigint;
}

/**
 * Seals `choice` for the client's account and sends `vote`: reads the proposal's close round, runs `sealVote`, calls
 * `onSealed` (persist the receipt there, before the transaction exists), then sends. A caller-supplied `closeRound` is
 * checked against the chain and must equal it (InvalidInputError otherwise): a vote encrypted to an earlier round
 * could be read before voting closes, and one encrypted to a later round could not be decrypted in the reveal window.
 */
export async function sealAndVote(
  client: WriteClient,
  params: {
    dao: Address;
    proposalId: bigint | number;
    choice: Choice;
    salt?: Hex | undefined;
    closeRound?: bigint | number | undefined;
    onSealed?: ((ballot: SealedBallot) => void | Promise<void>) | undefined;
  },
): Promise<SealedBallot & { hash: Hash }> {
  const account = requireAccount(client, 'sealAndVote');
  const p = parseInput(
    idParams.extend({ choice: choiceSchema, closeRound: roundSchema.optional() }),
    { dao: params.dao, proposalId: params.proposalId, choice: params.choice, closeRound: params.closeRound },
    'sealAndVote params',
  );
  const onchain = (await getProposal(client, p)).closeRound;
  if (p.closeRound !== undefined && p.closeRound !== onchain) {
    throw new InvalidInputError('sealAndVote params', [
      `closeRound ${p.closeRound} does not match proposal ${p.proposalId}'s close round ${onchain}`,
    ]);
  }
  const closeRound = onchain;
  const sealed = await sealVote({
    proposalId: p.proposalId,
    voter: account.address,
    choice: p.choice,
    closeRound,
    salt: params.salt,
  });
  const ballot: SealedBallot = {
    ...sealed,
    proposalId: p.proposalId,
    voter: account.address,
    choice: p.choice,
    closeRound,
  };
  await params.onSealed?.(ballot);
  const hash = await vote(client, {
    dao: p.dao,
    proposalId: p.proposalId,
    commitment: sealed.commitment,
    ciphertext: sealed.ciphertext,
  });
  return { ...ballot, hash };
}

/** Reads every `Sealed` log of one proposal in [fromBlock, toBlock], in windows of at most 9,999 blocks. */
export async function getSealedLogs(
  client: ReadClient,
  params: {
    dao: Address;
    proposalId: bigint;
    fromBlock: bigint;
    toBlock?: bigint | undefined;
    windowSize?: bigint | undefined;
    onWindow?: OnWindow | undefined;
  },
): Promise<
  { voter: Address; commitment: Hex; ciphertext: Hex; blockNumber: bigint; transactionHash: Hash }[]
> {
  const toBlock = params.toBlock ?? (await latestBlock(client));
  const logs = await scanWindows(
    { fromBlock: params.fromBlock, toBlock, windowSize: params.windowSize, onWindow: params.onWindow },
    (w) =>
      getLogs(client, {
        address: params.dao,
        event: sealedEvent,
        args: { groupId: params.proposalId },
        ...w,
        strict: true,
      }),
  );
  return logs.map((log) => ({
    voter: log.args.sealer,
    commitment: log.args.commitment,
    ciphertext: log.args.ciphertext,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  }));
}
