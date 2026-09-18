'use client';

import { closeRoundFor, propose, roundTime, sealedDaoAbi } from '@arcseal/sdk';
import { ArrowRight, Send } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId, useState } from 'react';
import { useAccount } from 'wagmi';
import { config } from '@/lib/config';
import { formatDateTime, formatInt, formatUsdc, freeTreasury, utf8Length } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import {
  DURATION_PRESETS,
  EMPTY_FORM,
  type FormErrors,
  MAX_DESCRIPTION_BYTES,
  type ProposalFormInput,
  type ProposalParams,
  validateProposalForm,
} from '@/lib/proposal-form';
import { cn } from '@/lib/utils';
import { ErrorNote, PageHeader, RequireDao, RequireWallet } from './app-states';
import { FeeEstimate } from './fee';
import { useDocumentTitle, useI18n } from './i18n';
import { proposalHref } from './proposal/proposal-card';
import { useDaoInfo, useIsMember, useUsdcBalance } from './queries';
import { TxList, useTx } from './tx';
import { Button, buttonVariants } from './ui/button';
import { Card, Field, Input, Notice, Skeleton, Textarea } from './ui/primitives';

const segment = (active: boolean) =>
  cn(
    'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
    active ? 'border-accent bg-accent-soft font-medium' : 'border-hairline-strong hover:bg-surface-2',
  );

/**
 * The create-proposal form: kind, target, amount or add/remove, description with a live byte counter, optional link,
 * duration presets. Validates with Zod on submit and then on every change; calls `onSubmit` with `propose` arguments.
 */
export function NewProposalForm({
  onSubmit,
  disabled = false,
  busy = false,
  freeUsdc,
  footer,
  onValidChange,
  forbiddenTargets = [],
}: {
  onSubmit: (params: ProposalParams) => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  freeUsdc?: bigint;
  footer?: ReactNode;
  onValidChange?: (params: ProposalParams | null) => void;
  /** Addresses the contract refuses as a target (the DAO and its USDC token). */
  forbiddenTargets?: readonly string[];
}) {
  const { t, locale } = useI18n();
  const uid = useId();
  const now = useNow(5_000);
  const [form, setForm] = useState<ProposalFormInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function update(patch: Partial<ProposalFormInput>) {
    const next = { ...form, ...patch };
    setForm(next);
    const r = validateProposalForm(next, forbiddenTargets);
    onValidChange?.(r.ok ? r.value : null);
    if (submitted) setErrors(r.ok ? {} : r.errors);
  }

  const err = (f: keyof FormErrors) => (errors[f] ? t(errors[f]!.key, errors[f]!.vars) : null);
  const bytes = utf8Length(form.description.trim());
  const id = (name: string) => `${uid}-${name}`;
  const describedBy = (name: keyof FormErrors) => (errors[name] ? `${id(name)}-error` : `${id(name)}-hint`);
  const closeRound = now === null ? null : closeRoundFor(now, form.votingSeconds);

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        const r = validateProposalForm(form, forbiddenTargets);
        if (!r.ok) {
          setErrors(r.errors);
          return;
        }
        setErrors({});
        void onSubmit(r.value);
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t('new.kind')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={segment(form.kind === 'TransferUSDC')}>
            <input
              type="radio"
              name="kind"
              checked={form.kind === 'TransferUSDC'}
              onChange={() => update({ kind: 'TransferUSDC' })}
              className="accent-[var(--accent)]"
            />
            {t('new.kind.transfer')}
          </label>
          <label className={segment(form.kind === 'SetMember')}>
            <input
              type="radio"
              name="kind"
              checked={form.kind === 'SetMember'}
              onChange={() => update({ kind: 'SetMember' })}
              className="accent-[var(--accent)]"
            />
            {t('new.kind.member')}
          </label>
        </div>
      </fieldset>

      <Field
        label={form.kind === 'TransferUSDC' ? t('new.target.transfer') : t('new.target.member')}
        htmlFor={id('target')}
        error={err('target')}
        hint={form.kind === 'TransferUSDC' ? t('new.target.hint.transfer') : t('new.target.hint.member')}
      >
        <Input
          id={id('target')}
          value={form.target}
          onChange={(e) => update({ target: e.target.value })}
          placeholder="0x0000000000000000000000000000000000000000"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          aria-invalid={!!errors.target}
          aria-describedby={describedBy('target')}
        />
      </Field>

      {form.kind === 'TransferUSDC' ? (
        <Field
          label={t('new.amount')}
          htmlFor={id('amount')}
          error={err('amount')}
          hint={
            <>
              {t('new.amount.hint')}{' '}
              {freeUsdc !== undefined ? t('new.amount.free', { free: formatUsdc(freeUsdc) }) : null}
            </>
          }
        >
          <Input
            id={id('amount')}
            value={form.amount}
            onChange={(e) => update({ amount: e.target.value })}
            inputMode="decimal"
            placeholder="1.000000"
            autoComplete="off"
            className="tnum font-mono"
            aria-invalid={!!errors.amount}
            aria-describedby={describedBy('amount')}
          />
        </Field>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium text-sm">{t('new.flag')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={segment(form.flag === 'add')}>
              <input
                type="radio"
                name="flag"
                checked={form.flag === 'add'}
                onChange={() => update({ flag: 'add' })}
                className="accent-[var(--accent)]"
              />
              {t('new.flag.add')}
            </label>
            <label className={segment(form.flag === 'remove')}>
              <input
                type="radio"
                name="flag"
                checked={form.flag === 'remove'}
                onChange={() => update({ flag: 'remove' })}
                className="accent-[var(--accent)]"
              />
              {t('new.flag.remove')}
            </label>
          </div>
        </fieldset>
      )}

      <Field
        label={t('new.description')}
        htmlFor={id('description')}
        error={err('description')}
        hint={t('new.description.hint')}
        aside={
          <span
            data-testid="byte-counter"
            aria-live="polite"
            className={cn(
              'tnum font-mono text-xs',
              bytes > MAX_DESCRIPTION_BYTES ? 'text-danger' : 'text-muted',
            )}
          >
            {t('new.description.counter', { used: bytes })}
          </span>
        }
      >
        <Textarea
          id={id('description')}
          value={form.description}
          onChange={(e) => update({ description: e.target.value })}
          rows={3}
          aria-invalid={!!errors.description}
          aria-describedby={describedBy('description')}
        />
      </Field>

      <Field
        label={t('new.uri')}
        htmlFor={id('descriptionURI')}
        error={err('descriptionURI')}
        hint={t('new.uri.hint')}
      >
        <Input
          id={id('descriptionURI')}
          value={form.descriptionURI}
          onChange={(e) => update({ descriptionURI: e.target.value })}
          placeholder="https://…"
          inputMode="url"
          autoComplete="off"
          aria-invalid={!!errors.descriptionURI}
          aria-describedby={describedBy('descriptionURI')}
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t('new.duration')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DURATION_PRESETS.map((s) => (
            <label key={s} className={segment(form.votingSeconds === s)}>
              <input
                type="radio"
                name="duration"
                checked={form.votingSeconds === s}
                onChange={() => update({ votingSeconds: s })}
                className="accent-[var(--accent)]"
              />
              {t(`new.duration.${s}`)}
            </label>
          ))}
        </div>
        {err('votingSeconds') ? (
          <p className="text-danger text-xs" role="alert">
            {err('votingSeconds')}
          </p>
        ) : closeRound !== null ? (
          <p className="text-muted text-xs" data-testid="close-preview">
            {t('new.preview', {
              round: formatInt(closeRound),
              time: formatDateTime(roundTime(closeRound), locale),
            })}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-hairline border-t pt-5">
        <Button type="submit" variant="accent" size="lg" disabled={disabled || busy}>
          <Send /> {t('new.submit')}
        </Button>
        {footer}
      </div>
    </form>
  );
}

