'use client';

import type { Proposal, ProposalStatus } from '@arcseal/sdk';
import { formatUsdc, shortAddress } from '@/lib/format';
import type { MessageKey, Vars } from '@/lib/i18n';
import { quorumMet, quorumNeeded } from '@/lib/proposal';
import { cn } from '@/lib/utils';
import { useI18n } from '../i18n';
import { Meter } from '../ui/primitives';

/** "Pay 1.000000 USDC to 0x12…cdef" / "Add 0x… as a member" / "Remove member 0x…". */
export function actionSummary(p: Pick<Proposal, 'kind' | 'amount' | 'target' | 'flag'>): {
  key: MessageKey;
  vars: Vars;
} {
  const target = shortAddress(p.target);
  if (p.kind === 'TransferUSDC')
    return { key: 'kind.transferSummary', vars: { amount: formatUsdc(p.amount), target } };
  return { key: p.flag ? 'kind.addSummary' : 'kind.removeSummary', vars: { target } };
}

/** Sealed votes against the quorum, then (after voting) the revealed tally. During voting there is no tally to show. */
export function Tally({
  proposal: p,
  status,
  quorumBps,
  detailed = false,
}: {
  proposal: Proposal;
  status: ProposalStatus;
  quorumBps: number;
  detailed?: boolean;
}) {
  const { t } = useI18n();
  const needed = quorumNeeded(p.memberSnapshot, quorumBps);
  const met = quorumMet(p, quorumBps);
  const voting = status === 'Voting';
  const unrevealed = p.sealedCount - p.revealedCount;
  const rows: { key: MessageKey; value: number; bar: string }[] = [
    { key: 'tally.for', value: p.forCount, bar: 'bg-ok' },
    { key: 'tally.against', value: p.againstCount, bar: 'bg-danger' },
    { key: 'tally.abstain', value: p.abstainCount, bar: 'bg-faint' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">
            {t('tally.sealed')}{' '}
            <span className="tnum">
              {p.sealedCount}/{p.memberSnapshot}
            </span>
          </span>
          <span className={cn('text-xs', met ? 'text-ok' : 'text-muted')}>
            {met ? t('tally.quorumMet') : t('tally.quorumNotMet')}
          </span>
        </div>
        <Meter
          value={p.sealedCount}
          max={Math.max(p.memberSnapshot, p.sealedCount)}
          mark={needed}
          label={t('tally.quorumLine', { sealed: p.sealedCount, snapshot: p.memberSnapshot, needed })}
          tone={met ? 'ok' : 'accent'}
        />
        {detailed ? (
          <p className="text-muted text-xs">
            {t('tally.quorumLine', { sealed: p.sealedCount, snapshot: p.memberSnapshot, needed })}
          </p>
        ) : null}
      </div>
      {voting ? (
        detailed ? (
          <p className="text-muted text-sm">{t('tally.hidden')}</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-3 gap-2">
            {rows.map((r) => (
              <div key={r.key} className="flex flex-col gap-1">
                <dt className="text-muted text-xs">{t(r.key)}</dt>
                <dd className="tnum font-semibold text-lg">{r.value}</dd>
                <div aria-hidden className="h-1 rounded-full bg-surface-2">
                  <div
                    className={cn('h-full rounded-full', r.bar)}
                    style={{ width: `${p.revealedCount ? (r.value / p.revealedCount) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
          <p className="text-muted text-xs">
            {t('tally.revealedOf', { revealed: p.revealedCount, sealed: p.sealedCount })}
            {detailed && unrevealed > 0 && status !== 'Revealing'
              ? ` · ${t('tally.unrevealed', { count: unrevealed })}`
              : ''}
          </p>
        </div>
      )}
    </div>
  );
}
