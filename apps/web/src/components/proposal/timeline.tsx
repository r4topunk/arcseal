'use client';

import { choiceFromIndex } from '@arcseal/sdk';
import type { Address } from 'viem';
import { formatInt, formatUsdc, shortAddress } from '@/lib/format';
import { CHOICE_KEY } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ErrorNote } from '../app-states';
import { useI18n } from '../i18n';
import { type TimelineEntry, type TimelineEventName, useTimeline } from '../queries';
import { TxHashLink } from '../tx';
import { Skeleton } from '../ui/primitives';

const DOT: Record<TimelineEventName, string> = {
  ProposalCreated: 'bg-foreground',
  Sealed: 'bg-accent',
  VoteRevealed: 'bg-info',
  RevealSkipped: 'bg-warn',
  BountyCredited: 'bg-ok',
  BountySkipped: 'bg-warn',
  Finalized: 'bg-foreground',
  Executed: 'bg-ok',
};

function useDetail() {
  const { t } = useI18n();
  return (e: TimelineEntry): string => {
    const a = e.args;
    const addr = (v: unknown) => shortAddress(String(v as Address));
    switch (e.name) {
      case 'ProposalCreated':
        return t('event.by', { address: addr(a.proposer) });
      case 'Sealed':
        return t('event.by', { address: addr(a.sealer) });
      case 'VoteRevealed':
        return t('event.revealed', {
          voter: addr(a.voter),
          choice: t(CHOICE_KEY[choiceFromIndex(Number(a.choice))]).toLowerCase(),
        });
      case 'RevealSkipped':
        return addr(a.voter);
      case 'BountyCredited':
        return t('event.bounty', { amount: formatUsdc(a.amount as bigint), revealer: addr(a.revealer) });
      case 'Finalized':
        return t('event.finalized', {
          result: a.passed ? t('status.Passed') : t('status.Failed'),
          for: String(a.forCount),
          against: String(a.againstCount),
          abstain: String(a.abstainCount),
          revealed: String(a.revealedCount),
          sealed: String(a.sealedCount),
        });
      default:
        return '';
    }
  };
}

/** Every event of the proposal, oldest first, each with its block and a tx explorer link. */
export function Timeline({ id }: { id: bigint }) {
  const { t } = useI18n();
  const detail = useDetail();
  const q = useTimeline(id);
  if (q.isError) return <ErrorNote message={t('detail.timelineError')} />;
  if (!q.data) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <p className="text-muted text-sm">{t('detail.timelineLoading')}</p>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (q.data.length === 0) return <p className="text-muted text-sm">{t('detail.timelineEmpty')}</p>;
  return (
    <ol className="relative flex flex-col gap-4 border-hairline-strong border-l pl-5">
      {q.data.map((e) => (
        <li key={e.key} className="relative flex flex-col gap-0.5">
          <span
            aria-hidden
            className={cn(
              '-left-[25px] absolute top-1.5 size-2 rounded-full ring-4 ring-surface',
              DOT[e.name],
            )}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-sm">{t(`event.${e.name}`)}</span>
            <span className="flex items-center gap-2 text-muted text-xs">
              <span className="tnum">{t('event.block', { block: formatInt(e.blockNumber) })}</span>
              <TxHashLink hash={e.transactionHash} />
            </span>
          </div>
          {detail(e) ? <span className="text-muted text-sm">{detail(e)}</span> : null}
        </li>
      ))}
    </ol>
  );
}
