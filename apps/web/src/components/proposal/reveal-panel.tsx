'use client';

import {
  buildRevealBatch,
  type Proposal,
  REVEALED_COMMITMENT,
  type RevealItemInput,
  readCommitmentOf,
  revealBatch,
  sealedDaoAbi,
  type UnsealProposalResult,
  unsealProposal,
  type VoteReceipt,
} from '@arcseal/sdk';
import { FileUp, KeyRound, LockOpen } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { CHAIN_ID, config } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { formatInt, formatUsdc } from '@/lib/format';
import { useMounted } from '@/lib/hooks';
import { CHOICE_KEY, type MessageKey } from '@/lib/i18n';
import { quorumMet } from '@/lib/proposal';
import { checkUploadedReceipt, loadReceipt } from '@/lib/receipts';
import { AddressLink, ErrorNote } from '../app-states';
import { ConnectButton } from '../connect-button';
import { FeeEstimate } from '../fee';
import { useI18n } from '../i18n';
import { useClient } from '../queries';
import { useTx } from '../tx';
import { Button } from '../ui/button';
import { Notice } from '../ui/primitives';

type Row = { voter: `0x${string}`; key: MessageKey; vars?: Record<string, string>; ok: boolean };

/**
 * Whether revealing pays, in one sentence: the treasury credits the reveal payment only for a proposal that met
 * quorum (audit F1), and only when the DAO has a non-zero payment set.
 */
export function PaymentNote({
  proposal,
  bounty,
  quorumBps,
}: {
  proposal: Proposal;
  bounty: bigint;
  quorumBps: number;
}) {
  const { t } = useI18n();
  if (bounty === 0n) return null;
  return (
    <p className="text-muted text-sm">
      {quorumMet(proposal, quorumBps)
        ? t('reveal.payment', { bounty: formatUsdc(bounty) })
        : t('reveal.noPayment')}
    </p>
  );
}

/** Revealing status: decrypt every sealed vote in the browser, then send revealBatch in chunks of at most 256 (D9). */
function RevealAll({
  proposal,
  bounty,
  quorumBps,
  fromBlock,
}: {
  proposal: Proposal;
  bounty: bigint;
  quorumBps: number;
  fromBlock: bigint;
}) {
  const { t, locale } = useI18n();
  const client = useClient();
  const { address, isConnected, chainId } = useAccount();
  const { run, busy, error: txError } = useTx();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [windows, setWindows] = useState(0);
  const [result, setResult] = useState<UnsealProposalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const walletReady = isConnected && chainId === CHAIN_ID;

  const batches = useMemo(() => (result ? buildRevealBatch(result.items) : []), [result]);

  async function submit(list = batches, start = sent) {
    for (let i = start; i < list.length; i++) {
      const batch = list[i]!;
      const res = await run(
        'tx.label.reveal',
        (wallet) => revealBatch(wallet, { dao: config.dao!, proposalId: proposal.id, ...batch }),
        'revealBatch',
      );
      if (!res) return;
      setSent(i + 1);
    }
  }

  async function reveal() {
    if (!client) return;
    setPhase('scanning');
    setWindows(0);
    setError(null);
    setSent(0);
    try {
      const r = await unsealProposal({
        client,
        dao: config.dao!,
        proposalId: proposal.id,
        fromBlock,
        onWindow: () => setWindows((n) => n + 1),
      });
      setResult(r);
      setPhase('done');
      // One click: when a wallet is ready, the decrypted votes go straight to revealBatch.
      if (walletReady && r.items.length > 0) await submit(buildRevealBatch(r.items), 0);
    } catch (e) {
      setError(errorMessage(e, locale, 'unsealProposal'));
      setPhase('idle');
    }
  }

  const rows: Row[] = result
    ? [
        ...result.items.map((i) => ({
          voter: i.voter,
          key: 'reveal.decrypted' as const,
          vars: { choice: t(CHOICE_KEY[i.choice]) },
          ok: true,
        })),
        ...result.skipReasons.map((s) => ({
          voter: s.voter,
          key: `reveal.reason.${s.reason}` as const,
          ok: false,
        })),
      ]
    : [];
  const first = batches[sent];
  const feeRequest =
    first && address
      ? {
          address: config.dao!,
          abi: sealedDaoAbi,
          functionName: 'revealBatch',
          args: [proposal.id, first.voters, first.choices, first.salts] as const,
          account: address,
        }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-sm">{t('reveal.lead', { round: formatInt(proposal.closeRound) })}</p>
      <PaymentNote proposal={proposal} bounty={bounty} quorumBps={quorumBps} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="accent"
          onClick={() => void reveal()}
          disabled={phase === 'scanning' || busy !== null}
        >
          <LockOpen /> {t('reveal.button')}
        </Button>
        {phase === 'scanning' ? (
          <span role="status" className="text-muted text-sm">
            {t('reveal.scanning', { windows })}
          </span>
        ) : null}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {result ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-lg border border-hairline-strong">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('reveal.resultTitle')}</caption>
              <thead className="bg-surface-2 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('reveal.voter')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('reveal.result')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.voter} className="border-hairline border-t">
                    <td className="px-3 py-2">
                      <AddressLink address={r.voter} />
                    </td>
                    <td className={r.ok ? 'px-3 py-2 text-ok' : 'px-3 py-2 text-warn'}>{t(r.key, r.vars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-faint text-xs">{t('reveal.logId', { id: result.correlationId })}</p>
          {result.items.length === 0 ? (
            <Notice>{t('reveal.nothing')}</Notice>
          ) : sent >= batches.length ? (
            <Notice tone="ok" role="status">
              {t('reveal.sent')}
            </Notice>
          ) : walletReady ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="default" onClick={() => void submit()} disabled={busy !== null}>
                {t('reveal.send', { count: result.items.length - sent * 256 })}
                {batches.length > 1 ? ` · ${t('reveal.batch', { n: sent + 1, total: batches.length })}` : ''}
              </Button>
              <FeeEstimate request={feeRequest} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 p-3">
              <p className="text-muted text-sm">{t('reveal.connectToSend')}</p>
              <ConnectButton />
            </div>
          )}
        </div>
      ) : null}
      {txError ? <ErrorNote message={txError} /> : null}
    </div>
  );
}

