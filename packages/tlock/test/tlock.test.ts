import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Beacon,
  decrypt,
  encrypt,
  isTlockError,
  QUICKNET,
  roundOf,
  TlockError,
  type TlockErrorCode,
  verifyBeacon,
} from '../src/index.js';
import {
  BEACON_A,
  BEACON_B,
  beaconFor,
  daoPayload,
  fromHex,
  patchHeader,
  payloadOffset,
  TLE_VECTORS,
} from './helpers.js';

const beaconA: Beacon = { round: BEACON_A.round, signature: BEACON_A.signature };

async function expectTlockError(promise: Promise<unknown> | (() => unknown), code: TlockErrorCode) {
  const run = typeof promise === 'function' ? Promise.resolve().then(promise) : promise;
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TlockError);
  expect((err as TlockError).code).toBe(code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encrypt / decrypt round trip with a committed beacon', () => {
  it('seals and opens the 64-byte DAO vote payload', async () => {
    const plaintext = daoPayload(2, 0xab);
    const ciphertext = await encrypt(BEACON_A.round, plaintext);
    expect(ciphertext.length).toBe(423);
    expect(await decrypt(ciphertext, beaconA)).toEqual(plaintext);
  });

  it('returns plain Uint8Arrays and accepts a Node Buffer as plaintext', async () => {
    const ciphertext = await encrypt(BEACON_A.round, Buffer.from('buffer in, bytes out'));
    const plaintext = await decrypt(ciphertext, beaconA);
    expect(Object.getPrototypeOf(ciphertext)).toBe(Uint8Array.prototype);
    expect(Object.getPrototypeOf(plaintext)).toBe(Uint8Array.prototype);
    expect(new TextDecoder().decode(plaintext)).toBe('buffer in, bytes out');
  });

  it('is randomized: two encryptions of the same input differ and both open', async () => {
    const plaintext = daoPayload(1, 0x11);
    const [a, b] = await Promise.all([
      encrypt(BEACON_A.round, plaintext),
      encrypt(BEACON_A.round, plaintext),
    ]);
    expect(a).not.toEqual(b);
    expect(await decrypt(a, beaconA)).toEqual(plaintext);
    expect(await decrypt(b, beaconA)).toEqual(plaintext);
  });

  it('treats number and bigint rounds alike, and accepts 0x-prefixed or uppercase signatures', async () => {
    const plaintext = new TextEncoder().encode('bigint round');
    const ciphertext = await encrypt(BigInt(BEACON_A.round), plaintext);
    expect(roundOf(ciphertext)).toBe(BigInt(BEACON_A.round));
    const beacon = { round: BigInt(BEACON_A.round), signature: `0x${BEACON_A.signature.toUpperCase()}` };
    expect(await decrypt(ciphertext, beacon)).toEqual(plaintext);
  });

  it('never touches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network is off in tests'));
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(0, 0));
    await decrypt(ciphertext, beaconA);
    roundOf(ciphertext);
    verifyBeacon(beaconA);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ciphertext size (PRD 9: 359 bytes flat overhead)', () => {
  it.each([0, 1, 32, 64, 96, 300, 665])('%i-byte plaintext -> that length + 359 bytes', async (size) => {
    const ciphertext = await encrypt(BEACON_A.round, new Uint8Array(size).fill(7));
    expect(ciphertext.length).toBe(size + 359);
  });

  it('64 bytes -> 423 bytes, and the overhead moves by one byte per round digit', async () => {
    const payload = new Uint8Array(64);
    expect((await encrypt(32_000_000, payload)).length).toBe(423);
    expect((await encrypt(9_999_999, payload)).length).toBe(422);
    expect((await encrypt(100_000_000, payload)).length).toBe(424);
  });
});

