'use client';

import { execute, finalize, type Proposal, type ProposalStatus, sealedDaoAbi } from '@arcseal/sdk';
import { CheckCheck, Gavel, Play } from 'lucide-react';
import { useAccount } from 'wagmi';
import { config } from '@/lib/config';
import { formatDateTime, formatInt, formatUsdc, shortAddress } from '@/lib/format';
import { deadlines, executeByRound, failureReason, quorumNeeded } from '@/lib/proposal';
import { cn } from '@/lib/utils';
import { ErrorNote, RequireWallet } from '../app-states';
import { FeeEstimate } from '../fee';
import { useI18n } from '../i18n';
import { useTx } from '../tx';
import { Button } from '../ui/button';

function ActionButton({ fn, proposal }: { fn: 'finalize' | 'execute'; proposal: Proposal }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { run, busy, error } = useTx();
  const dao = config.dao!;
  const label = fn === 'finalize' ? 'tx.label.finalize' : 'tx.label.execute';
  const action = fn === 'finalize' ? finalize : execute;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="accent"
          disabled={busy !== null}
          onClick={() => void run(label, (wallet) => action(wallet, { dao, proposalId: proposal.id }), fn)}
        >
          {fn === 'finalize' ? <Gavel /> : <Play />}
          {t(fn === 'finalize' ? 'finalize.button' : 'execute.button')}
        </Button>
        <FeeEstimate
          request={
            address
              ? { address: dao, abi: sealedDaoAbi, functionName: fn, args: [proposal.id], account: address }
              : null
          }
        />
      </div>
      {error ? <ErrorNote message={error} /> : null}
    </div>
  );
}

/** Ready: anyone finalizes after the reveal window. */
export function FinalizePanel({ proposal }: { proposal: Proposal }) {
  const { t, locale } = useI18n();
  const d = deadlines(proposal);
  return (
    <section aria-labelledby="finalize-title" className="flex flex-col gap-4">
      <h2 id="finalize-title" className="font-semibold text-lg">
        {t('finalize.title')}
      </h2>
      <p className="text-muted text-sm">
        {t('finalize.lead', {
          round: formatInt(proposal.revealEndRound),
          time: formatDateTime(d.revealEnd, locale),
        })}
      </p>
      <RequireWallet reason={t('state.readOnly')}>
        <ActionButton fn="finalize" proposal={proposal} />
      </RequireWallet>
    </section>
  );
}

/** Passed: anyone executes within 7 days after the reveal window. */
export function ExecutePanel({ proposal }: { proposal: Proposal }) {
  const { t, locale } = useI18n();
  const deadline = formatDateTime(deadlines(proposal).executeBy, locale);
  const round = formatInt(executeByRound(proposal.revealEndRound));
  const target = shortAddress(proposal.target);
  return (
    <section aria-labelledby="execute-title" className="flex flex-col gap-4">
      <h2 id="execute-title" className="font-semibold text-lg">
        {t('execute.title')}
      </h2>
      <p className="text-muted text-sm">
        {proposal.kind === 'TransferUSDC'
          ? t('execute.lead.transfer', { amount: formatUsdc(proposal.amount), target, deadline, round })
          : t('execute.lead.member', { deadline, round })}
      </p>
      <RequireWallet reason={t('state.readOnly')}>
        <ActionButton fn="execute" proposal={proposal} />
      </RequireWallet>
    </section>
  );
}

/** Executed, Failed or Expired: the outcome in one sentence. */
export function ResultPanel({
  proposal: p,
  status,
  quorumBps,
}: {
  proposal: Proposal;
  status: Extract<ProposalStatus, 'Executed' | 'Failed' | 'Expired'>;
  quorumBps: number;
}) {
  const { t } = useI18n();
  let text: string;
  if (status === 'Executed') {
    text =
      p.kind === 'TransferUSDC'
        ? t('result.executed.transfer', { amount: formatUsdc(p.amount), target: shortAddress(p.target) })
        : t('result.executed.member');
  } else if (status === 'Expired') {
    text = t('result.expired');
  } else if (failureReason(p, quorumBps) === 'quorum') {
    text = t('result.failed.quorum', {
      sealed: p.sealedCount,
      snapshot: p.memberSnapshot,
      needed: quorumNeeded(p.memberSnapshot, quorumBps),
    });
  } else {
    text = t('result.failed.majority', { for: p.forCount, against: p.againstCount });
  }
  return (
    <section aria-labelledby="result-title" className="flex flex-col gap-3">
      <h2 id="result-title" className="font-semibold text-lg">
        {t('result.title')}
      </h2>
      <p
        className={cn(
          'flex gap-2 rounded-lg p-4 text-sm',
          status === 'Executed'
            ? 'bg-ok-soft text-ok'
            : status === 'Failed'
              ? 'bg-danger-soft text-danger'
              : 'bg-surface-2 text-muted',
        )}
      >
        <CheckCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {text}
      </p>
    </section>
  );
}
