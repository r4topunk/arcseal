// Zod 4 schemas for every public SDK input. Public functions parse their arguments with these and throw
// InvalidInputError before doing any work, so a bad salt or address never reaches a hash, a cipher or a wallet.
import { type Address, getAddress, type Hex, isAddress } from 'viem';
import { z } from 'zod';
import { InvalidInputError } from './errors.js';

/** Vote choices in Solidity enum order: `enum Choice { Abstain, For, Against }`, so the index is the uint8. */
export const CHOICES = ['abstain', 'for', 'against'] as const;
export type Choice = (typeof CHOICES)[number];

/** Salt length. The SDK refuses anything else: a short salt makes a 3-choice commitment brute-forceable. */
export const SALT_BYTES = 32;
/** Ciphertext bounds enforced by `Sealed._seal` (tlock overhead is 359 bytes; a vote is about 423). */
export const CIPHERTEXT_MIN_BYTES = 359;
export const CIPHERTEXT_MAX_BYTES = 1_024;
/** quicknet signatures are compressed G1 points. */
export const BEACON_SIGNATURE_BYTES = 48;

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_UINT256 = 2n ** 256n - 1n;
const HEX_RE = /^0x[0-9a-fA-F]*$/;
const DECIMAL_RE = /^[0-9]+$/;

/** 0x-prefixed hex of `minBytes..maxBytes` bytes, normalized to lowercase. */
function hexBytes(label: string, minBytes: number, maxBytes: number = minBytes) {
  return z
    .string({ error: `${label} must be a 0x-prefixed hex string` })
    .check((ctx) => {
      const value = ctx.value;
      if (!HEX_RE.test(value) || value.length % 2 !== 0) {
        ctx.issues.push({
          code: 'custom',
          message: `${label} must be 0x-prefixed hex with an even number of digits`,
          input: value,
        });
        return;
      }
      const bytes = (value.length - 2) / 2;
      if (bytes < minBytes || bytes > maxBytes) {
        const expected =
          minBytes === maxBytes ? `exactly ${minBytes} bytes` : `${minBytes}..${maxBytes} bytes`;
        ctx.issues.push({
          code: 'custom',
          message: `${label} must be ${expected}, got ${bytes}`,
          input: value,
        });
      }
    })
    .transform((value) => value.toLowerCase() as Hex);
}

/** Unsigned integer from a bigint, a safe-integer number or a decimal string (JSON form), as bigint. */
function uintSchema(label: string, min: bigint, max: bigint, range: string) {
  return z
    .union([z.bigint(), z.number(), z.string()], {
      error: `${label} must be a bigint, an integer number or a decimal string`,
    })
    .transform((value, ctx) => {
      let n: bigint | undefined;
      if (typeof value === 'bigint') n = value;
      else if (typeof value === 'number') n = Number.isSafeInteger(value) ? BigInt(value) : undefined;
      else n = DECIMAL_RE.test(value) ? BigInt(value) : undefined;
      if (n === undefined) {
        ctx.issues.push({
          code: 'custom',
          message: `${label} must be an integer, got ${String(value)}`,
          input: value,
        });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.issues.push({ code: 'custom', message: `${label} must be in ${range}, got ${n}`, input: value });
        return z.NEVER;
      }
      return n;
    });
}

/** EVM address, lowercase or EIP-55 checksummed (viem's strict rule: a bad checksum is a typo). Checksummed out. */
export const addressSchema = z
  .string({ error: 'address must be a string' })
  .refine((value) => isAddress(value, { strict: true }), {
    error: 'invalid address: expected 0x + 40 hex digits, lowercase or with a valid EIP-55 checksum',
  })
  .transform((value): Address => getAddress(value));

/** Any 0x-prefixed byte string (even number of hex digits), lowercase. */
export const hexSchema = hexBytes('hex', 0, Number.POSITIVE_INFINITY);
/** Exactly 32 bytes: commitments and transaction hashes. */
export const bytes32Schema = hexBytes('bytes32', 32);
/** Vote salt: exactly 32 bytes; shorter and longer values are refused. */
export const saltSchema = hexBytes('salt', SALT_BYTES);
/** Ciphertext accepted by `vote`: 359..1,024 bytes, raw tlock output (not age-armored). */
export const ciphertextSchema = hexBytes('ciphertext', CIPHERTEXT_MIN_BYTES, CIPHERTEXT_MAX_BYTES);
/** quicknet beacon signature: 48 bytes. */
export const beaconSignatureSchema = hexBytes('beacon signature', BEACON_SIGNATURE_BYTES);

