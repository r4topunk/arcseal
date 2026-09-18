import { readFileSync } from 'node:fs';
import { encrypt, roundOf } from '@arcseal/tlock';
import { bytesToHex, type Hex, hexToBytes } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  type Choice,
  choiceFromIndex,
  choiceToIndex,
  DrandFetchError,
  decodeVotePlaintext,
  encodeVotePlaintext,
  generateSalt,
  hashVote,
  InvalidInputError,
  sealVote,
  unsealVote,
  VOTE_PLAINTEXT_BYTES,
} from '../src/index.js';
import { BEACONS, beaconFor, drandJson, TLE_VECTORS } from './fixtures.js';

// Also read by the Foundry FFI test: SealedDAO.hashVote and the SDK must agree on every vector.
type HashVector = { proposalId: string; voter: Hex; choice: number; salt: Hex; commitment: Hex };
const HASHVOTE = JSON.parse(
  readFileSync(new URL('../../../contracts/test/vectors/hashvote.json', import.meta.url), 'utf8'),
) as { vectors: HashVector[] };

const VOTER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SALT: Hex = `0x${'ab'.repeat(32)}`;
const ZERO_SALT: Hex = `0x${'00'.repeat(32)}`;
const base = { proposalId: 1n, voter: VOTER, choice: 'for', salt: SALT } as const;

const expectInvalid = (fn: () => unknown, match: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInputError);
    expect((e as InvalidInputError).code).toBe('INVALID_INPUT');
    expect((e as Error).message).toMatch(match);
    return;
  }
  throw new Error('expected InvalidInputError');
};

describe('hashVote vectors (contracts/test/vectors/hashvote.json)', () => {
  it('has 10 vectors covering the edges: id 0 and 2^256-1, every choice, zero and 0xff salts', () => {
    const v = HASHVOTE.vectors;
    expect(v).toHaveLength(10);
    const ids = v.map((x) => BigInt(x.proposalId));
    expect(ids).toContain(0n);
    expect(ids).toContain(2n ** 256n - 1n);
    expect(new Set(v.map((x) => x.choice))).toEqual(new Set([0, 1, 2]));
    expect(v.map((x) => x.salt)).toContain(ZERO_SALT);
    expect(v.map((x) => x.salt)).toContain(`0x${'ff'.repeat(32)}`);
    expect(new Set(v.map((x) => x.commitment)).size).toBe(10);
  });

  it.each(HASHVOTE.vectors)('id $proposalId, choice $choice -> $commitment', (v) => {
    const input = {
      proposalId: BigInt(v.proposalId),
      voter: v.voter,
      choice: choiceFromIndex(v.choice),
      salt: v.salt,
    };
    expect(hashVote(input)).toBe(v.commitment);
    // Address case and salt case do not change the encoding.
    expect(
      hashVote({
        ...input,
        voter: v.voter.toLowerCase() as Hex,
        salt: v.salt.toUpperCase().replace('0X', '0x') as Hex,
      }),
    ).toBe(v.commitment);
  });
});

describe('hashVote', () => {
  it('domain-separates on proposalId, voter, choice and salt', () => {
    const h = hashVote(base);
    const variants = [
      hashVote({ ...base, proposalId: 2n }),
      hashVote({ ...base, voter: OTHER }),
      hashVote({ ...base, choice: 'against' }),
      hashVote({ ...base, choice: 'abstain' }),
      hashVote({ ...base, salt: `0x${'ab'.repeat(31)}ac` }),
    ];
    expect(new Set([h, ...variants]).size).toBe(6);
    expect(hashVote({ ...base, proposalId: 1 })).toBe(h); // number and bigint ids encode the same
  });

  it('refuses salts that are not exactly 32 bytes', () => {
    expectInvalid(
      () => hashVote({ ...base, salt: `0x${'ab'.repeat(31)}` }),
      /salt must be exactly 32 bytes, got 31/,
    );
    expectInvalid(
      () => hashVote({ ...base, salt: `0x${'ab'.repeat(33)}` }),
      /salt must be exactly 32 bytes, got 33/,
    );
    expectInvalid(() => hashVote({ ...base, salt: '0x' }), /got 0/);
    expectInvalid(() => hashVote({ ...base, salt: `0x${'a'.repeat(63)}` }), /even number of digits/);
    expectInvalid(() => hashVote({ ...base, salt: `0x${'zz'.repeat(32)}` }), /hex/);
  });

  it('refuses ids outside uint256, bad addresses and unknown choices', () => {
    expectInvalid(() => hashVote({ ...base, proposalId: -1n }), /proposalId must be in uint256/);
    expectInvalid(() => hashVote({ ...base, proposalId: 2n ** 256n }), /proposalId must be in uint256/);
    expectInvalid(() => hashVote({ ...base, proposalId: 1.5 }), /proposalId must be an integer/);
    expectInvalid(
      () => hashVote({ ...base, voter: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }),
      /checksum/,
    );
    expectInvalid(() => hashVote({ ...base, voter: '0x1234' }), /invalid address/);
    expectInvalid(() => hashVote({ ...base, choice: 'yes' as Choice }), /choice must be/);
  });
});

