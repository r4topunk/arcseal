// Reveal side of a proposal (PRD 5, D9): anyone decrypts every sealed vote after the close round and submits them in
// revealBatch transactions of at most 256 items. No relayer: the web app runs this in the browser.
import { verifyBeacon } from '@arcseal/tlock';
import { type Address, type Hex, hexToBytes } from 'viem';
import {
  getProposal,
  getSealedLogs,
  REVEALED_COMMITMENT,
  type ReadClient,
  readCommitmentOf,
} from './actions.js';
import { getBeacon } from './drand.js';
import { InvalidBeaconError, InvalidInputError } from './errors.js';
import { createLogger, type Logger, newCorrelationId as newId, withCorrelationId } from './logger.js';
import type { OnWindow } from './logs.js';
import {
  addressSchema,
  type Beacon,
  type BeaconInput,
  beaconSchema,
  type Choice,
  parseInput,
  proposalIdSchema,
  type RevealItemInput,
  revealItemSchema,
} from './schemas.js';
import { type ChoiceIndex, choiceToIndex, hashVote, lockedRound, openSealedVote } from './seal.js';

/** Most items `revealBatch` accepts in one call (`TooManyItems` above it). */
export const MAX_REVEAL_BATCH = 256;

/** Arguments of one `revealBatch(id, voters, choices, salts)` call. `choices` are Solidity enum values (uint8). */
export interface RevealBatch {
  voters: Address[];
  choices: ChoiceIndex[];
  salts: Hex[];
}

/**
 * Turns decrypted votes into `revealBatch` arguments, split into chunks of at most `size` (default and maximum 256)
 * items, in input order. Validates every item and refuses a voter listed twice (only one reveal per voter can match).
 * Zero items give zero batches.
 */
export function buildRevealBatch(
  items: readonly RevealItemInput[],
  options: { size?: number | undefined } = {},
): RevealBatch[] {
  const size = options.size ?? MAX_REVEAL_BATCH;
  if (!Number.isInteger(size) || size < 1 || size > MAX_REVEAL_BATCH) {
    throw new InvalidInputError('batch size', [`must be an integer in 1..${MAX_REVEAL_BATCH}, got ${size}`]);
  }
  const seen = new Set<Address>();
  const batches: RevealBatch[] = [];
  items.forEach((raw, i) => {
    const item = parseInput(revealItemSchema, raw, `reveal item ${i}`);
    if (seen.has(item.voter)) {
      throw new InvalidInputError(`reveal item ${i}`, [`voter ${item.voter} is listed more than once`]);
    }
    seen.add(item.voter);
    if (i % size === 0) batches.push({ voters: [], choices: [], salts: [] });
    const batch = batches[batches.length - 1]!;
    batch.voters.push(item.voter);
    batch.choices.push(choiceToIndex(item.choice));
    batch.salts.push(item.salt);
  });
  return batches;
}

/** A decrypted vote whose hash matches the live onchain commitment: safe to put in `revealBatch`. */
export interface RevealItem {
  voter: Address;
  choice: Choice;
  salt: Hex;
  commitment: Hex;
}

/**
 * Why a sealed vote is not revealable. `undecryptable`: not a tlock ciphertext for the close round, or it does not
 * decrypt or decode to a vote (garbage, truncated, wrong round). `commitment-mismatch`: it decrypts, but its hash is
 * not the voter's live commitment. `already-revealed`: the commitment was consumed by an earlier reveal.
 */
export type SkipReason = 'undecryptable' | 'commitment-mismatch' | 'already-revealed';

/** The beacon itself, or a function that returns the beacon for a round (default: `getBeacon` over drand HTTP). */
export type BeaconSource = BeaconInput | ((round: bigint) => Promise<BeaconInput>);

export interface UnsealProposalParams {
  client: ReadClient;
  dao: Address;
  proposalId: bigint | number;
  /** First block scanned for `Sealed` logs. Default 0: pass the DAO deploy block (or the proposal's block). */
  fromBlock?: bigint | undefined;
  /** Last block scanned. Default: the latest block. */
  toBlock?: bigint | undefined;
  /** Where the close-round beacon comes from. It is read once and BLS-verified before any decryption. */
  beaconSource?: BeaconSource | undefined;
  /** Parent logger; a child with a fresh `correlationId` is used for this call. Default `createLogger()`. */
  logger?: Logger | undefined;
  /** Blocks per eth_getLogs call, at most (and by default) 9,999. */
  windowSize?: bigint | undefined;
  /** Called after each log window (progress bars, tests). */
  onWindow?: OnWindow | undefined;
}

export interface UnsealProposalResult {
  /** Revealable votes in `Sealed` log order. Feed them to `buildRevealBatch`. */
  items: RevealItem[];
  /** Voters whose sealed vote cannot be revealed, in log order. */
  skipped: Address[];
  /** The reason for each skipped voter, same order as `skipped`. */
  skipReasons: { voter: Address; reason: SkipReason }[];
  /** The proposal's close round, whose beacon opened the votes. */
  closeRound: bigint;
  /** The correlation id stamped on this call's log lines. */
  correlationId: string;
}