export const choiceSchema = z.enum(CHOICES, { error: "choice must be 'abstain', 'for' or 'against'" });
/** Any uint256 value, as bigint. */
export const uint256Schema = uintSchema('value', 0n, MAX_UINT256, 'uint256 (0..2^256-1)');
/** SealedDAO proposal id (uint256), as bigint. */
export const proposalIdSchema = uintSchema('proposalId', 0n, MAX_UINT256, 'uint256 (0..2^256-1)');
/** drand quicknet round (uint64 onchain, starts at 1), as bigint. */
export const roundSchema = uintSchema('round', 1n, MAX_UINT64, '1..2^64-1');
export const chainIdSchema = z.int({ error: 'chainId must be an integer' }).positive();

export const hashVoteInputSchema = z.object({
  proposalId: proposalIdSchema,
  voter: addressSchema,
  choice: choiceSchema,
  salt: saltSchema,
});

export const sealVoteInputSchema = z.object({
  proposalId: proposalIdSchema,
  voter: addressSchema,
  choice: choiceSchema,
  closeRound: roundSchema,
  // An explicit salt is for tests and recovery. All zeros is refused: it would make the sealed vote guessable.
  salt: saltSchema
    .refine((salt) => /[^0]/.test(salt.slice(2)), {
      error: 'salt must not be all zeros; omit it to draw one from the CSPRNG',
    })
    .optional(),
});

export const beaconSchema = z.object({ round: roundSchema, signature: beaconSignatureSchema });

export const unsealVoteInputSchema = z.object({
  // Any hex is accepted here: a ciphertext that is too short or too long simply fails to open (unsealVote -> null).
  ciphertext: hexSchema,
  closeRound: roundSchema,
  beacon: beaconSchema.optional(),
});

/** One decrypted vote to reveal. Any 32-byte salt is accepted here: `revealBatch` checks it against the hash. */
export const revealItemSchema = z.object({
  voter: addressSchema,
  choice: choiceSchema,
  salt: saltSchema,
  commitment: bytes32Schema.optional(),
});

/**
 * Local vote receipt the app keeps (localStorage + downloadable JSON) so a voter can reveal their own vote even
 * when drand is unreachable. proposalId and closeRound are decimal strings in JSON and bigint once parsed.
 */
export const voteReceiptSchema = z.object({
  version: z.literal(1),
  chainId: chainIdSchema,
  dao: addressSchema,
  proposalId: proposalIdSchema,
  voter: addressSchema,
  choice: choiceSchema,
  salt: saltSchema,
  commitment: bytes32Schema,
  closeRound: roundSchema,
  txHash: bytes32Schema.optional(),
  createdAt: z.iso.datetime({ offset: true, error: 'createdAt must be an ISO 8601 date-time' }),
});

/** Inputs of `hashVote`. `proposalId` is a uint256. */
export interface HashVoteInput {
  proposalId: bigint | number;
  voter: Address;
  choice: Choice;
  salt: Hex;
}

/** Inputs of `sealVote`. Without `salt`, a fresh 32-byte CSPRNG salt is drawn. */
export interface SealVoteInput {
  proposalId: bigint | number;
  voter: Address;
  choice: Choice;
  closeRound: bigint | number;
  salt?: Hex | undefined;
}

export interface BeaconInput {
  round: bigint | number;
  signature: Hex;
}

/** Inputs of `unsealVote`. Without `beacon`, the beacon for `closeRound` is fetched from drand. */
export interface UnsealVoteInput {
  ciphertext: Hex;
  closeRound: bigint | number;
  beacon?: BeaconInput | undefined;
}

/** A vote to reveal: who, what and the salt. `commitment` is informative (the contract recomputes it). */
export interface RevealItemInput {
  voter: Address;
  choice: Choice;
  salt: Hex;
  commitment?: Hex | undefined;
}

/** A drand quicknet beacon: the round and its 48-byte BLS signature. */
export type Beacon = z.output<typeof beaconSchema>;
export type VoteReceipt = z.output<typeof voteReceiptSchema>;
/** Receipt as stored or typed by hand: bigints may be decimal strings, addresses any valid case. */
export type VoteReceiptInput = z.input<typeof voteReceiptSchema>;

function formatIssue(issue: z.core.$ZodIssue): string {
  return issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message;
}

/** Parses `input` with `schema` or throws InvalidInputError listing every issue. Internal helper. */
export function parseInput<S extends z.ZodType>(schema: S, input: z.input<S>, what: string): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new InvalidInputError(what, result.error.issues.map(formatIssue), { cause: result.error });
  }
  return result.data;
}