describe('choice codec', () => {
  it('maps abstain/for/against to the Solidity enum 0/1/2 and back', () => {
    expect(['abstain', 'for', 'against'].map((c) => choiceToIndex(c as Choice))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((i) => choiceFromIndex(i))).toEqual(['abstain', 'for', 'against']);
    expect(choiceFromIndex(2n)).toBe('against');
  });

  it('rejects indexes outside 0..2', () => {
    for (const bad of [3, -1, 1.5, 3n, Number.NaN]) expect(() => choiceFromIndex(bad)).toThrow(RangeError);
    expectInvalid(() => choiceToIndex('For' as Choice), /choice must be/);
  });
});

describe('generateSalt', () => {
  it('returns 32 lowercase random bytes, different every call', () => {
    const salts = Array.from({ length: 64 }, generateSalt);
    for (const s of salts) expect(s).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Set(salts).size).toBe(64);
    expect(hashVote({ ...base, salt: salts[0]! })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('vote plaintext', () => {
  it('encodes abi.encode(uint8 choice, bytes32 salt) as 64 bytes and round-trips every choice', () => {
    for (const [i, choice] of (['abstain', 'for', 'against'] as const).entries()) {
      const plaintext = encodeVotePlaintext(choice, SALT);
      expect(hexToBytes(plaintext)).toHaveLength(VOTE_PLAINTEXT_BYTES);
      expect(plaintext).toBe(`0x${'00'.repeat(31)}0${i}${'ab'.repeat(32)}`);
      expect(decodeVotePlaintext(plaintext)).toEqual({ choice, salt: SALT });
      expect(decodeVotePlaintext(hexToBytes(plaintext))).toEqual({ choice, salt: SALT });
    }
  });

  it('decodes an all-zero plaintext as a harmless abstain', () => {
    expect(decodeVotePlaintext(new Uint8Array(64))).toEqual({ choice: 'abstain', salt: ZERO_SALT });
  });

  it('returns null for wrong lengths, choice > 2, a dirty uint8 word and non-hex input', () => {
    const good = hexToBytes(encodeVotePlaintext('for', SALT));
    expect(decodeVotePlaintext(good.subarray(0, 63))).toBeNull();
    expect(decodeVotePlaintext(new Uint8Array([...good, 0]))).toBeNull();
    expect(decodeVotePlaintext(new Uint8Array(0))).toBeNull();
    const choice3 = good.slice();
    choice3[31] = 3;
    expect(decodeVotePlaintext(choice3)).toBeNull();
    const dirty = good.slice();
    dirty[0] = 1;
    expect(decodeVotePlaintext(bytesToHex(dirty))).toBeNull();
    expect(decodeVotePlaintext('0x1234' as Hex)).toBeNull();
    expect(decodeVotePlaintext(`0x${'g'.repeat(128)}` as Hex)).toBeNull();
    expect(decodeVotePlaintext(`${bytesToHex(good)}0` as Hex)).toBeNull();
  });

  it('validates choice and salt when encoding', () => {
    expectInvalid(() => encodeVotePlaintext('for', `0x${'ab'.repeat(16)}`), /salt must be exactly 32 bytes/);
    expectInvalid(() => encodeVotePlaintext('maybe' as Choice, SALT), /choice must be/);
  });
});

describe('sealVote / unsealVote', () => {
  const [first, second] = BEACONS as [(typeof BEACONS)[0], (typeof BEACONS)[0]];
  const sealInput = { proposalId: 7n, voter: VOTER, choice: 'for', closeRound: first.round } as const;
  const noFetch = () => {
    throw new Error('unexpected drand fetch');
  };

  it('validate their input first', async () => {
    await expect(sealVote({ ...sealInput, salt: `0x${'ab'.repeat(31)}` })).rejects.toThrow(
      /salt must be exactly 32/,
    );
    await expect(sealVote({ ...sealInput, salt: ZERO_SALT })).rejects.toThrow(/must not be all zeros/);
    await expect(sealVote({ ...sealInput, closeRound: 0n })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(unsealVote({ ciphertext: '0xzz' as Hex, closeRound: 1n })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(
      unsealVote({ ciphertext: '0x11', closeRound: 1n, beacon: { round: 1n, signature: '0x1234' } }),
    ).rejects.toThrow(/beacon signature must be exactly 48 bytes/);
  });

  it('seal: 423-byte raw tlock ciphertext locked to closeRound, 64-byte plaintext, commitment = hashVote', async () => {
    const sealed = await sealVote({ ...sealInput, salt: SALT });
    expect(sealed.salt).toBe(SALT);
    expect(sealed.plaintext).toBe(encodeVotePlaintext('for', SALT));
    expect(sealed.commitment).toBe(hashVote({ proposalId: 7n, voter: VOTER, choice: 'for', salt: SALT }));
    const bytes = hexToBytes(sealed.ciphertext);
    expect(bytes).toHaveLength(VOTE_PLAINTEXT_BYTES + 359);
    expect(new TextDecoder().decode(bytes.subarray(0, 22))).toBe('age-encryption.org/v1\n');
    expect(roundOf(bytes)).toBe(first.round);
    // Encryption is randomized: the same vote seals to a different ciphertext every time.
    expect((await sealVote({ ...sealInput, salt: SALT })).ciphertext).not.toBe(sealed.ciphertext);
  });

  it('seal draws a fresh CSPRNG salt when none is given', async () => {
    const a = await sealVote(sealInput);
    const b = await sealVote(sealInput);
    expect(a.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.salt).not.toBe(b.salt);
    expect(a.commitment).toBe(hashVote({ ...sealInput, salt: a.salt }));
  });

  it.each(['abstain', 'for', 'against'] as const)(
    'round trip with a committed beacon: %s',
    async (choice) => {
      const sealed = await sealVote({ ...sealInput, choice });
      const opened = await unsealVote(
        { ciphertext: sealed.ciphertext, closeRound: first.round, beacon: first },
        { fetch: noFetch },
      );
      expect(opened).toEqual({ choice, salt: sealed.salt });
      expect(hashVote({ proposalId: 7n, voter: VOTER, ...opened! })).toBe(sealed.commitment);
    },
  );

  it('opens a vote sealed by Go tle v1.2.0 (dao-vote-for vector)', async () => {
    const vector = TLE_VECTORS.find((v) => v.name === 'dao-vote-for')!;
    const opened = await unsealVote({
      ciphertext: vector.ciphertext,
      closeRound: vector.round,
      beacon: beaconFor(vector.round),
    });
    expect(opened).toEqual(decodeVotePlaintext(vector.plaintext));
    expect(opened?.choice).toBe('for');
  });

  it('fetches the close-round beacon when none is given, after checking the round', async () => {
    const sealed = await sealVote(sealInput);
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => drandJson(first.round) }));
    const opened = await unsealVote({ ciphertext: sealed.ciphertext, closeRound: first.round }, { fetch });
    expect(opened?.choice).toBe('for');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.at(0))).toMatch(new RegExp(`/public/${first.round}$`));
  });

  it('wrong beacon -> null (signature of another round, or a beacon for another round)', async () => {
    const { ciphertext } = await sealVote(sealInput);
    const wrongSignature = { round: first.round, signature: second.signature };
    expect(await unsealVote({ ciphertext, closeRound: first.round, beacon: wrongSignature })).toBeNull();
    expect(await unsealVote({ ciphertext, closeRound: first.round, beacon: second })).toBeNull();
  });

  it('round mismatch between the ciphertext and closeRound -> null, and nothing is fetched', async () => {
    const { ciphertext } = await sealVote(sealInput);
    const fetch = vi.fn(noFetch);
    expect(await unsealVote({ ciphertext, closeRound: second.round }, { fetch })).toBeNull();
    expect(await unsealVote({ ciphertext, closeRound: second.round, beacon: second })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('truncated ciphertext -> null', async () => {
    const { ciphertext } = await sealVote(sealInput);
    const bytes = hexToBytes(ciphertext);
    for (const cut of [bytes.length - 1, bytes.length - 16, 359, 200, 30, 0]) {
      const truncated = bytesToHex(bytes.subarray(0, cut));
      expect(await unsealVote({ ciphertext: truncated, closeRound: first.round, beacon: first })).toBeNull();
    }
  });

  it('garbage and tampered ciphertexts -> null', async () => {
    const { ciphertext } = await sealVote(sealInput);
    const random = bytesToHex(crypto.getRandomValues(new Uint8Array(423)));
    const tampered = hexToBytes(ciphertext);
    tampered[tampered.length - 5]! ^= 0x01;
    for (const bad of [random, '0x' as Hex, bytesToHex(tampered), `0x${'00'.repeat(423)}` as Hex]) {
      expect(
        await unsealVote({ ciphertext: bad, closeRound: first.round, beacon: first }, { fetch: noFetch }),
      ).toBeNull();
    }
  });

  it('a plaintext that is not a vote -> null (choice > 2, wrong length, dirty uint8 word)', async () => {
    const good = hexToBytes(encodeVotePlaintext('for', SALT));
    const choice3 = good.slice();
    choice3[31] = 3;
    const dirty = good.slice();
    dirty[0] = 1;
    for (const plaintext of [choice3, dirty, good.subarray(0, 63), new Uint8Array(96)]) {
      const ciphertext = bytesToHex(await encrypt(first.round, plaintext));
      expect(await unsealVote({ ciphertext, closeRound: first.round, beacon: first })).toBeNull();
    }
  });

  it('a drand outage throws DrandFetchError instead of returning null', async () => {
    const { ciphertext } = await sealVote(sealInput);
    const fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(unsealVote({ ciphertext, closeRound: first.round }, { fetch })).rejects.toBeInstanceOf(
      DrandFetchError,
    );
  });
});
