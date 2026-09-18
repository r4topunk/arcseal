'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { config } from '@/lib/config';
import { formatBps, formatUsdc } from '@/lib/format';
import { AddressLink, PageHeader, RequireDao, RpcError } from '../app-states';
import { useDocumentTitle, useI18n } from '../i18n';
import { useDaoInfo, useProposalList } from '../queries';
import { buttonVariants } from '../ui/button';
import { Card, Skeleton, Stat } from '../ui/primitives';
import { ProposalCard } from './proposal-card';

const LIMIT = 50;

export function DaoStats() {
  const { t } = useI18n();
  const info = useDaoInfo();
  if (info.isError) return <RpcError onRetry={() => info.refetch()} />;
  if (!info.data) return <Skeleton className="h-24 w-full" />;
  const d = info.data;
  return (
    <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
      <Stat label={t('dao.members')} value={d.memberCount} />
      <Stat label={t('dao.quorum')} value={formatBps(d.quorumBps)} sub={t('dao.quorumSub')} />
      <Stat label={t('dao.bounty')} value={formatUsdc(d.revealBounty)} sub={t('dao.bountySub')} />
      <Stat
        label={t('dao.proposals')}
        value={d.proposalCount.toString()}
        sub={
          <span>
            {t('dao.contract')} <AddressLink address={config.dao!} />
          </span>
        }
      />
    </Card>
  );
}

function ProposalList() {
  const { t } = useI18n();
  const info = useDaoInfo();
  const list = useProposalList(LIMIT);
  // DaoStats already shows the network error card when the DAO reads fail; show one card, not two.
  if (list.isError) return info.isError ? null : <RpcError onRetry={() => list.refetch()} />;
  if (!list.data || !info.data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="sr-only">{t('state.loading')}</span>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }
  const { items, total } = list.data;
  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-3 p-8">
        <h2 className="font-semibold text-lg">{t('proposals.empty.title')}</h2>
        <p className="text-muted text-sm">{t('proposals.empty.body')}</p>
        <Link href="/app/new/" className={buttonVariants({ variant: 'accent', size: 'sm' })}>
          <Plus /> {t('nav.new')}
        </Link>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map(({ proposal, status }) => (
          <ProposalCard
            key={proposal.id.toString()}
            proposal={proposal}
            status={status}
            quorumBps={info.data.quorumBps}
          />
        ))}
      </ul>
      {total > BigInt(items.length) ? (
        <p className="text-muted text-xs">
          {t('proposals.showing', { shown: items.length, total: total.toString() })}
        </p>
      ) : null}
    </div>
  );
}

export function ProposalsView() {
  const { t } = useI18n();
  useDocumentTitle(t('nav.proposals'));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={t('proposals.eyebrow')}
        title={t('proposals.title')}
        actions={
          <Link href="/app/new/" className={buttonVariants({ variant: 'accent' })}>
            <Plus /> {t('nav.new')}
          </Link>
        }
      >
        {t('proposals.lead')}
      </PageHeader>
      <RequireDao>
        <DaoStats />
        <ProposalList />
      </RequireDao>
    </div>
  );
}
