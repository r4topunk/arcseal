import { describe, expect, it } from 'vitest';
import {
  addressSchema,
  beaconSchema,
  bytes32Schema,
  CIPHERTEXT_MAX_BYTES,
  CIPHERTEXT_MIN_BYTES,
  chainIdSchema,
  choiceSchema,
  ciphertextSchema,
  hashVoteInputSchema,
  hexSchema,
  proposalIdSchema,
  roundSchema,
  saltSchema,
  sealVoteInputSchema,
  unsealVoteInputSchema,
} from '../src/index.js';

const hexOf = (bytes: number) => `0x${'5a'.repeat(bytes)}`;
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('schemas', () => {
  it('address: lowercase or valid EIP-55 checksum (viem strict); output is checksummed', () => {
    expect(addressSchema.parse('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')).toBe(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
    expect(ok(addressSchema, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe(true);
    expect(ok(addressSchema, '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266')).toBe(false); // viem rejects all-caps too
    expect(ok(addressSchema, '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe(false); // bad checksum
    expect(ok(addressSchema, '0xf39fd6e51aad88f6f4ce6ab8827279cfffb9226')).toBe(false); // 39 hex digits
    expect(ok(addressSchema, 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266')).toBe(false); // no 0x
    expect(ok(addressSchema, 42)).toBe(false);
  });

  it('salt and bytes32: exactly 32 bytes, lowercased', () => {
    expect(saltSchema.parse(`0x${'AB'.repeat(32)}`)).toBe(`0x${'ab'.repeat(32)}`);
    expect(ok(saltSchema, hexOf(31))).toBe(false);
    expect(ok(saltSchema, hexOf(33))).toBe(false);
    expect(ok(saltSchema, `0x${'5'.repeat(63)}`)).toBe(false);
    expect(ok(bytes32Schema, hexOf(32))).toBe(true);
    expect(ok(bytes32Schema, '5a'.repeat(32))).toBe(false);
  });

  it(`ciphertext: ${CIPHERTEXT_MIN_BYTES}..${CIPHERTEXT_MAX_BYTES} bytes, like Sealed._seal`, () => {
    expect(ok(ciphertextSchema, hexOf(CIPHERTEXT_MIN_BYTES - 1))).toBe(false);
    expect(ok(ciphertextSchema, hexOf(CIPHERTEXT_MIN_BYTES))).toBe(true);
    expect(ok(ciphertextSchema, hexOf(423))).toBe(true);
    expect(ok(ciphertextSchema, hexOf(CIPHERTEXT_MAX_BYTES))).toBe(true);
    expect(ok(ciphertextSchema, hexOf(CIPHERTEXT_MAX_BYTES + 1))).toBe(false);
    const issue = ciphertextSchema.safeParse(hexOf(10)).error?.issues[0]?.message;
    expect(issue).toBe('ciphertext must be 359..1024 bytes, got 10');
  });

  it('hex: any even-length 0x byte string, including empty', () => {
    expect(ok(hexSchema, '0x')).toBe(true);
    expect(ok(hexSchema, hexOf(2_000))).toBe(true);
    expect(ok(hexSchema, '0x1')).toBe(false);
    expect(ok(hexSchema, '0xg0')).toBe(false);
  });

  it('proposalId: uint256 from bigint, safe integer or decimal string', () => {
    expect(proposalIdSchema.parse(0)).toBe(0n);
    expect(proposalIdSchema.parse('42')).toBe(42n);
    expect(proposalIdSchema.parse((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
    for (const bad of [-1, -1n, 2n ** 256n, 1.5, 2 ** 60, '0x10', '1e3', '', null]) {
      expect(ok(proposalIdSchema, bad)).toBe(false);
    }
  });

  it('round: 1..2^64-1', () => {
    expect(roundSchema.parse(1)).toBe(1n);
    expect(roundSchema.parse('33000000')).toBe(33_000_000n);
    expect(roundSchema.parse(2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
    expect(ok(roundSchema, 0)).toBe(false);
    expect(ok(roundSchema, 2n ** 64n)).toBe(false);
  });

  it('choice and chainId', () => {
    for (const c of ['abstain', 'for', 'against']) expect(ok(choiceSchema, c)).toBe(true);
    for (const c of ['For', 'yes', 1, '']) expect(ok(choiceSchema, c)).toBe(false);
    expect(ok(chainIdSchema, 5042)).toBe(true);
    expect(ok(chainIdSchema, 5_042_002)).toBe(true);
    expect(ok(chainIdSchema, 0)).toBe(false);
    expect(ok(chainIdSchema, '5042')).toBe(false);
  });

  it('input objects: hashVote, sealVote (optional non-zero salt), beacon, unsealVote', () => {
    const voter = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
    const salt = hexOf(32);
    expect(hashVoteInputSchema.parse({ proposalId: 7, voter, choice: 'against', salt })).toEqual({
      proposalId: 7n,
      voter: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      choice: 'against',
      salt,
    });
    expect(ok(hashVoteInputSchema, { proposalId: 7, voter, choice: 'against' })).toBe(false);
    expect(ok(sealVoteInputSchema, { proposalId: 7, voter, choice: 'for', closeRound: 5 })).toBe(true);
    expect(ok(sealVoteInputSchema, { proposalId: 7, voter, choice: 'for', closeRound: 5, salt })).toBe(true);
    expect(
      ok(sealVoteInputSchema, { proposalId: 7, voter, choice: 'for', closeRound: 5, salt: hexOf(0) }),
    ).toBe(false);
    expect(beaconSchema.parse({ round: 5, signature: hexOf(48), randomness: '00' })).toEqual({
      round: 5n,
      signature: hexOf(48),
    });
    expect(ok(beaconSchema, { round: 5, signature: hexOf(96) })).toBe(false);
    // unsealVote accepts any hex ciphertext: an out-of-bounds one just fails to open (null), it is not a caller bug.
    expect(ok(unsealVoteInputSchema, { ciphertext: hexOf(12), closeRound: 5 })).toBe(true);
    expect(ok(unsealVoteInputSchema, { ciphertext: hexOf(12), closeRound: 0 })).toBe(false);
  });
});
