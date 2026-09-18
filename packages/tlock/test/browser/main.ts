// Browser smoke page (PRD 8.2): built by Vite with a default config and no polyfills, run by smoke.test.ts in
// headless Chromium. Writes PASS or FAIL into #result (data-status="pass" | "fail") and one line per check into #log.
import { hexToBytes } from '@noble/hashes/utils';
import { decrypt, encrypt, isTlockError, roundOf, verifyBeacon } from '../../src/index.js';
import beaconsFile from '../vectors/beacons.json';
import tleToLib from '../vectors/tle-to-lib.json';

type Check = readonly [name: string, run: () => Promise<void> | void];

const beacons = beaconsFile.beacons;
const beaconFor = (round: number) => {
  const beacon = beacons.find((b) => b.round === round);
  if (!beacon) throw new Error(`no committed beacon for round ${round}`);
  return { round: beacon.round, signature: beacon.signature };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

const [first, second] = beacons;
assert(first !== undefined && second !== undefined, 'the committed beacons are missing');

const checks: Check[] = [
  [
    'no Buffer global and no polyfill in the bundle',
    () => assert(typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined', 'Buffer is defined'),
  ],
  [
    'encrypt then decrypt a 64-byte DAO payload with a committed beacon',
    async () => {
      const payload = crypto.getRandomValues(new Uint8Array(64));
      payload.fill(0, 0, 31);
      payload[31] = 1;
      const ciphertext = await encrypt(first.round, payload);
      assert(ciphertext.length === 423, `ciphertext is ${ciphertext.length} bytes, expected 423`);
      assert(roundOf(ciphertext) === BigInt(first.round), 'roundOf returned the wrong round');
      assert(sameBytes(await decrypt(ciphertext, beaconFor(first.round)), payload), 'round trip mismatch');
    },
  ],
  ...tleToLib.vectors.map(
    (vector): Check => [
      `decrypt tle v1.2.0 vector ${vector.name}`,
      async () => {
        const plaintext = await decrypt(hexToBytes(vector.ciphertext), beaconFor(vector.round));
        assert(sameBytes(plaintext, hexToBytes(vector.plaintext)), 'plaintext mismatch');
      },
    ],
  ),
  [
    'a wrong beacon fails with a typed error',
    async () => {
      const ciphertext = await encrypt(first.round, new Uint8Array(64));
      const err = await decrypt(ciphertext, { round: first.round, signature: second.signature }).then(
        () => undefined,
        (e: unknown) => e,
      );
      assert(isTlockError(err) && err.code === 'WRONG_BEACON', `expected WRONG_BEACON, got ${String(err)}`);
    },
  ],
  [
    'verifyBeacon accepts the committed beacons',
    () => assert(beacons.every(verifyBeacon), 'a beacon failed'),
  ],
];

async function main(): Promise<void> {
  const result = document.getElementById('result');
  const log = document.getElementById('log');
  assert(result !== null && log !== null, 'page markup is missing');
  const failures: string[] = [];
  for (const [name, run] of checks) {
    try {
      await run();
      log.textContent += `ok   ${name}\n`;
    } catch (err) {
      failures.push(name);
      log.textContent += `FAIL ${name}: ${err instanceof Error ? err.message : String(err)}\n`;
    }
  }
  result.textContent = failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`;
  result.dataset.status = failures.length === 0 ? 'pass' : 'fail';
}

void main();