/** "Reveal only mine": from this browser's receipt or an uploaded receipt file. Needs no drand at all. */
function RevealMine({ proposal }: { proposal: Proposal }) {
  const { t, locale } = useI18n();
  const inputId = useId();
  const client = useClient();
  const { address, isConnected, chainId } = useAccount();
  const { run, busy, error: txError } = useTx();
  const [uploaded, setUploaded] = useState<VoteReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const dao = config.dao!;
  const local = address
    ? loadReceipt({ chainId: CHAIN_ID, dao, proposalId: proposal.id, voter: address })
    : null;
  const walletReady = isConnected && chainId === CHAIN_ID;

  async function onFile(file: File | undefined) {
    setError(null);
    setUploaded(null);
    if (!file) return;
    const r = checkUploadedReceipt(await file.text(), { chainId: CHAIN_ID, dao, proposalId: proposal.id });
    if (r.ok) setUploaded(r.receipt);
    else if (r.error === 'invalid') setError(t('reveal.receipt.invalid'));
    else if (r.error === 'wrongChain') setError(t('reveal.receipt.wrongChain', { chainId: r.chainId }));
    else if (r.error === 'wrongDao') setError(t('reveal.receipt.wrongDao', { dao: r.dao }));
    else setError(t('reveal.receipt.wrongProposal', { id: r.proposalId.toString() }));
  }

  async function revealReceipt(receipt: VoteReceipt) {
    setError(null);
    try {
      // Skip the transaction when the vote is already revealed or the receipt is not this voter's live commitment.
      const live = await readCommitmentOf(client!, { dao, proposalId: proposal.id, voter: receipt.voter });
      if (live !== receipt.commitment) {
        setError(
          t(
            live === REVEALED_COMMITMENT
              ? 'reveal.reason.already-revealed'
              : 'reveal.reason.commitment-mismatch',
          ),
        );
        return;
      }
    } catch (e) {
      setError(errorMessage(e, locale, 'commitmentOf'));
      return;
    }
    const item: RevealItemInput = { voter: receipt.voter, choice: receipt.choice, salt: receipt.salt };
    const [batch] = buildRevealBatch([item]);
    const res = await run(
      'tx.label.revealMine',
      (wallet) => revealBatch(wallet, { dao, proposalId: proposal.id, ...batch! }),
      'revealBatch',
    );
    if (res) setDone(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-sm">{t('reveal.mineLead')}</p>
      {done ? (
        <Notice tone="ok" role="status">
          {t('reveal.sent')}
        </Notice>
      ) : null}
      {local ? (
        <div>
          <Button
            variant="outline"
            onClick={() => void revealReceipt(local)}
            disabled={!walletReady || busy !== null}
          >
            <KeyRound /> {t('reveal.mineLocal', { choice: t(CHOICE_KEY[local.choice]) })}
          </Button>
        </div>
      ) : address ? (
        <p className="text-muted text-sm">{t('reveal.mineNoLocal')}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="inline-flex items-center gap-2 font-medium text-sm">
          <FileUp aria-hidden className="size-4 text-muted" /> {t('reveal.mineUpload')}
        </label>
        <input
          id={inputId}
          type="file"
          accept="application/json,.json"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-hairline-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm hover:file:bg-surface-2"
        />
      </div>
      {uploaded ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 p-3 text-sm">
          <span>
            {t('reveal.mineUploaded', {
              voter: uploaded.voter.slice(0, 10),
              choice: t(CHOICE_KEY[uploaded.choice]),
            })}
          </span>
          <Button
            size="sm"
            onClick={() => void revealReceipt(uploaded)}
            disabled={!walletReady || busy !== null}
          >
            {t('reveal.mineSubmit')}
          </Button>
        </div>
      ) : null}
      {!walletReady ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted text-sm">{t('reveal.connectToSend')}</p>
          <ConnectButton />
        </div>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {txError ? <ErrorNote message={txError} /> : null}
    </div>
  );
}

export function RevealPanel({
  proposal,
  bounty,
  quorumBps,
  fromBlock,
}: {
  proposal: Proposal;
  bounty: bigint;
  quorumBps: number;
  fromBlock: bigint;
}) {
  const { t } = useI18n();
  const mounted = useMounted();
  return (
    <section aria-labelledby="reveal-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2 id="reveal-title" className="font-semibold text-lg">
          {t('reveal.title')}
        </h2>
        <RevealAll proposal={proposal} bounty={bounty} quorumBps={quorumBps} fromBlock={fromBlock} />
      </div>
      <div className="flex flex-col gap-3 border-hairline border-t pt-5">
        <h3 className="font-semibold">{t('reveal.mineTitle')}</h3>
        {mounted ? <RevealMine proposal={proposal} /> : null}
      </div>
    </section>
  );
}
