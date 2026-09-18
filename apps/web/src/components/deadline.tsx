'use client';

import { roundTime } from '@arcseal/sdk';
import { formatCountdown, formatDateTime, formatInt } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useI18n } from './i18n';

/**
 * A deadline as the PRD asks (6, UX rules): the drand round, the wall-clock time in the viewer's zone, and a live
 * countdown. `at` overrides the time derived from the round (the execution deadline is 7 days after a round).
 */
export function RoundDeadline({
  round,
  at,
  label,
  passedLabel,
  className,
  compact = false,
}: {
  round: bigint;
  at?: number;
  label: MessageKey;
  passedLabel: MessageKey;
  className?: string;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const now = useNow();
  const time = at ?? roundTime(round);
  const left = now === null ? null : time - now;
  const countdown = left === null ? null : formatCountdown(left);
  const passed = left !== null && left <= 0;
  return (
    <div className={cn('flex flex-col gap-0.5', className)} data-testid="round-deadline">
      <span className="eyebrow">{t(passed ? passedLabel : label)}</span>
      <span className={cn('tnum font-medium', compact ? 'text-sm' : 'text-base')}>
        {/* Rendered only after mount: the static HTML has no time zone. */}
        {now === null ? '…' : formatDateTime(time, locale)}
        {countdown ? (
          <span className="ml-2 text-accent text-sm">{t('deadline.in', { time: countdown })}</span>
        ) : null}
      </span>
      <span className="tnum font-mono text-muted text-xs">
        {t('deadline.round', { round: formatInt(round) })}
      </span>
    </div>
  );
}
