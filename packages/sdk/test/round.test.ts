import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  closeRoundFor,
  EXECUTION_GRACE,
  executionDeadline,
  MAX_VOTING,
  MIN_VOTING,
  pastRevealEnd,
  QUICKNET_GENESIS,
  QUICKNET_PERIOD,
  REVEAL_WINDOW,
  revealEndRoundFor,
  revealOpen,
  roundAfter,
  roundAt,
  roundTime,
  votingOpen,
} from '../src/index.js';

// Written by the contracts side (Sealed.sol tests read the same file): the SDK must agree on every vector.
type RoundVector = { timestamp: number; roundAt: number; roundAfter: number; roundTime: number };
const ROUNDS = JSON.parse(
  readFileSync(new URL('../../../contracts/test/vectors/rounds.json', import.meta.url), 'utf8'),
) as { genesis: number; period: number; vectors: RoundVector[] };

const GENESIS = Number(QUICKNET_GENESIS);

describe('round vectors shared with Foundry (contracts/test/vectors/rounds.json)', () => {
  it('describe quicknet (genesis, period) and hold 20 exact integer vectors', () => {
    expect(BigInt(ROUNDS.genesis)).toBe(QUICKNET_GENESIS);
    expect(BigInt(ROUNDS.period)).toBe(QUICKNET_PERIOD);
    expect(ROUNDS.vectors).toHaveLength(20);
    for (const v of ROUNDS.vectors) {
      for (const n of [v.timestamp, v.roundAt, v.roundAfter, v.roundTime])
        expect(Number.isSafeInteger(n)).toBe(true);
    }
  });

  it.each(ROUNDS.vectors)(
    't=$timestamp: roundAt $roundAt, roundAfter $roundAfter, roundTime $roundTime',
    (v) => {
      expect(roundAt(v.timestamp)).toBe(BigInt(v.roundAt));
      expect(roundAt(BigInt(v.timestamp))).toBe(BigInt(v.roundAt));
      expect(roundAfter(v.timestamp)).toBe(BigInt(v.roundAfter));
      expect(roundAfter(BigInt(v.timestamp))).toBe(BigInt(v.roundAfter));
      expect(roundTime(roundAt(v.timestamp))).toBe(v.roundTime);
      expect(roundTime(BigInt(v.roundAt))).toBe(v.roundTime);
    },
  );
});

describe('round math edges', () => {
  it('throws RangeError before genesis, like the Solidity underflow revert', () => {
    for (const t of [GENESIS - 1, 0, 1_600_000_000n]) {
      expect(() => roundAt(t)).toThrow(RangeError);
      expect(() => roundAfter(t)).toThrow(RangeError);
    }
    expect(() => closeRoundFor(0, MIN_VOTING)).toThrow(RangeError);
  });

  it('round 0 does not exist: roundTime(0) throws, roundTime(1) is genesis', () => {
    expect(() => roundTime(0)).toThrow(RangeError);
    expect(() => roundTime(0n)).toThrow(RangeError);
    expect(roundTime(1)).toBe(GENESIS);
    expect(roundTime(2n)).toBe(GENESIS + 3);
  });

  it('rejects non-integer, negative and out-of-range inputs', () => {
    expect(() => roundAt(GENESIS + 0.5)).toThrow(RangeError);
    expect(() => roundAt(Number.NaN)).toThrow(RangeError);
    expect(() => roundAt(-1n)).toThrow(RangeError);
    expect(() => roundAt('1692803367' as unknown as number)).toThrow(TypeError);
    expect(() => roundTime(2n ** 64n)).toThrow(RangeError); // not a uint64 round
    expect(() => roundTime(2n ** 63n)).toThrow(RangeError); // time does not fit a safe JS number
  });

  it('roundAt/roundAfter bracket every second: roundTime(roundAt(t)) <= t <= roundTime(roundAfter(t))', () => {
    for (const base of [GENESIS, 1_790_000_000]) {
      for (let t = base; t < base + 60; t++) {
        const at = roundTime(roundAt(t));
        const after = roundTime(roundAfter(t));
        expect(at).toBeLessThanOrEqual(t);
        expect(t - at).toBeLessThan(3);
        expect(after).toBeGreaterThanOrEqual(t);
        expect(after - t).toBeLessThan(3);
        expect(roundAfter(t) - roundAt(t)).toBe((t - GENESIS) % 3 === 0 ? 0n : 1n);
      }
    }
  });
});

describe('proposal windows', () => {
  const now = 1_790_000_000; // (now - genesis) % 3 == 2
  const close = closeRoundFor(now, MIN_VOTING);

  it('constants: 24 h reveal window, 10 min..7 d voting, 7 d execution grace', () => {
    expect(REVEAL_WINDOW * QUICKNET_PERIOD).toBe(86_400n);
    expect(MIN_VOTING).toBe(600);
    expect(MAX_VOTING).toBe(7 * 86_400);
    expect(EXECUTION_GRACE).toBe(7 * 86_400);
  });

  it('closeRoundFor = roundAfter(now + votingSeconds), bounded like BadDuration', () => {
    expect(close).toBe(roundAfter(now + MIN_VOTING));
    expect(roundTime(close)).toBeGreaterThanOrEqual(now + MIN_VOTING);
    expect(closeRoundFor(BigInt(now), BigInt(MAX_VOTING))).toBe(roundAfter(now + MAX_VOTING));
    expect(() => closeRoundFor(now, MIN_VOTING - 1)).toThrow(RangeError);
    expect(() => closeRoundFor(now, MAX_VOTING + 1)).toThrow(RangeError);
    expect(() => closeRoundFor(now, 600.5)).toThrow(RangeError);
  });

  it('revealEndRoundFor = closeRound + 28,800', () => {
    expect(revealEndRoundFor(close)).toBe(close + 28_800n);
    expect(revealEndRoundFor(1)).toBe(28_801n);
    expect(() => revealEndRoundFor(0)).toThrow(RangeError);
  });

  it('voting, reveal and finalize windows switch at the exact second', () => {
    const closeAt = roundTime(close);
    const revealEndAt = roundTime(revealEndRoundFor(close));
    expect(revealEndAt - closeAt).toBe(86_400);

    expect(votingOpen(close, now)).toBe(true);
    expect(votingOpen(close, closeAt - 1)).toBe(true);
    expect(votingOpen(close, closeAt)).toBe(false);

    expect(revealOpen(close, closeAt - 1)).toBe(false);
    expect(revealOpen(close, closeAt)).toBe(true);
    expect(revealOpen(close, revealEndAt - 1)).toBe(true);
    expect(revealOpen(close, revealEndAt)).toBe(false);

    expect(pastRevealEnd(close, revealEndAt - 1)).toBe(false);
    expect(pastRevealEnd(close, revealEndAt)).toBe(true);
    expect(pastRevealEnd(close, BigInt(revealEndAt) + 10n ** 9n)).toBe(true);
  });

  it('executionDeadline = roundTime(revealEndRound) + 7 days', () => {
    const end = revealEndRoundFor(close);
    expect(executionDeadline(end)).toBe(roundTime(end) + EXECUTION_GRACE);
    expect(() => executionDeadline(0)).toThrow(RangeError);
  });
});
