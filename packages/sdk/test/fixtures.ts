// Offline drand fixtures shared by the SDK tests: the quicknet beacons and tle vectors committed by @arcseal/tlock
// (packages/tlock/test/vectors), BLS-verified there. No test in this package calls the network.
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

type RawBeacon = { round: number; randomness: string; signature: string };
type RawVector = { name: string; round: number; plaintext: string; ciphertext: string };

const raw = read<{ beacons: RawBeacon[] }>('../../tlock/test/vectors/beacons.json').beacons;

/** Committed quicknet beacons (rounds 30,000,000, 31,415,926 and 32,000,000) in the SDK's Beacon shape. */
export const BEACONS = raw.map((b) => ({ round: BigInt(b.round), signature: `0x${b.signature}` as Hex }));

export function beaconFor(round: bigint | number) {
  const beacon = BEACONS.find((b) => b.round === BigInt(round));
  if (!beacon) throw new Error(`no committed beacon for round ${round}`);
  return beacon;
}

/** The drand v1 HTTP body for a committed beacon (unprefixed hex, as the relays serve it). */
export function drandJson(round: bigint | number) {
  const b = raw.find((x) => BigInt(x.round) === BigInt(round));
  if (!b) throw new Error(`no committed beacon for round ${round}`);
  return { round: b.round, randomness: b.randomness, signature: b.signature };
}

/** Ciphertexts written by Go tle v1.2.0, with their plaintexts (0x-hex here). */
export const TLE_VECTORS = read<{ vectors: RawVector[] }>(
  '../../tlock/test/vectors/tle-to-lib.json',
).vectors.map((v) => ({
  name: v.name,
  round: BigInt(v.round),
  plaintext: `0x${v.plaintext}` as Hex,
  ciphertext: `0x${v.ciphertext}` as Hex,
}));
