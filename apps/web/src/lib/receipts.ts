// Local vote receipts (PRD 6): what a voter keeps after sealing, so they can reveal their own vote even when drand is
// unreachable. Stored in localStorage keyed by chain, DAO, proposal and voter; always offered as a JSON download too.
import {
  parseVoteReceipt,
  serializeVoteReceipt,
  type VoteReceipt,
  type VoteReceiptInput,
} from '@arcseal/sdk';
import type { Address } from 'viem';
import { safeGet, safeSet } from './storage';

export interface ReceiptLocation {
  chainId: number;
  dao: Address;
  proposalId: bigint;
  voter: Address;
}

/** `arcseal:receipt:v1:<chainId>:<dao>:<proposalId>:<voter>`, addresses lowercased so checksum case never matters. */
export function receiptKey(loc: ReceiptLocation): string {
  return `arcseal:receipt:v1:${loc.chainId}:${loc.dao.toLowerCase()}:${loc.proposalId}:${loc.voter.toLowerCase()}`;
}

/**
 * Validates and serializes a receipt, then tries to store it. `stored` is false when storage is unavailable: the
 * caller must then force the download, or the voter loses the only offline way to reveal.
 */
export function saveReceipt(receipt: VoteReceiptInput): {
  stored: boolean;
  json: string;
  receipt: VoteReceipt;
} {
  const json = serializeVoteReceipt(receipt);
  const parsed = parseVoteReceipt(json);
  const stored = safeSet(
    receiptKey({
      chainId: parsed.chainId,
      dao: parsed.dao,
      proposalId: parsed.proposalId,
      voter: parsed.voter,
    }),
    json,
  );
  return { stored, json, receipt: parsed };
}

/** The stored receipt for this location, or null when absent, unreadable, corrupted or for another location. */
export function loadReceipt(loc: ReceiptLocation): VoteReceipt | null {
  const raw = safeGet(receiptKey(loc));
  if (!raw) return null;
  try {
    const r = parseVoteReceipt(raw);
    const same =
      r.chainId === loc.chainId &&
      r.dao.toLowerCase() === loc.dao.toLowerCase() &&
      r.proposalId === loc.proposalId &&
      r.voter.toLowerCase() === loc.voter.toLowerCase();
    return same ? r : null;
  } catch {
    return null;
  }
}

export type UploadedReceipt =
  | { ok: true; receipt: VoteReceipt }
  | { ok: false; error: 'invalid' }
  | { ok: false; error: 'wrongChain'; chainId: number }
  | { ok: false; error: 'wrongDao'; dao: Address }
  | { ok: false; error: 'wrongProposal'; proposalId: bigint };

/** Parses an uploaded receipt file and checks it belongs to this chain, DAO and proposal. */
export function checkUploadedReceipt(
  text: string,
  expected: { chainId: number; dao: Address; proposalId: bigint },
): UploadedReceipt {
  let receipt: VoteReceipt;
  try {
    receipt = parseVoteReceipt(text);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (receipt.chainId !== expected.chainId)
    return { ok: false, error: 'wrongChain', chainId: receipt.chainId };
  if (receipt.dao.toLowerCase() !== expected.dao.toLowerCase())
    return { ok: false, error: 'wrongDao', dao: receipt.dao };
  if (receipt.proposalId !== expected.proposalId)
    return { ok: false, error: 'wrongProposal', proposalId: receipt.proposalId };
  return { ok: true, receipt };
}

export function receiptFileName(r: { chainId: number; proposalId: bigint; voter: Address }): string {
  return `arcseal-receipt-${r.chainId}-proposal-${r.proposalId}-${r.voter.slice(0, 8).toLowerCase()}.json`;
}

/** Starts a browser download of `text` as a file. */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
