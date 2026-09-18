import { executionDeadline, roundTime } from '@arcseal/sdk';
import { describe, expect, it } from 'vitest';
import { parseProposalId } from '@/components/proposal/proposal-detail';
import {
  EXECUTION_GRACE_ROUNDS,
  executeByRound,
  failureReason,
  quorumMet,
  quorumNeeded,
} from '@/lib/proposal';

describe('quorum over sealed votes (D4)', () => {
  it('needs ceil(snapshot * bps / 10,000) sealed votes', () => {
    expect(quorumNeeded(3, 5_000)).toBe(2);
    expect(quorumNeeded(4, 5_000)).toBe(2);
    expect(quorumNeeded(5, 5_000)).toBe(3);
    expect(quorumNeeded(3, 10_000)).toBe(3);
  });

  it('meets quorum exactly at the boundary and explains a failure', () => {
    expect(quorumMet({ sealedCount: 2, memberSnapshot: 4 }, 5_000)).toBe(true);
    expect(quorumMet({ sealedCount: 1, memberSnapshot: 3 }, 5_000)).toBe(false);
    const tie = { sealedCount: 3, memberSnapshot: 3, forCount: 1, againstCount: 1 };
    expect(failureReason(tie, 5_000)).toBe('majority');
    expect(failureReason({ ...tie, sealedCount: 1 }, 5_000)).toBe('quorum');
  });
});

describe('execution deadline round (PRD 6: every deadline shows its drand round)', () => {
  it('is the round published at the execution deadline, 201,600 rounds after the reveal end', () => {
    expect(EXECUTION_GRACE_ROUNDS).toBe(201_600n);
    for (const revealEnd of [32_028_800n, 32_698_812n]) {
      expect(executeByRound(revealEnd)).toBe(revealEnd + 201_600n);
      expect(roundTime(executeByRound(revealEnd))).toBe(executionDeadline(revealEnd));
    }
  });
});

describe('parseProposalId (?id=N)', () => {
  it('accepts positive integers only', () => {
    expect(parseProposalId('3')).toBe(3n);
    expect(parseProposalId(' 12 ')).toBe(12n);
    for (const bad of [null, '', '0', '-1', '1.5', 'abc', '0x1', '1'.repeat(31)])
      expect(parseProposalId(bad)).toBeNull();
  });
});