describe('empty plaintext', () => {
  it('encrypts to a 359-byte age file with one empty final chunk and decrypts to empty', async () => {
    const ciphertext = await encrypt(BEACON_A.round, new Uint8Array(0));
    expect(ciphertext.length).toBe(359);
    expect(await decrypt(ciphertext, beaconA)).toEqual(new Uint8Array(0));
  });

  it('decrypts the 359-byte empty file written by tle', async () => {
    const vector = TLE_VECTORS.find((v) => v.name === 'empty')!;
    const ciphertext = fromHex(vector.ciphertext);
    expect(ciphertext.length).toBe(359);
    expect(await decrypt(ciphertext, beaconFor(vector.round))).toEqual(new Uint8Array(0));
  });

  it('rejects a file with no final chunk, which is what upstream wrote for an empty plaintext', async () => {
    const ciphertext = await encrypt(BEACON_A.round, new Uint8Array(0));
    const upstreamShape = ciphertext.subarray(0, ciphertext.length - 16); // header + nonce, no chunk (343 bytes)
    await expectTlockError(decrypt(upstreamShape, beaconA), 'DECRYPTION_FAILED');
  });
});

describe('roundOf', () => {
  it('reads the round from lib and tle ciphertexts without a beacon', async () => {
    expect(roundOf(await encrypt(123_456_789n, new Uint8Array(4)))).toBe(123_456_789n);
    for (const vector of TLE_VECTORS) expect(roundOf(fromHex(vector.ciphertext))).toBe(BigInt(vector.round));
  });

  it('rejects garbage, other chains and malformed round numbers', async () => {
    const ciphertext = await encrypt(BEACON_A.round, new Uint8Array(64));
    await expectTlockError(() => roundOf(new Uint8Array(0)), 'MALFORMED_CIPHERTEXT');
    await expectTlockError(
      () => roundOf(crypto.getRandomValues(new Uint8Array(423))),
      'MALFORMED_CIPHERTEXT',
    );
    const otherChain = patchHeader(ciphertext, QUICKNET.chainHash.slice(0, 8), 'dbd506d6');
    await expectTlockError(() => roundOf(otherChain), 'WRONG_CHAIN');
    await expectTlockError(
      () => roundOf(patchHeader(ciphertext, '30000000', '3000000x')),
      'MALFORMED_CIPHERTEXT',
    );
    await expectTlockError(
      () => roundOf(patchHeader(ciphertext, '30000000', '00000000')),
      'MALFORMED_CIPHERTEXT',
    );
  });
});

