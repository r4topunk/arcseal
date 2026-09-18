import { describe, expect, it } from 'vitest';
import { formatUsdc } from '../lib/format.js';
import { describeBounty, GARBAGE_VOTER, type RevealOutcome, withGarbageItem } from '../lib/reveal.js';

const outcome = (o: Partial<RevealOutcome>): RevealOutcome => ({
  revealed: 3,
  skipped: [],
  bounty: 0n,
  bountySkipped: false,
  ...o,
});

describe('describeBounty (revealBatch summary lines)', () => {
  it('reports a credited bounty with the caller-chosen suffix', () => {
    expect(describeBounty(outcome({ bounty: 30_000n }), formatUsdc, 'to the revealer')).toBe(
      'bounty 0.030000 USDC to the revealer',
    );
  });

  it('reports a bounty skipped because the free treasury is short', () => {
    expect(describeBounty(outcome({ bountySkipped: true }), formatUsdc, '(claimable)')).toBe(
      'bounty skipped (treasury short)',
    );
  });

  it('explains revealed votes without any bounty event: a proposal below quorum pays none (audit F1)', () => {
    expect(describeBounty(outcome({}), formatUsdc, '(claimable)')).toBe(
      'no bounty (proposal below quorum, or no bounty set)',
    );
  });
});

describe('withGarbageItem (PRD 10.2 negative proof)', () => {
  const voter = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
  const salt = `0x${'11'.repeat(32)}` as const;

  it('creates a batch holding only the garbage item when there is nothing to reveal', () => {
    const [batch] = withGarbageItem([]);
    expect(batch).toEqual({ voters: [GARBAGE_VOTER], choices: [0], salts: [`0x${'ab'.repeat(32)}`] });
  });

  it('appends to the last batch and leaves the valid items untouched', () => {
    const out = withGarbageItem([{ voters: [voter], choices: [1], salts: [salt] }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.voters).toEqual([voter, GARBAGE_VOTER]);
    expect(out[0]?.choices).toEqual([1, 0]);
    expect(out[0]?.salts[0]).toBe(salt);
  });

  it('opens a new batch when the last one already has 256 items', () => {
    const full = {
      voters: Array.from({ length: 256 }, () => voter),
      choices: Array.from({ length: 256 }, () => 1 as const),
      salts: Array.from({ length: 256 }, () => salt),
    };
    const out = withGarbageItem([full]);
    expect(out).toHaveLength(2);
    expect(out[0]?.voters).toHaveLength(256);
    expect(out[1]?.voters).toEqual([GARBAGE_VOTER]);
  });
});
