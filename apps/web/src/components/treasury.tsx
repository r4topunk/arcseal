'use client';

import { claim, sealedDaoAbi } from '@arcseal/sdk';
import { HandCoins, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { erc20Abi } from 'viem';
import { simulateContract, writeContract } from 'viem/actions';
import { useAccount } from 'wagmi';
import { config } from '@/lib/config';
import { formatBps, formatInt, formatUsdc, freeTreasury, parseUsdc } from '@/lib/format';
import { AddressLink, ErrorNote, PageHeader, RequireDao, RequireWallet, RpcError } from './app-states';
import { FeeEstimate } from './fee';
import { useDocumentTitle, useI18n } from './i18n';
import { useClaimable, useDaoInfo, useMembers, useUsdcBalance } from './queries';
import { TxList, useTx } from './tx';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton, Stat } from './ui/primitives';

function Balances() {
  const { t } = useI18n();
  const info = useDaoInfo();
  const balance = useUsdcBalance(info.data?.usdc, config.dao);
  if (info.isError || balance.isError)
    return (
      <RpcError
        onRetry={() => {
          void info.refetch();
          void balance.refetch();
        }}
      />
    );
  if (!info.data || balance.data === undefined) return <Skeleton className="h-28 w-full" />;
  return (
    <Card className="grid gap-6 p-5 sm:grid-cols-3">
      <Stat label={t('treasury.balance')} value={formatUsdc(balance.data)} sub={t('treasury.balanceSub')} />
      <Stat
        label={t('treasury.owed')}
        value={formatUsdc(info.data.totalClaimable)}
        sub={t('treasury.owedSub')}
      />
      <Stat
        label={t('treasury.free')}
        value={formatUsdc(freeTreasury(balance.data, info.data.totalClaimable))}
        sub={t('treasury.freeSub')}
      />
    </Card>
  );
}

function ClaimBox() {
  const { t } = useI18n();
  const { address } = useAccount();
  const claimable = useClaimable(address);
  const { run, busy, error } = useTx();
  const dao = config.dao!;
  if (claimable.data === undefined) return <Skeleton className="h-16 w-full" />;
  const amount = claimable.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="tnum font-semibold text-2xl tracking-tight">
        {formatUsdc(amount)} <span className="font-normal text-muted text-sm">USDC</span>
      </p>
      {amount === 0n ? (
        <p className="text-muted text-sm">{t('treasury.claim.nothing')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="accent"
            disabled={busy !== null}
            onClick={() => void run('tx.label.claim', (wallet) => claim(wallet, { dao }), 'claim')}
          >
            <HandCoins /> {t('treasury.claim.button')}
          </Button>
          <FeeEstimate
            request={
              address
                ? { address: dao, abi: sealedDaoAbi, functionName: 'claim', args: [], account: address }
                : null
            }
          />
        </div>
      )}
      {error ? <ErrorNote message={error} /> : null}
    </div>
  );
}