describe('decrypt failures are typed', () => {
  it('ROUND_MISMATCH for a beacon of another round', async () => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    await expectTlockError(
      decrypt(ciphertext, { round: BEACON_B.round, signature: BEACON_B.signature }),
      'ROUND_MISMATCH',
    );
  });

  it('WRONG_BEACON for another round signature presented as the right round', async () => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    await expectTlockError(
      decrypt(ciphertext, { round: BEACON_A.round, signature: BEACON_B.signature }),
      'WRONG_BEACON',
    );
  });

  it('WRONG_BEACON for a signature that is not a G1 point', async () => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    await expectTlockError(
      decrypt(ciphertext, { round: BEACON_A.round, signature: 'ab'.repeat(48) }),
      'WRONG_BEACON',
    );
  });

  it('INVALID_INPUT for malformed beacons and arguments', async () => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    await expectTlockError(
      decrypt(ciphertext, { round: BEACON_A.round, signature: 'abcd' }),
      'INVALID_INPUT',
    );
    await expectTlockError(decrypt(ciphertext, { round: 0, signature: BEACON_A.signature }), 'INVALID_INPUT');
    await expectTlockError(decrypt(ciphertext, null as unknown as Beacon), 'INVALID_INPUT');
    await expectTlockError(decrypt('age' as unknown as Uint8Array, beaconA), 'INVALID_INPUT');
  });

  it.each([
    ['cut by 1 byte', (c: Uint8Array) => c.subarray(0, c.length - 1), 'DECRYPTION_FAILED'],
    ['cut to header + nonce', (c: Uint8Array) => c.subarray(0, payloadOffset(c) + 16), 'DECRYPTION_FAILED'],
    ['cut inside the nonce', (c: Uint8Array) => c.subarray(0, payloadOffset(c) + 5), 'DECRYPTION_FAILED'],
    ['cut inside the header', (c: Uint8Array) => c.subarray(0, 200), 'MALFORMED_CIPHERTEXT'],
    ['cut to nothing', (c: Uint8Array) => c.subarray(0, 0), 'MALFORMED_CIPHERTEXT'],
  ] as const)('truncated ciphertext (%s) fails with %s', async (_label, cut, code) => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    await expectTlockError(decrypt(cut(ciphertext), beaconA), code);
  });

  it('garbage ciphertext fails as MALFORMED_CIPHERTEXT', async () => {
    await expectTlockError(
      decrypt(crypto.getRandomValues(new Uint8Array(423)), beaconA),
      'MALFORMED_CIPHERTEXT',
    );
    const junkAfterVersion = new TextEncoder().encode(
      'age-encryption.org/v1\n-> tlock 30000000\nnot base64!\n',
    );
    await expectTlockError(decrypt(junkAfterVersion, beaconA), 'MALFORMED_CIPHERTEXT');
  });

  it('armored text is not accepted (raw bytes only)', async () => {
    const armored = new TextEncoder().encode(
      '-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n',
    );
    await expectTlockError(decrypt(armored, beaconA), 'MALFORMED_CIPHERTEXT');
  });

  it('WRONG_CHAIN for a stanza that names another drand chain', async () => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    await expectTlockError(
      decrypt(patchHeader(ciphertext, QUICKNET.chainHash, 'f'.repeat(64)), beaconA),
      'WRONG_CHAIN',
    );
  });

  it('tampering is detected: payload byte, header MAC and stanza body', async () => {
    const ciphertext = await encrypt(BEACON_A.round, daoPayload(1, 1));
    const payload = ciphertext.slice();
    payload[payload.length - 20]! ^= 1;
    await expectTlockError(decrypt(payload, beaconA), 'DECRYPTION_FAILED');

    const mac = ciphertext.slice();
    const macChar = payloadOffset(mac) - 10; // a middle MAC char: every bit counts, so the base64 stays canonical
    mac[macChar] = mac[macChar] === 0x41 ? 0x42 : 0x41;
    await expectTlockError(decrypt(mac, beaconA), 'DECRYPTION_FAILED');

    const bodyStart = new TextDecoder().decode(ciphertext).indexOf(QUICKNET.chainHash) + 65;
    const body = ciphertext.slice();
    const wChar = bodyStart + 65 + 65 + 40; // base64 char 168 of 171 on the third body line: a W byte
    body[wChar] = body[wChar] === 0x41 ? 0x42 : 0x41;
    await expectTlockError(decrypt(body, beaconA), 'WRONG_BEACON');
  });
});

describe('encrypt input validation', () => {
  it.each([0, -1, 1.5, Number.NaN, 2 ** 53, 0n, 2n ** 64n, '30000000'])('rejects round %s', async (round) => {
    await expectTlockError(encrypt(round as number, new Uint8Array(1)), 'INVALID_INPUT');
  });

  it('rejects a non-Uint8Array plaintext and accepts the largest uint64 round', async () => {
    await expectTlockError(encrypt(BEACON_A.round, 'text' as unknown as Uint8Array), 'INVALID_INPUT');
    expect(roundOf(await encrypt(2n ** 64n - 1n, new Uint8Array(1)))).toBe(2n ** 64n - 1n);
  });
});

describe('verifyBeacon and isTlockError', () => {
  it('rejects a signature for another round, a flipped bit and malformed input without throwing', () => {
    expect(verifyBeacon(beaconA)).toBe(true);
    expect(verifyBeacon({ round: BEACON_B.round, signature: BEACON_A.signature })).toBe(false);
    const flipped = `${BEACON_A.signature.slice(0, -1)}${BEACON_A.signature.endsWith('0') ? '1' : '0'}`;
    expect(verifyBeacon({ round: BEACON_A.round, signature: flipped })).toBe(false);
    expect(verifyBeacon({ round: BEACON_A.round, signature: 'zz' })).toBe(false);
    expect(verifyBeacon({ round: -1, signature: BEACON_A.signature })).toBe(false);
  });

  it('recognizes TlockError by class and by shape', () => {
    const err = new TlockError('WRONG_BEACON', 'x');
    expect(isTlockError(err)).toBe(true);
    expect(isTlockError(Object.assign(new Error('y'), { name: 'TlockError', code: 'WRONG_BEACON' }))).toBe(
      true,
    );
    expect(isTlockError(new Error('z'))).toBe(false);
  });
});