function MemberGate({ children }: { children: (ok: boolean) => ReactNode }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const member = useIsMember(address);
  if (member.isPending) return <Skeleton className="h-10 w-full" />;
  if (member.data === false)
    return (
      <>
        <Notice tone="warn">{t('new.notMember')}</Notice>
        {children(false)}
      </>
    );
  return <>{children(true)}</>;
}

function CreateProposal() {
  const { t } = useI18n();
  const { address } = useAccount();
  const info = useDaoInfo();
  const { run, busy, error } = useTx();
  const [valid, setValid] = useState<ProposalParams | null>(null);
  const [created, setCreated] = useState<bigint | null>(null);
  const dao = config.dao!;
  const treasury = useUsdcBalance(info.data?.usdc, dao);
  const free =
    info.data && treasury.data !== undefined
      ? freeTreasury(treasury.data, info.data.totalClaimable)
      : undefined;

  async function submit(params: ProposalParams) {
    let id: bigint | null = null;
    const res = await run(
      'tx.label.propose',
      async (wallet) => {
        const r = await propose(wallet, { dao, ...params });
        id = r.proposalId;
        return { hash: r.hash, receipt: r.receipt };
      },
      'propose',
    );
    if (res && id !== null) setCreated(id);
  }

  const fee =
    valid && address
      ? {
          address: dao,
          abi: sealedDaoAbi,
          functionName: 'propose',
          args: [
            valid.kind === 'TransferUSDC' ? 0 : 1,
            valid.target,
            valid.amount,
            valid.flag,
            valid.description,
            valid.descriptionURI,
            valid.votingSeconds,
          ] as const,
          account: address,
        }
      : null;

  return (
    <MemberGate>
      {(isMember) => (
        <div className="flex flex-col gap-6">
          {created !== null ? (
            <Notice tone="ok" role="status" className="flex flex-wrap items-center justify-between gap-3">
              <span>{t('new.created', { id: created.toString() })}</span>
              <Link
                href={proposalHref(created)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('new.open', { id: created.toString() })} <ArrowRight />
              </Link>
            </Notice>
          ) : null}
          <NewProposalForm
            onSubmit={submit}
            disabled={!isMember}
            busy={busy !== null}
            freeUsdc={free}
            onValidChange={setValid}
            forbiddenTargets={info.data ? [dao, info.data.usdc] : [dao]}
            footer={<FeeEstimate request={isMember ? fee : null} />}
          />
          {error ? <ErrorNote message={error} /> : null}
          <TxList labels={['tx.label.propose']} />
        </div>
      )}
    </MemberGate>
  );
}

export function NewProposalView() {
  const { t } = useI18n();
  useDocumentTitle(t('nav.new'));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeader eyebrow={t('new.eyebrow')} title={t('new.title')}>
        {t('new.lead')}
      </PageHeader>
      <RequireDao>
        <Card className="p-5 sm:p-6">
          <RequireWallet reason={t('new.connect')}>
            <CreateProposal />
          </RequireWallet>
        </Card>
      </RequireDao>
    </div>
  );
}
