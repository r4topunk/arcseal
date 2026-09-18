import { describe, expect, it } from 'vitest';
import {
  hashVote,
  InvalidInputError,
  parseVoteReceipt,
  serializeVoteReceipt,
  type VoteReceiptInput,
  voteReceiptSchema,
} from '../src/index.js';

const voter = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const salt = `0x${'c3'.repeat(32)}` as const;
const receipt: VoteReceiptInput = {
  version: 1,
  chainId: 5042,
  dao: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  proposalId: 2n ** 70n,
  voter,
  choice: 'against',
  salt,
  commitment: hashVote({ proposalId: 2n ** 70n, voter, choice: 'against', salt }),
  closeRound: 33_000_123n,
  createdAt: '2026-09-18T12:00:00.000Z',
};

describe('vote receipt', () => {
  it('serializes to JSON with decimal strings and a fixed key order, and parses back', () => {
    const json = serializeVoteReceipt(receipt);
    const raw = JSON.parse(json);
    expect(Object.keys(raw)).toEqual([
      'version',
      'chainId',
      'dao',
      'proposalId',
      'voter',
      'choice',
      'salt',
      'commitment',
      'closeRound',
      'createdAt',
    ]);
    expect(raw.proposalId).toBe('1180591620717411303424');
    expect(raw.closeRound).toBe('33000123');
    expect(raw.dao).toBe('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
    const parsed = parseVoteReceipt(json);
    expect(parsed.proposalId).toBe(2n ** 70n);
    expect(parsed.closeRound).toBe(33_000_123n);
    expect(parseVoteReceipt(parsed)).toEqual(parsed);
    expect(serializeVoteReceipt(parsed)).toBe(json);
  });

  it('keeps txHash when present', () => {
    const txHash = `0x${'9f'.repeat(32)}` as const;
    const json = serializeVoteReceipt({ ...receipt, txHash });
    expect(JSON.parse(json).txHash).toBe(txHash);
    expect(parseVoteReceipt(json).txHash).toBe(txHash);
  });

  it('rejects a receipt whose commitment does not match its fields', () => {
    expect(() => parseVoteReceipt({ ...receipt, choice: 'for' })).toThrow(/does not match hashVote/);
    expect(() => serializeVoteReceipt({ ...receipt, salt: `0x${'c4'.repeat(32)}` })).toThrow(
      InvalidInputError,
    );
  });

  it('rejects malformed receipts', () => {
    expect(() => parseVoteReceipt('{not json')).toThrow(/not valid JSON/);
    expect(() => parseVoteReceipt({ ...receipt, version: 2 })).toThrow(InvalidInputError);
    expect(() => parseVoteReceipt({ ...receipt, createdAt: 'yesterday' })).toThrow(/createdAt/);
    expect(() => parseVoteReceipt({ ...receipt, salt: `0x${'c3'.repeat(16)}` })).toThrow(
      /salt must be exactly 32/,
    );
    const { salt: _salt, ...withoutSalt } = receipt;
    expect(voteReceiptSchema.safeParse(withoutSalt).success).toBe(false);
    expect(() => parseVoteReceipt(null)).toThrow(InvalidInputError);
  });
});
