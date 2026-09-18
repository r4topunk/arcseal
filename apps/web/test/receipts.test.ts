import { hashVote, type VoteReceiptInput } from '@arcseal/sdk';
import { getAddress } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkUploadedReceipt, loadReceipt, receiptKey, saveReceipt } from '@/lib/receipts';
import { safeGet, safeSet } from '@/lib/storage';

const DAO = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');
const VOTER = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
const SALT = `0x${'7f'.repeat(32)}` as const;

function receipt(overrides: Partial<VoteReceiptInput> = {}): VoteReceiptInput {
  const base = { proposalId: 3n, voter: VOTER, choice: 'for' as const, salt: SALT };
  return {
    version: 1,
    chainId: 5042,
    dao: DAO,
    ...base,
    commitment: hashVote(base),
    closeRound: 32_000_000n,
    createdAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

const loc = { chainId: 5042, dao: DAO, proposalId: 3n, voter: VOTER };

/** Makes every access to window.localStorage throw, like a browser with site data blocked. */
function disableStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

describe('vote receipts in localStorage', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    if (original) Object.defineProperty(window, 'localStorage', original);
    else Reflect.deleteProperty(window, 'localStorage');
  });

  it('round-trips a receipt keyed by chain, DAO, proposal and voter', () => {
    const saved = saveReceipt(receipt({ txHash: `0x${'ab'.repeat(32)}` }));
    expect(saved.stored).toBe(true);
    expect(window.localStorage.getItem(receiptKey(loc))).toBe(saved.json);
    const back = loadReceipt(loc);
    expect(back).toMatchObject({
      proposalId: 3n,
      voter: VOTER,
      choice: 'for',
      salt: SALT,
      closeRound: 32_000_000n,
    });
    expect(back?.txHash).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('keys addresses case-insensitively and separates voters, proposals and chains', () => {
    saveReceipt(receipt());
    expect(
      loadReceipt({
        ...loc,
        dao: DAO.toLowerCase() as `0x${string}`,
        voter: VOTER.toLowerCase() as `0x${string}`,
      }),
    ).not.toBeNull();
    expect(loadReceipt({ ...loc, proposalId: 4n })).toBeNull();
    expect(loadReceipt({ ...loc, chainId: 5042002 })).toBeNull();
    expect(
      loadReceipt({ ...loc, voter: getAddress('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc') }),
    ).toBeNull();
  });

  it('reports stored: false and never throws when storage is disabled', () => {
    disableStorage();
    expect(() => window.localStorage).toThrow();
    const saved = saveReceipt(receipt());
    expect(saved.stored).toBe(false);
    // The JSON is still returned, so the caller can force the download.
    expect(JSON.parse(saved.json)).toMatchObject({ proposalId: '3', choice: 'for', closeRound: '32000000' });
    expect(loadReceipt(loc)).toBeNull();
    expect(safeGet('anything')).toBeNull();
    expect(safeSet('anything', 'x')).toBe(false);
  });

  it('reports stored: false when setItem throws (quota exceeded)', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => throwing });
    expect(saveReceipt(receipt()).stored).toBe(false);
  });

  it('ignores a corrupted or tampered stored receipt', () => {
    window.localStorage.setItem(receiptKey(loc), '{not json');
    expect(loadReceipt(loc)).toBeNull();
    const tampered = JSON.parse(saveReceipt(receipt()).json);
    tampered.choice = 'against'; // the commitment no longer matches
    window.localStorage.setItem(receiptKey(loc), JSON.stringify(tampered));
    expect(loadReceipt(loc)).toBeNull();
  });

  it('checks an uploaded receipt against this chain, DAO and proposal', () => {
    const json = saveReceipt(receipt()).json;
    const expected = { chainId: 5042, dao: DAO, proposalId: 3n };
    expect(checkUploadedReceipt(json, expected)).toMatchObject({ ok: true, receipt: { choice: 'for' } });
    expect(checkUploadedReceipt('hello', expected)).toEqual({ ok: false, error: 'invalid' });
    expect(checkUploadedReceipt(json, { ...expected, chainId: 5042002 })).toEqual({
      ok: false,
      error: 'wrongChain',
      chainId: 5042,
    });
    expect(checkUploadedReceipt(json, { ...expected, dao: VOTER })).toMatchObject({
      ok: false,
      error: 'wrongDao',
    });
    expect(checkUploadedReceipt(json, { ...expected, proposalId: 9n })).toEqual({
      ok: false,
      error: 'wrongProposal',
      proposalId: 3n,
    });
  });
});
