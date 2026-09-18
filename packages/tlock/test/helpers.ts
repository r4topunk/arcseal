import { hexToBytes } from '@noble/hashes/utils';
import beaconsFile from './vectors/beacons.json';
import libToTle from './vectors/lib-to-tle.json';
import tleToLib from './vectors/tle-to-lib.json';

export const fromHex = (hex: string): Uint8Array => hexToBytes(hex);

export const BEACONS = beaconsFile.beacons;
export const [BEACON_A, BEACON_B, BEACON_C] = BEACONS as [
  (typeof BEACONS)[number],
  (typeof BEACONS)[number],
  (typeof BEACONS)[number],
];

export const TLE_VECTORS = tleToLib.vectors;
export const LIB_VECTORS = libToTle.vectors;

export function beaconFor(round: number): { round: number; signature: string } {
  const beacon = BEACONS.find((b) => b.round === round);
  if (!beacon) throw new Error(`no committed beacon for round ${round}`);
  return { round: beacon.round, signature: beacon.signature };
}

/** abi.encode(uint8 choice, bytes32 salt), the 64-byte SealedDAO vote payload. */
export function daoPayload(choice: number, fill: number): Uint8Array {
  const out = new Uint8Array(64).fill(fill, 32);
  out[31] = choice;
  return out;
}

/** Byte offset just after the `--- <mac>\n` line, i.e. where the age payload (nonce || STREAM) starts. */
export function payloadOffset(ciphertext: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(ciphertext);
  const mac = text.indexOf('\n--- ');
  return text.indexOf('\n', mac + 1) + 1;
}

/** Replaces the first occurrence of `from` with `to` (same length) in the ASCII header. */
export function patchHeader(ciphertext: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error('patchHeader keeps the length');
  const at = new TextDecoder('latin1').decode(ciphertext).indexOf(from);
  if (at < 0) throw new Error(`${from} not in header`);
  const out = ciphertext.slice();
  out.set(new TextEncoder().encode(to), at);
  return out;
}
