'use client';

import type { Proposal, ProposalStatus } from '@arcseal/sdk';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { config } from '@/lib/config';
import { formatUsdc } from '@/lib/format';
import { executeByRound } from '@/lib/proposal';
import { isLinkableUri } from '@/lib/proposal-form';
import { AddressLink, ErrorNote, RequireDao, RpcError } from '../app-states';
import { RoundDeadline } from '../deadline';
import { useDocumentTitle, useI18n } from '../i18n';
import { useDaoInfo, useProposalDetail, useTimeline } from '../queries';
import { StatusChip } from '../status-chip';
import { TxList } from '../tx';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '../ui/primitives';
import { ExecutePanel, FinalizePanel, ResultPanel } from './lifecycle';
import { PrivacyNote } from './privacy-note';
import { RevealPanel } from './reveal-panel';
import { Tally } from './tally';
import { Timeline } from './timeline';
import { VotePanel } from './vote-panel';

/** `?id=N` as a proposal id, or null. Static export cannot pre-render unknown ids, so the id is a query parameter. */
export function parseProposalId(raw: string | null): bigint | null {
  if (!raw || !/^\d{1,30}$/.test(raw.trim())) return null;
  const id = BigInt(raw.trim());
  return id > 0n ? id : null;
}

function Details({ p }: { p: Proposal }) {
  const { t } = useI18n();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
  return (
    <dl className="divide-y divide-hairline">
      {row(t('detail.action'), t(`kind.${p.kind}`))}
      {row(t('detail.target'), <AddressLink address={p.target} />)}
      {p.kind === 'TransferUSDC'
        ? row(t('detail.amount'), <span className="tnum font-mono">{formatUsdc(p.amount)} USDC</span>)
        : row(t('detail.change'), p.flag ? t('detail.add') : t('detail.remove'))}
      {row(t('detail.proposer'), <AddressLink address={p.proposer} />)}
    </dl>
  );
}

/**
 * The proposal's descriptionURI. It comes from the chain, where any member can store any scheme, so only https://,
 * http:// and ipfs:// URIs become links; anything else is shown as inert text (audit F8).
 */
export function DescriptionLink({ uri }: { uri: string }) {
  const { t } = useI18n();
  if (isLinkableUri(uri)) {
    return (
      <a
        href={uri.trim()}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-fit items-center gap-1 text-accent text-sm underline underline-offset-4"
      >
        {t('detail.descriptionUri')} <ExternalLink aria-hidden className="size-3.5" />
      </a>
    );
  }
  return (
    <p className="break-all text-muted text-xs">
      {t('detail.descriptionUriBlocked')}{' '}
      <code className="font-mono">{uri.length > 200 ? `${uri.slice(0, 200)}…` : uri}</code>
    </p>
  );
}

function ActionPanel({
  p,
  status,
  quorumBps,
  bounty,
}: {
  p: Proposal;
  status: ProposalStatus;
  quorumBps: number;
  bounty: bigint;
}) {
  const timeline = useTimeline(p.id);
  // Sealed logs come after the proposal's creation block: start the reveal scan there when it is known.
  const created = timeline.data?.find((e) => e.name === 'ProposalCreated')?.blockNumber;
  switch (status) {
    case 'Voting':
      return <VotePanel proposal={p} />;
    case 'Revealing':
      return (
        <RevealPanel
          proposal={p}
          bounty={bounty}
          quorumBps={quorumBps}
          fromBlock={created ?? config.deployBlock}
        />
      );
    case 'Ready':
      return <FinalizePanel proposal={p} />;
    case 'Passed':
      return <ExecutePanel proposal={p} />;
    default:
      return <ResultPanel proposal={p} status={status} quorumBps={quorumBps} />;
  }
}

function Loaded({ id }: { id: bigint }) {
  const { t } = useI18n();
  const q = useProposalDetail(id);
  const info = useDaoInfo();
  if (q.error && (q.error as { code?: string }).code === 'PROPOSAL_NOT_FOUND')
    return <ErrorNote message={t('detail.notFound', { id: id.toString() })} />;
  if (q.isError || info.isError)
    return (
      <RpcError
        onRetry={() => {
          void q.refetch();
          void info.refetch();
        }}
      />
    );
  if (!q.data || !info.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">{t('state.loading')}</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const { proposal: p, status } = q.data;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 border-hairline border-b pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker">{t('proposals.item', { id: p.id.toString() })}</span>
          <StatusChip status={status} />
        </div>
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          {p.description || t('proposals.noDescription')}
        </h1>
        {p.descriptionURI ? <DescriptionLink uri={p.descriptionURI} /> : null}
      </header>
      {/* Mobile order: action, then tally and deadlines, then the timeline. Desktop: the aside spans both rows. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-8 lg:col-start-1 lg:row-start-1">
          <Card>
            <CardContent className="py-5">
              <ActionPanel
                p={p}
                status={status}
                quorumBps={info.data.quorumBps}
                bounty={info.data.revealBounty}
              />
            </CardContent>
          </Card>
          <TxList />
        </div>
        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.tally')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tally proposal={p} status={status} quorumBps={info.data.quorumBps} detailed />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.deadlines')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RoundDeadline
                round={p.closeRound}
                label="deadline.votingCloses"
                passedLabel="deadline.votingClosed"
              />
              <RoundDeadline
                round={p.revealEndRound}
                label="deadline.revealEnds"
                passedLabel="deadline.revealEnded"
              />
              {status === 'Passed' || status === 'Expired' ? (
                <RoundDeadline
                  round={executeByRound(p.revealEndRound)}
                  label="deadline.executeBy"
                  passedLabel="deadline.executeEnded"
                />
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Details p={p} />
            </CardContent>
          </Card>
          {status !== 'Voting' ? <PrivacyNote closeRound={p.closeRound} /> : null}
        </aside>
        <section
          aria-labelledby="timeline-title"
          className="flex flex-col gap-4 lg:col-start-1 lg:row-start-2"
        >
          <h2 id="timeline-title" className="font-semibold text-lg">
            {t('detail.timeline')}
          </h2>
          <Timeline id={p.id} />
        </section>
      </div>
    </div>
  );
}

export function ProposalDetail() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = parseProposalId(params.get('id'));
  useDocumentTitle(id === null ? null : t('proposals.item', { id: id.toString() }));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        href="/app/proposals/"
        className="inline-flex w-fit items-center gap-1.5 text-muted text-sm hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t('detail.back')}
      </Link>
      <RequireDao>
        {id === null ? <ErrorNote message={t('detail.missingId')} /> : <Loaded id={id} />}
      </RequireDao>
    </div>
  );
}
