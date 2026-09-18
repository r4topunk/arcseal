'use client';

import type { ProposalStatus } from '@arcseal/sdk';
import { STATUS_TONE } from '@/lib/proposal';
import { useI18n } from './i18n';
import { Badge } from './ui/primitives';

const DOT: Record<ProposalStatus, string> = {
  Voting: 'bg-accent animate-pulse',
  Revealing: 'bg-info',
  Ready: 'bg-warn',
  Passed: 'bg-ok',
  Failed: 'bg-danger',
  Executed: 'bg-ok',
  Expired: 'bg-faint',
};

/** One chip per derived status (7), with the meaning as its accessible description. */
export function StatusChip({ status }: { status: ProposalStatus }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS_TONE[status]} data-status={status} title={t(`status.hint.${status}`)}>
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[status]}`} />
      {t(`status.${status}`)}
      <span className="sr-only">: {t(`status.hint.${status}`)}</span>
    </Badge>
  );
}
