import { describe, expect, it } from 'vitest';
import { decrypt, QUICKNET, roundOf, verifyBeacon } from '../src/index.js';
import { BEACONS, beaconFor, fromHex, LIB_VECTORS, TLE_VECTORS } from './helpers.js';

// Every vector round has 8 digits, so the measured 359-byte overhead of PRD 9 applies to both implementations.
const OVERHEAD = 359;

describe('committed drand beacons', () => {
  it.each(BEACONS)('round $round verifies against the pinned quicknet key', (beacon) => {
    expect(verifyBeacon(beacon)).toBe(true);
  });
});

describe('tle v1.2.0 -> @arcseal/tlock (decrypted offline with committed beacons)', () => {
  it('covers 3 rounds, the 64-byte DAO payload and the empty edge case', () => {
    expect(new Set(TLE_VECTORS.map((v) => v.round)).size).toBe(3);
    expect(TLE_VECTORS.map((v) => v.plaintext.length / 2)).toContain(64);
    expect(TLE_VECTORS.map((v) => v.plaintext.length / 2)).toContain(0);
  });

  it.each(TLE_VECTORS)('decrypts $name (round $round)', async (vector) => {
    const plaintext = await decrypt(fromHex(vector.ciphertext), beaconFor(vector.round));
    expect(plaintext).toEqual(fromHex(vector.plaintext));
  });
});

describe('@arcseal/tlock -> tle v1.2.0 (tle -d output committed at generation time)', () => {
  it.each(LIB_VECTORS)('tle decrypted $name to the original plaintext', (vector) => {
    expect(vector.tleDecrypted).toBe(vector.plaintext);
  });

  it.each(LIB_VECTORS)('the lib also decrypts its own $name vector', async (vector) => {
    const plaintext = await decrypt(fromHex(vector.ciphertext), beaconFor(vector.round));
    expect(plaintext).toEqual(fromHex(vector.plaintext));
  });
});

describe('format agreement between tle and the lib', () => {
  it.each([...TLE_VECTORS, ...LIB_VECTORS])('$name: roundOf and length = plaintext + 359', (vector) => {
    const ciphertext = fromHex(vector.ciphertext);
    expect(roundOf(ciphertext)).toBe(BigInt(vector.round));
    expect(ciphertext.length).toBe(vector.plaintext.length / 2 + OVERHEAD);
  });

  it('both write the same age header lines up to the stanza body', () => {
    for (const [tle, lib] of TLE_VECTORS.map((v, i) => [v, LIB_VECTORS[i]!] as const)) {
      const prefix = `age-encryption.org/v1\n-> tlock ${tle.round} ${QUICKNET.chainHash}\n`;
      const decode = (hex: string) => new TextDecoder().decode(fromHex(hex).subarray(0, prefix.length));
      expect(decode(tle.ciphertext)).toBe(prefix);
      expect(decode(lib.ciphertext)).toBe(prefix);
    }
  });
});
