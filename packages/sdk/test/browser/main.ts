// Browser smoke page (PRD 8.2, 10.1): built by Vite with a default config and no polyfills, run by smoke.test.ts in
// headless Chromium. It imports the SDK entry, seals and unseals votes with a committed quicknet beacon, and writes
// PASS or FAIL into #result (data-status="pass" | "fail") and one line per check into #log. Fully offline.
import beaconsFile from '../../../tlock/test/vectors/beacons.json';
import tleToLib from '../../../tlock/test/vectors/tle-to-lib.json';
import {
  buildRevealBatch,
  createLogger,
  type FetchLike,
  getBeacon,
  hashVote,
  sealVote,
  unsealVote,
  withCorrelationId,
} from '../../src/index.js';

type Check = readonly [name: string, run: () => Promise<void> | void];
type Hex = `0x${string}`;

const VOTER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const beacons = beaconsFile.beacons.map((b) => ({
  round: BigInt(b.round),
  signature: `0x${b.signature}` as Hex,
}));
const [first, second] = beacons;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
assert(first !== undefined && second !== undefined, 'the committed beacons are missing');

const checks: Check[] = [
  [
    'no Buffer global and no polyfill in the bundle',
    () => assert(typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined', 'Buffer is defined'),
  ],
  [
    'sealVote then unsealVote with a committed beacon',
    async () => {
      for (const choice of ['abstain', 'for', 'against'] as const) {
        const sealed = await sealVote({ proposalId: 1n, voter: VOTER, choice, closeRound: first.round });
        assert(
          sealed.ciphertext.length === 2 + 423 * 2,
          `ciphertext is not 423 bytes: ${sealed.ciphertext.length}`,
        );
        assert(
          sealed.commitment === hashVote({ proposalId: 1n, voter: VOTER, choice, salt: sealed.salt }),
          'commitment is not hashVote(...)',
        );
        const opened = await unsealVote({
          ciphertext: sealed.ciphertext,
          closeRound: first.round,
          beacon: first,
        });
        assert(opened?.choice === choice && opened.salt === sealed.salt, `round trip mismatch for ${choice}`);
      }
    },
  ],
  [
    'a wrong beacon and a truncated ciphertext unseal to null',
    async () => {
      const { ciphertext } = await sealVote({
        proposalId: 1n,
        voter: VOTER,
        choice: 'for',
        closeRound: first.round,
      });
      const wrong = { round: first.round, signature: second.signature };
      assert(
        (await unsealVote({ ciphertext, closeRound: first.round, beacon: wrong })) === null,
        'wrong beacon',
      );
      const truncated = ciphertext.slice(0, -40) as Hex;
      assert(
        (await unsealVote({ ciphertext: truncated, closeRound: first.round, beacon: first })) === null,
        'truncated ciphertext',
      );
    },
  ],
  [
    'unsealVote opens the Go tle v1.2.0 vote vector',
    async () => {
      const vector = tleToLib.vectors.find((v) => v.name === 'dao-vote-for');
      assert(vector !== undefined, 'missing dao-vote-for vector');
      const opened = await unsealVote({
        ciphertext: `0x${vector.ciphertext}`,
        closeRound: BigInt(vector.round),
        beacon: first,
      });
      assert(opened?.choice === 'for', `expected a For vote, got ${String(opened?.choice)}`);
    },
  ],
  [
    'getBeacon BLS-verifies a relay response (stub fetch, no network)',
    async () => {
      const raw = beaconsFile.beacons[0]!;
      const fetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => raw });
      const beacon = await getBeacon(first.round, { fetch, urls: ['https://relay.invalid'] });
      assert(beacon.signature === first.signature, 'wrong signature');
    },
  ],
  [
    'buildRevealBatch splits 257 items into 256 + 1',
    () => {
      const salt = `0x${'11'.repeat(32)}` as Hex;
      const items = Array.from({ length: 257 }, (_, i) => ({
        voter: `0x${(i + 1).toString(16).padStart(40, '0')}` as Hex,
        choice: 'for' as const,
        salt,
      }));
      const batches = buildRevealBatch(items);
      assert(batches.length === 2 && batches[0]?.voters.length === 256, 'wrong split');
    },
  ],
  [
    'pino browser logger with a correlation id',
    () => {
      const log = withCorrelationId(createLogger({ level: 'info' }), 'browser-smoke');
      log.info({ check: 'logger' }, 'arcseal sdk smoke');
    },
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
