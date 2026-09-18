// drand quicknet round math. Mirrors Sealed.sol (PRD 4.1) exactly and is tested against the same vectors
// (contracts/test/vectors/rounds.json). Rounds are bigint (uint64 onchain); timestamps are unix seconds.

/** drand quicknet genesis, unix seconds. Round 1 is published at this instant. */
export const QUICKNET_GENESIS = 1_692_803_367n;
/** Seconds between quicknet rounds. */
export const QUICKNET_PERIOD = 3n;
/** Rounds the reveal window stays open after the close round: 28,800 rounds = 24 hours. */
export const REVEAL_WINDOW = 28_800n;
/** Shortest voting period `propose` accepts, in seconds (10 minutes). */
export const MIN_VOTING = 600;
/** Longest voting period `propose` accepts, in seconds (7 days). */
export const MAX_VOTING = 604_800;
/** Seconds after the reveal window ends during which a passed proposal can be executed (7 days). */
export const EXECUTION_GRACE = 604_800;

const MAX_UINT64 = 2n ** 64n - 1n;

/** A non-negative integer as bigint. Throws RangeError/TypeError, like a Solidity revert, on anything else. */
function toUint(value: bigint | number, label: string): bigint {
  let n: bigint;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer, got ${value}`);
    n = BigInt(value);
  } else throw new TypeError(`${label} must be a bigint or an integer number`);
  if (n < 0n) throw new RangeError(`${label} must be >= 0, got ${n}`);
  return n;
}

function toUint64(value: bigint, label: string): bigint {
  if (value > MAX_UINT64) throw new RangeError(`${label} ${value} does not fit in uint64`);
  return value;
}

/** A drand round: an integer in [1, 2^64 - 1]. Round 0 does not exist on quicknet. */
function toRound(value: bigint | number, label = 'round'): bigint {
  const r = toUint64(toUint(value, label), label);
  if (r < 1n) throw new RangeError(`${label} must be >= 1 (quicknet rounds start at 1), got ${r}`);
  return r;
}

function roundTimeBig(round: bigint): bigint {
  return QUICKNET_GENESIS + (round - 1n) * QUICKNET_PERIOD;
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

/**
 * Round whose signature is published at or before `unixSeconds`: `(t - GENESIS) / PERIOD + 1`.
 * Throws RangeError for `t < GENESIS`, where the contract reverts on the underflow.
 */
export function roundAt(unixSeconds: bigint | number): bigint {
  const t = toUint(unixSeconds, 'unixSeconds');
  if (t < QUICKNET_GENESIS) {
    throw new RangeError(`timestamp ${t} is before the quicknet genesis ${QUICKNET_GENESIS}`);
  }
  return toUint64((t - QUICKNET_GENESIS) / QUICKNET_PERIOD + 1n, 'roundAt');
}

/** First round published at or after `unixSeconds`: `roundAt(t)` on a round boundary, else `roundAt(t) + 1`. */
export function roundAfter(unixSeconds: bigint | number): bigint {
  const t = toUint(unixSeconds, 'unixSeconds');
  const at = roundAt(t);
  return (t - QUICKNET_GENESIS) % QUICKNET_PERIOD === 0n ? at : toUint64(at + 1n, 'roundAfter');
}

/** Unix time (seconds) at which `round` is published: `GENESIS + (round - 1) * PERIOD`. Throws for round 0. */
export function roundTime(round: bigint | number): number {
  return toSafeNumber(roundTimeBig(toRound(round)), 'roundTime');
}

/**
 * Close round of a proposal created at `nowSeconds` with a `votingSeconds` duration:
 * `roundAfter(now + votingSeconds)`, as `propose` computes it from `block.timestamp`.
 * Throws RangeError outside [MIN_VOTING, MAX_VOTING], where the contract reverts `BadDuration`.
 */
export function closeRoundFor(nowSeconds: bigint | number, votingSeconds: bigint | number): bigint {
  const duration = toUint(votingSeconds, 'votingSeconds');
  if (duration < BigInt(MIN_VOTING) || duration > BigInt(MAX_VOTING)) {
    throw new RangeError(`votingSeconds must be in [${MIN_VOTING}, ${MAX_VOTING}], got ${duration}`);
  }
  return roundAfter(toUint(nowSeconds, 'nowSeconds') + duration);
}

/** Last round of the reveal window (exclusive bound): `closeRound + REVEAL_WINDOW`. */
export function revealEndRoundFor(closeRound: bigint | number): bigint {
  return toUint64(toRound(closeRound, 'closeRound') + REVEAL_WINDOW, 'revealEndRound');
}

/** Sealing is open while `now < roundTime(closeRound)`. */
export function votingOpen(closeRound: bigint | number, nowSeconds: bigint | number): boolean {
  return toUint(nowSeconds, 'nowSeconds') < roundTimeBig(toRound(closeRound, 'closeRound'));
}

/** Reveal is open while `roundTime(closeRound) <= now < roundTime(closeRound + REVEAL_WINDOW)`. */
export function revealOpen(closeRound: bigint | number, nowSeconds: bigint | number): boolean {
  const now = toUint(nowSeconds, 'nowSeconds');
  const close = toRound(closeRound, 'closeRound');
  return roundTimeBig(close) <= now && now < roundTimeBig(revealEndRoundFor(close));
}

/** The reveal window is over, so `finalize` is allowed: `now >= roundTime(closeRound + REVEAL_WINDOW)`. */
export function pastRevealEnd(closeRound: bigint | number, nowSeconds: bigint | number): boolean {
  const close = toRound(closeRound, 'closeRound');
  return toUint(nowSeconds, 'nowSeconds') >= roundTimeBig(revealEndRoundFor(close));
}

/** Last unix second at which a passed proposal can be executed: `roundTime(revealEndRound) + EXECUTION_GRACE`. */
export function executionDeadline(revealEndRound: bigint | number): number {
  const end = roundTimeBig(toRound(revealEndRound, 'revealEndRound'));
  return toSafeNumber(end + BigInt(EXECUTION_GRACE), 'executionDeadline');
}
