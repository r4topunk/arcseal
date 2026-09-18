'use client';

import {
  type Choice,
  type Proposal,
  sealAndVote,
  sealedDaoAbi,
  serializeVoteReceipt,
  type VoteReceiptInput,
} from '@arcseal/sdk';
import { Download, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { useAccount } from 'wagmi';
import { CHAIN_ID, config } from '@/lib/config';
import { formatInt } from '@/lib/format';
import { useMounted } from '@/lib/hooks';
import { CHOICE_KEY } from '@/lib/i18n';
import { downloadText, loadReceipt, receiptFileName, saveReceipt } from '@/lib/receipts';
import { cn } from '@/lib/utils';
import { ErrorNote, RequireWallet } from '../app-states';
import { FeeEstimate } from '../fee';
import { useI18n } from '../i18n';
import { useCommitment, useIsMember } from '../queries';
import { useTx } from '../tx';
import { Button } from '../ui/button';
import { Notice, Skeleton } from '../ui/primitives';
import { PrivacyNote } from './privacy-note';

const ZERO_COMMITMENT = `0x${'0'.repeat(64)}`;
// Same size as a real vote ciphertext (64-byte plaintext + 359 bytes of tlock overhead), for the fee estimate only.
const SAMPLE_COMMITMENT = `0x${'ab'.repeat(32)}` as Hex;
const SAMPLE_CIPHERTEXT = `0x${'ab'.repeat(423)}` as Hex;
const OPTIONS: Choice[] = ['for', 'against', 'abstain'];

export function ReceiptDownload({ json, fileName }: { json: string; fileName: string }) {
  const { t } = useI18n();
  return (
    <Button variant="outline" size="sm" onClick={() => downloadText(fileName, json)}>
      <Download /> {t('vote.downloadReceipt')}
    </Button>
  );
}

function SealForm({ proposal }: { proposal: Proposal }) {
  const { t } = useI18n();
  const dao = config.dao!;
  const { address } = useAccount();
  const member = useIsMember(address);
  const commitment = useCommitment(proposal.id, address);
  const { run, busy, error } = useTx();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [step, setStep] = useState<'idle' | 'encrypting' | 'wallet'>('idle');
  const [sealed, setSealed] = useState<{ json: string; forced: boolean } | null>(null);
  const [storageTick, setStorageTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: storageTick re-reads storage after a save
  const local = useMemo(
    () => (address ? loadReceipt({ chainId: CHAIN_ID, dao, proposalId: proposal.id, voter: address }) : null),
    [address, dao, proposal.id, storageTick],
  );

  if (!address || member.isPending || commitment.isPending) return <Skeleton className="h-32 w-full" />;
  const fileName = receiptFileName({ chainId: CHAIN_ID, proposalId: proposal.id, voter: address });

  if (commitment.data && commitment.data !== ZERO_COMMITMENT) {
    const receiptJson = sealed?.json ?? (local ? serializeVoteReceipt(local) : null);
    return (
      <div className="flex flex-col gap-3">
        <Notice tone={sealed ? 'ok' : 'muted'} role="status">
          {sealed ? t('vote.done') : t('vote.already')}
        </Notice>
        <p className={cn('text-sm', sealed?.forced ? 'text-warn' : 'text-muted')}>
          {sealed?.forced
            ? t('vote.receiptForced')
            : receiptJson
              ? t('vote.receiptStored')
              : t('vote.receiptMissing')}
        </p>
        {receiptJson ? (
          <div>
            <ReceiptDownload json={receiptJson} fileName={fileName} />
          </div>
        ) : null}
      </div>
    );
  }
  if (member.data === false) return <Notice tone="warn">{t('vote.notMember')}</Notice>;

  async function seal() {
    if (!choice || !address) return;
    const held: { receipt?: VoteReceiptInput } = {};
    await run(
      'tx.label.vote',
      async (wallet) => {
        setStep('encrypting');
        const ballot = await sealAndVote(wallet, {
          dao,
          proposalId: proposal.id,
          choice,
          closeRound: proposal.closeRound,
          // Runs after sealing and before the wallet prompt: the receipt exists before the transaction does.
          onSealed: (b) => {
            const receipt: VoteReceiptInput = {
              version: 1,
              chainId: CHAIN_ID,
              dao,
              proposalId: b.proposalId,
              voter: b.voter,
              choice: b.choice,
              salt: b.salt,
              commitment: b.commitment,
              closeRound: b.closeRound,
              createdAt: new Date().toISOString(),
            };
            held.receipt = receipt;
            const saved = saveReceipt(receipt);
            if (!saved.stored) downloadText(fileName, saved.json);
            setSealed({ json: saved.json, forced: !saved.stored });
            setStep('wallet');
          },
        });
        if (held.receipt) {
          const saved = saveReceipt({ ...held.receipt, txHash: ballot.hash });
          setSealed((s) => ({ json: saved.json, forced: s?.forced ?? !saved.stored }));
        }
        return ballot.hash;
      },
      'vote',
    );
    setStep('idle');
    setStorageTick((n) => n + 1);
  }

  const request = {
    address: dao,
    abi: sealedDaoAbi,
    functionName: 'vote',
    args: [proposal.id, SAMPLE_COMMITMENT, SAMPLE_CIPHERTEXT] as const,
    account: address,
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void seal();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t('vote.legend')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((c) => (
            <label
              key={c}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                choice === c
                  ? 'border-accent bg-accent-soft font-medium'
                  : 'border-hairline-strong hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name="choice"
                value={c}
                checked={choice === c}
                onChange={() => setChoice(c)}
                className="accent-[var(--accent)]"
              />
              {t(CHOICE_KEY[c])}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={!choice || busy !== null}>
          <Lock /> {t('vote.submit')}
        </Button>
        <FeeEstimate request={request} />
      </div>
      {step === 'encrypting' ? (
        <p role="status" className="text-muted text-sm">
          {t('vote.step.encrypting', { round: formatInt(proposal.closeRound) })}
        </p>
      ) : step === 'wallet' ? (
        <p role="status" className="text-muted text-sm">
          {t('vote.step.wallet')}
        </p>
      ) : null}
      {sealed?.forced ? <Notice tone="warn">{t('vote.receiptForced')}</Notice> : null}
      {error ? <ErrorNote message={error} /> : null}
    </form>
  );
}

/** Voting status: pick a choice, seal it to the close round, keep the receipt. */
export function VotePanel({ proposal }: { proposal: Proposal }) {
  const { t } = useI18n();
  const mounted = useMounted();
  return (
    <section aria-labelledby="vote-title" className="flex flex-col gap-4">
      <h2 id="vote-title" className="font-semibold text-lg">
        {t('vote.title')}
      </h2>
      <PrivacyNote closeRound={proposal.closeRound} />
      {mounted ? (
        <RequireWallet reason={t('vote.connect')}>
          <SealForm proposal={proposal} />
        </RequireWallet>
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
    </section>
  );
}