/**
 * Decrypts every sealed vote of a proposal (PRD 5, D9). Reads `proposal(id)` for the close round, reads the `Sealed`
 * logs of the proposal in windows of at most 9,999 blocks (Arc's eth_getLogs cap is 10,000), gets the close-round
 * beacon once and BLS-verifies it, then opens each ciphertext. A vote becomes an item only if `hashVote` of its
 * plaintext equals the voter's live `commitmentOf`, so garbage, mismatched and already revealed votes are skipped
 * (with a reason) instead of making `revealBatch` pay for items it would skip anyway.
 *
 * Throws `ProposalNotFoundError` for an unknown id, `DrandFetchError` when drand cannot serve the beacon yet or at
 * all, and `InvalidBeaconError` when `beaconSource` yields a beacon that is not quicknet's for the close round.
 * Nothing is fetched from drand when the proposal has no sealed votes.
 */
export async function unsealProposal(params: UnsealProposalParams): Promise<UnsealProposalResult> {
  const dao = parseInput(addressSchema, params.dao, 'dao');
  const proposalId = parseInput(proposalIdSchema, params.proposalId, 'proposalId');
  const correlationId = newId();
  const log = withCorrelationId(params.logger ?? createLogger(), correlationId).child({
    dao,
    proposalId: proposalId.toString(),
  });

  const { closeRound } = await getProposal(params.client, { dao, proposalId });
  const sealed = await getSealedLogs(params.client, {
    dao,
    proposalId,
    fromBlock: params.fromBlock ?? 0n,
    toBlock: params.toBlock,
    windowSize: params.windowSize,
    onWindow: (w) => {
      log.debug(
        { fromBlock: w.fromBlock.toString(), toBlock: w.toBlock.toString(), logs: w.logs },
        'log window',
      );
      params.onWindow?.(w);
    },
  });
  log.info({ closeRound: closeRound.toString(), sealed: sealed.length }, 'unseal start');

  const result: UnsealProposalResult = { items: [], skipped: [], skipReasons: [], closeRound, correlationId };
  if (sealed.length === 0) return result;

  const beacon = await resolveBeacon(params.beaconSource, closeRound, log);

  // One Sealed log per voter (the contract refuses a second seal); keep the first if a node ever repeats one.
  const seen = new Set<Address>();
  const candidates: { voter: Address; commitment: Hex; choice?: Choice; salt?: Hex }[] = [];
  for (const entry of sealed) {
    if (seen.has(entry.voter)) continue;
    seen.add(entry.voter);
    const bytes = hexToBytes(entry.ciphertext);
    const opened = lockedRound(bytes) === closeRound ? await openSealedVote(bytes, beacon) : null;
    candidates.push({ voter: entry.voter, commitment: entry.commitment, ...opened });
  }

  const live = await Promise.all(
    candidates.map((c) => readCommitmentOf(params.client, { dao, proposalId, voter: c.voter })),
  );
  candidates.forEach((c, i) => {
    const expected =
      c.choice === undefined || c.salt === undefined
        ? undefined
        : hashVote({ proposalId, voter: c.voter, choice: c.choice, salt: c.salt });
    if (expected !== undefined && live[i] === expected) {
      result.items.push({ voter: c.voter, choice: c.choice!, salt: c.salt!, commitment: expected });
      return;
    }
    const reason: SkipReason =
      expected === undefined
        ? 'undecryptable'
        : live[i] === REVEALED_COMMITMENT && expected === c.commitment
          ? 'already-revealed'
          : 'commitment-mismatch';
    result.skipped.push(c.voter);
    result.skipReasons.push({ voter: c.voter, reason });
    log.info({ voter: c.voter, reason }, 'vote skipped');
  });
  log.info({ items: result.items.length, skipped: result.skipped.length }, 'unseal done');
  return result;
}

async function resolveBeacon(
  source: BeaconSource | undefined,
  closeRound: bigint,
  log: Logger,
): Promise<Beacon> {
  const raw =
    typeof source === 'function'
      ? await source(closeRound)
      : (source ?? (await getBeacon(closeRound, { logger: log })));
  const beacon = parseInput(beaconSchema, raw, 'beacon');
  if (beacon.round !== closeRound) {
    throw new InvalidBeaconError(
      beacon.round,
      `it is for round ${beacon.round}, the close round is ${closeRound}`,
    );
  }
  if (!verifyBeacon(beacon)) {
    throw new InvalidBeaconError(
      beacon.round,
      'the signature does not verify against the quicknet public key',
    );
  }
  log.debug({ round: closeRound.toString() }, 'beacon verified');
  return beacon;
}
