import { bls12_381 } from '@noble/curves/bls12-381';
import { decryptAge, encryptAge, parseAge } from './age/age-encrypt-decrypt.js';
import { bytesToBinary, hexToBytes } from './bytes.js';
import { createTimelockDecrypter, parseTlockStanza, type TlockBeacon } from './drand/timelock-decrypter.js';
import { createTimelockEncrypter, hashedRoundNumber } from './drand/timelock-encrypter.js';
import { isTlockError, TlockError } from './errors.js';
import { QUICKNET, QUICKNET_DST } from './quicknet.js';

/** A drand quicknet beacon: the round and its 48-byte BLS signature on G1 as hex (with or without `0x`). */
export interface Beacon {
  round: number | bigint;
  signature: string;
}

const MAX_UINT64 = (1n << 64n) - 1n;
const SIGNATURE_HEX = /^(0x)?([0-9a-fA-F]{96})$/;

/**
 * Encrypts `plaintext` so it can only be opened with quicknet's beacon for `round`.
 * Returns the raw binary age file (not armored), the same format `tle` v1.2.0 writes without `-a`.
 * Its length is `plaintext.length + 359` for 8-digit rounds (all rounds from 2024-08 to 2033-02), one byte more or
 * less per extra or missing round digit. No network access: the chain info is pinned.
 */
export async function encrypt(round: number | bigint, plaintext: Uint8Array): Promise<Uint8Array> {
  const roundNumber = toRound(round, 'round');
  if (!(plaintext instanceof Uint8Array))
    throw new TlockError('INVALID_INPUT', 'plaintext must be a Uint8Array');
  return encryptAge(plaintext, createTimelockEncrypter(roundNumber));
}

/**
 * Decrypts a raw binary tlock age file with the beacon of the round it is locked to. No HTTP: the caller fetches
 * the beacon (use `roundOf` to learn which one). Throws TlockError: `ROUND_MISMATCH` for a beacon of another round,
 * `WRONG_BEACON` when the signature does not open the stanza, `WRONG_CHAIN` for a non-quicknet stanza,
 * `MALFORMED_CIPHERTEXT` or `DECRYPTION_FAILED` for bad or tampered bytes, `INVALID_INPUT` for bad arguments.
 */
export async function decrypt(ciphertext: Uint8Array, beacon: Beacon): Promise<Uint8Array> {
  assertCiphertext(ciphertext);
  const parsed = toTlockBeacon(beacon);
  try {
    return await decryptAge(ciphertext, createTimelockDecrypter(parsed));
  } catch (err) {
    if (isTlockError(err)) throw err;
    throw new TlockError('DECRYPTION_FAILED', `decryption failed: ${(err as Error).message}`, { cause: err });
  }
}

/** The drand round a raw tlock ciphertext is locked to. Throws TlockError if it is not a quicknet tlock age file. */
export function roundOf(ciphertext: Uint8Array): bigint {
  assertCiphertext(ciphertext);
  const { header } = parseAge(bytesToBinary(ciphertext));
  return parseTlockStanza(header.recipients).roundNumber;
}

/**
 * Pure BLS check of a beacon against the pinned quicknet public key: the signature must be the G1 signature of
 * sha256(uint64be(round)) under the RFC 9380 hash-to-curve. Returns false for any invalid or malformed beacon.
 */
export function verifyBeacon(beacon: Beacon): boolean {
  let parsed: TlockBeacon;
  try {
    parsed = toTlockBeacon(beacon);
  } catch {
    return false;
  }
  try {
    return bls12_381.verifyShortSignature(
      parsed.signature,
      hashedRoundNumber(parsed.round),
      QUICKNET.publicKey,
      {
        DST: QUICKNET_DST,
      },
    );
  } catch {
    return false;
  }
}

function toRound(value: unknown, name: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return BigInt(value);
  if (typeof value === 'bigint' && value >= 1n && value <= MAX_UINT64) return value;
  throw new TlockError(
    'INVALID_INPUT',
    `${name} must be an integer round in 1..2^64-1, got ${String(value)}`,
  );
}

function toTlockBeacon(beacon: Beacon): TlockBeacon {
  if (typeof beacon !== 'object' || beacon === null) {
    throw new TlockError('INVALID_INPUT', 'beacon must be an object { round, signature }');
  }
  const round = toRound(beacon.round, 'beacon.round');
  const match = typeof beacon.signature === 'string' ? SIGNATURE_HEX.exec(beacon.signature) : null;
  if (!match?.[2]) {
    throw new TlockError(
      'INVALID_INPUT',
      'beacon.signature must be a 48-byte hex string (quicknet G1 signature)',
    );
  }
  return { round, signature: hexToBytes(match[2]) };
}

function assertCiphertext(ciphertext: unknown): asserts ciphertext is Uint8Array {
  if (!(ciphertext instanceof Uint8Array))
    throw new TlockError('INVALID_INPUT', 'ciphertext must be a Uint8Array');
}
