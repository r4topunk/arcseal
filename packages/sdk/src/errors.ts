import type { Hash } from 'viem';

export type ArcSealErrorCode =
  | 'INVALID_INPUT'
  | 'DRAND_FETCH_FAILED'
  | 'INVALID_BEACON'
  | 'WALLET_REQUIRED'
  | 'PROPOSAL_NOT_FOUND'
  | 'CONTRACT_REVERT'
  | 'TX_REVERTED'
  | 'EVENT_NOT_FOUND';

/** Base class of the errors the SDK throws on purpose. Switch on `code`, not on the message. */
export class ArcSealError extends Error {
  readonly code: ArcSealErrorCode;
  constructor(code: ArcSealErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ArcSealError';
    this.code = code;
  }
}

/** An argument failed its Zod schema. Nothing was sent or signed. `issues` holds one line per problem. */
export class InvalidInputError extends ArcSealError {
  readonly issues: readonly string[];
  constructor(what: string, issues: readonly string[], options?: { cause?: unknown }) {
    super(
      'INVALID_INPUT',
      issues.length ? `invalid ${what}: ${issues.join('; ')}` : `invalid ${what}`,
      options,
    );
    this.name = 'InvalidInputError';
    this.issues = issues;
  }
}

/** One failed drand relay request: the URL and why it failed (HTTP status, timeout, bad body, bad signature). */
export interface DrandAttempt {
  url: string;
  error: string;
}

/**
 * No drand relay returned a valid beacon for `round`. `early` is true when the round is not published yet by the
 * local clock (`waitForRound` handles that case); otherwise every relay failed and `attempts` says why.
 */
export class DrandFetchError extends ArcSealError {
  readonly round: bigint;
  readonly attempts: readonly DrandAttempt[];
  readonly early: boolean;
  constructor(round: bigint, attempts: readonly DrandAttempt[], early: boolean) {
    const why = attempts.map((a) => `${a.url}: ${a.error}`).join('; ');
    super(
      'DRAND_FETCH_FAILED',
      `no drand relay returned a valid quicknet beacon for round ${round}` +
        `${early ? ' (the round is not published yet)' : ''}${why ? `: ${why}` : ''}`,
    );
    this.name = 'DrandFetchError';
    this.round = round;
    this.attempts = attempts;
    this.early = early;
  }
}

/** A beacon handed to the SDK is not quicknet's BLS signature for the round it claims, or is for another round. */
export class InvalidBeaconError extends ArcSealError {
  readonly round: bigint;
  constructor(round: bigint, reason: string) {
    super('INVALID_BEACON', `drand beacon for round ${round} is invalid: ${reason}`);
    this.name = 'InvalidBeaconError';
    this.round = round;
  }
}

/** A write action was called with a client that has no account. Nothing was signed. */
export class WalletRequiredError extends ArcSealError {
  readonly action: string;
  constructor(action: string) {
    super('WALLET_REQUIRED', `${action} sends a transaction: pass a client with an account`);
    this.name = 'WalletRequiredError';
    this.action = action;
  }
}

/** The DAO has no proposal with this id (`proposal(id)` returned an empty struct). */
export class ProposalNotFoundError extends ArcSealError {
  readonly proposalId: bigint;
  constructor(proposalId: bigint) {
    super('PROPOSAL_NOT_FOUND', `SealedDAO has no proposal ${proposalId}`);
    this.name = 'ProposalNotFoundError';
    this.proposalId = proposalId;
  }
}

/**
 * A contract read or a write's simulation reverted. `errorName` is the decoded custom error (`SealingClosed`,
 * `NotMember`, ...), `Error` for a revert string (`args[0]` holds it), `Panic` for a Solidity panic (`args[0]` is the
 * code) or `Unknown` for empty or undecodable revert data. Map `errorName` to a sentence in the UI.
 */
export class ContractRevertError extends ArcSealError {
  readonly functionName: string;
  readonly errorName: string;
  readonly args: readonly unknown[];
  constructor(
    functionName: string,
    errorName: string,
    args: readonly unknown[],
    options?: { cause?: unknown },
  ) {
    super('CONTRACT_REVERT', `${functionName} reverted with ${errorName}${formatArgs(args)}`, options);
    this.name = 'ContractRevertError';
    this.functionName = functionName;
    this.errorName = errorName;
    this.args = args;
  }
}

/** The transaction was mined but reverted (the simulation passed, then state changed before inclusion). */
export class TransactionRevertedError extends ArcSealError {
  readonly functionName: string;
  readonly hash: Hash;
  constructor(functionName: string, hash: Hash) {
    super('TX_REVERTED', `${functionName} transaction ${hash} reverted onchain`);
    this.name = 'TransactionRevertedError';
    this.functionName = functionName;
    this.hash = hash;
  }
}

/** A mined transaction's receipt lacks the event the action reads its result from. */
export class EventNotFoundError extends ArcSealError {
  readonly eventName: string;
  readonly hash: Hash;
  constructor(eventName: string, hash: Hash) {
    super('EVENT_NOT_FOUND', `event ${eventName} not found in the receipt of ${hash}`);
    this.name = 'EventNotFoundError';
    this.eventName = eventName;
    this.hash = hash;
  }
}

function formatArgs(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  return `(${args.map((a) => (typeof a === 'bigint' ? a.toString() : String(a))).join(', ')})`;
}
