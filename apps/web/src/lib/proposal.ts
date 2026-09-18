// Pure helpers over a proposal: status tones, quorum math (D4) and which deadline matters now (D5).
import {
  EXECUTION_GRACE,
  executionDeadline,
  type Proposal,
  type ProposalStatus,
  QUICKNET_PERIOD,
  roundTime,
} from '@arcseal/sdk';

export type Tone = 'info' | 'warn' | 'ok' | 'danger' | 'muted' | 'accent';

export const STATUS_TONE: Record<ProposalStatus, Tone> = {
  Voting: 'accent',
  Revealing: 'info',
  Ready: 'warn',
  Passed: 'ok',
  Failed: 'danger',
  Executed: 'ok',
  Expired: 'muted',
};

/** Sealed votes needed for quorum: the smallest n with n * 10_000 >= memberSnapshot * quorumBps (D4). */
export function quorumNeeded(memberSnapshot: number, quorumBps: number): number {
  return Math.ceil((memberSnapshot * quorumBps) / 10_000);
}

export function quorumMet(p: Pick<Proposal, 'sealedCount' | 'memberSnapshot'>, quorumBps: number): boolean {
  return p.sealedCount * 10_000 >= p.memberSnapshot * quorumBps;
}

/** Why a finalized proposal failed. */
export function failureReason(
  p: Pick<Proposal, 'sealedCount' | 'memberSnapshot' | 'forCount' | 'againstCount'>,
  quorumBps: number,
): 'quorum' | 'majority' {
  return quorumMet(p, quorumBps) ? 'majority' : 'quorum';
}

/** drand rounds in EXECUTION_GRACE: 604,800 s / 3 s = 201,600. */
export const EXECUTION_GRACE_ROUNDS = BigInt(EXECUTION_GRACE) / QUICKNET_PERIOD;

/**
 * The drand round published at the execution deadline: roundTime(executeByRound(r)) === executionDeadline(r), so the
 * "Execute by" deadline can show its own round next to its wall-clock time (PRD 6).
 */
export function executeByRound(revealEndRound: bigint): bigint {
  return revealEndRound + EXECUTION_GRACE_ROUNDS;
}

export interface Deadlines {
  /** Voting closes (sealing ends, reveal opens). */
  close: number;
  /** Reveal window ends (finalize opens). */
  revealEnd: number;
  /** Last second execute is allowed for a passed proposal. */
  executeBy: number;
}

export function deadlines(p: Pick<Proposal, 'closeRound' | 'revealEndRound'>): Deadlines {
  return {
    close: roundTime(p.closeRound),
    revealEnd: roundTime(p.revealEndRound),
    executeBy: executionDeadline(p.revealEndRound),
  };
}