function FundBox() {
  const { t } = useI18n();
  const uid = useId();
  const { address } = useAccount();
  const info = useDaoInfo();
  const usdc = info.data?.usdc;
  const mine = useUsdcBalance(usdc, address);
  const { run, busy, error } = useTx();
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const dao = config.dao!;

  const parsed = parseUsdc(amount);
  let fieldError: string | null = null;
  if (!parsed.ok) fieldError = t(`form.error.amount.${parsed.error}`);
  else if (parsed.value === 0n) fieldError = t('form.error.amount.zero');
  else if (mine.data !== undefined && parsed.value > mine.data) fieldError = t('treasury.fund.insufficient');
  const value = parsed.ok && parsed.value > 0n ? parsed.value : null;

  async function send() {
    setTouched(true);
    if (fieldError || !value || !usdc) return;
    const res = await run(
      'tx.label.fund',
      async (wallet) => {
        // A plain ERC-20 transfer to the DAO: the 6-decimal USDC view, never a native-value transfer.
        const { request } = await simulateContract(wallet, {
          address: usdc,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [dao, value],
          account: wallet.account!,
        });
        return writeContract(wallet, request);
      },
      'transfer',
    );
    if (res) {
      setAmount('');
      setTouched(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Field
        label={t('treasury.fund.amount')}
        htmlFor={`${uid}-amount`}
        error={touched ? fieldError : null}
        hint={mine.data !== undefined ? t('treasury.fund.balance', { amount: formatUsdc(mine.data) }) : null}
      >
        <Input
          id={`${uid}-amount`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="1.000000"
          autoComplete="off"
          className="tnum font-mono"
          aria-invalid={touched && !!fieldError}
          aria-describedby={touched && fieldError ? `${uid}-amount-error` : `${uid}-amount-hint`}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="default" disabled={busy !== null || !usdc}>
          <Send /> {t('treasury.fund.submit')}
        </Button>
        <FeeEstimate
          request={
            value && usdc && address && !fieldError
              ? {
                  address: usdc,
                  abi: erc20Abi,
                  functionName: 'transfer',
                  args: [dao, value],
                  account: address,
                }
              : null
          }
        />
      </div>
      {error ? <ErrorNote message={error} /> : null}
    </form>
  );
}

function Members() {
  const { t } = useI18n();
  const { address } = useAccount();
  const members = useMembers();
  const info = useDaoInfo();
  // The balances card above already shows the full network error; keep this one short.
  if (members.isError) return <ErrorNote message={t('state.rpcError.title')} />;
  if (!members.data) return <Skeleton className="h-24 w-full" />;
  if (members.data.length === 0)
    return (
      <p className="text-muted text-sm">
        {t('treasury.members.empty', { block: formatInt(config.deployBlock) })}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-sm">
        {t('treasury.members.lead', { count: info.data?.memberCount ?? members.data.length })}
      </p>
      <ul className="divide-y divide-hairline rounded-lg border border-hairline-strong">
        {members.data.map((m) => (
          <li key={m} className="flex items-center justify-between gap-3 px-3 py-2">
            <AddressLink address={m} label={m} className="truncate" />
            {address && m.toLowerCase() === address.toLowerCase() ? (
              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-accent text-xs">
                {t('wallet.you')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Params() {
  const { t } = useI18n();
  const info = useDaoInfo();
  if (!info.data) return <Skeleton className="h-24 w-full" />;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-sm">{t('treasury.params.lead')}</p>
      <dl className="divide-y divide-hairline">
        {row(t('dao.quorum'), <span className="tnum">{formatBps(info.data.quorumBps)}</span>)}
        {row(
          t('dao.bounty'),
          <span className="tnum font-mono">{formatUsdc(info.data.revealBounty)} USDC</span>,
        )}
        {row(t('treasury.params.usdc'), <AddressLink address={info.data.usdc} />)}
        {row(t('dao.contract'), <AddressLink address={config.dao!} />)}
      </dl>
    </div>
  );
}

export function TreasuryView() {
  const { t } = useI18n();
  useDocumentTitle(t('nav.treasury'));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeader eyebrow={t('treasury.eyebrow')} title={t('treasury.title')}>
        {t('treasury.lead')}
      </PageHeader>
      <RequireDao>
        <Balances />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('treasury.claim.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RequireWallet reason={t('treasury.claim.connect')}>
                <ClaimBox />
              </RequireWallet>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('treasury.fund.title')}</CardTitle>
              <p className="text-muted text-sm">{t('treasury.fund.lead')}</p>
            </CardHeader>
            <CardContent>
              <RequireWallet reason={t('state.readOnly')}>
                <FundBox />
              </RequireWallet>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('treasury.members.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Members />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('treasury.params.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Params />
            </CardContent>
          </Card>
        </div>
        <TxList labels={['tx.label.claim', 'tx.label.fund']} />
      </RequireDao>
    </div>
  );
}
