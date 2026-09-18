'use client';

import type { Proposal, ProposalStatus } from '@arcseal/sdk';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { executeByRound } from '@/lib/proposal';
import { RoundDeadline } from '../deadline';
import { useI18n } from '../i18n';
import { StatusChip } from '../status-chip';
import { actionSummary, Tally } from './tally';

export const proposalHref = (id: bigint) => `/app/proposal/?id=${id}`;

export function ProposalCard({
  proposal: p,
  status,
  quorumBps,
}: {
  proposal: Proposal;
  status: ProposalStatus;
  quorumBps: number;
}) {
  const { t } = useI18n();
  const summary = actionSummary(p);
  return (
    <li>
      <Link
        href={proposalHref(p.id)}
        aria-label={t('proposals.open', { id: p.id.toString() })}
        className="group grid gap-5 rounded-xl border border-hairline-strong bg-surface p-5 transition-colors hover:border-foreground/40 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-muted text-xs">#{p.id.toString()}</span>
            <StatusChip status={status} />
          </div>
          <p className="line-clamp-2 font-medium">{p.description || t('proposals.noDescription')}</p>
          <p className="text-muted text-sm">{t(summary.key, summary.vars)}</p>
        </div>
        <div className="flex flex-col gap-3">
          <RoundDeadline
            compact
            round={p.closeRound}
            label="deadline.votingCloses"
            passedLabel="deadline.votingClosed"
          />
          {status === 'Passed' ? (
            <RoundDeadline
              compact
              round={executeByRound(p.revealEndRound)}
              label="deadline.executeBy"
              passedLabel="deadline.executeEnded"
            />
          ) : (
            <RoundDeadline
              compact
              round={p.revealEndRound}
              label="deadline.revealEnds"
              passedLabel="deadline.revealEnded"
            />
          )}
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <Tally proposal={p} status={status} quorumBps={quorumBps} />
          </div>
          <ArrowRight
            aria-hidden
            className="mt-1 size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          />
        </div>
      </Link>
    </li>
  );
}
