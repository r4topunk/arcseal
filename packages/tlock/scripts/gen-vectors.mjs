// Node half of scripts/gen-vectors.sh. Subcommands: prepare <dir>, encrypt <dir>, write <dir>.
// Only `prepare` uses the network (drand HTTP API). The file formats are described in README.md, "Test vectors".
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encrypt, QUICKNET, roundOf, verifyBeacon } from '../dist/index.js';

const VECTORS_DIR = new URL('../test/vectors/', import.meta.url);
const RELAYS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://drand.cloudflare.com'];
const ROUNDS = [30_000_000, 31_415_926, 32_000_000];

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const sha256 = (label) => createHash('sha256').update(label).digest();

/** abi.encode(uint8 choice, bytes32 salt): the 64-byte SealedDAO vote payload (PRD 5). */
function daoPayload(choice, salt) {
  const out = new Uint8Array(64);
  out[31] = choice;
  out.set(salt, 32);
  return out;
}

/** Deterministic bytes, so a regenerated plaintext never changes. */
function pattern(length) {
  return Uint8Array.from({ length }, (_, i) => (i * 151 + 7) & 0xff);
}

/** The fixed (round, plaintext) pairs. Both implementations encrypt every pair. */
const PAIRS = [
  {
    name: 'dao-vote-for',
    round: ROUNDS[0],
    note: 'abi.encode(uint8 1 /* For */, bytes32 sha256("arcseal/tlock/vector/salt-1"))',
    plaintext: daoPayload(1, sha256('arcseal/tlock/vector/salt-1')),
  },
  {
    name: 'utf8-text',
    round: ROUNDS[1],
    note: 'UTF-8 text with a non-ASCII character',
    plaintext: new TextEncoder().encode(
      'ArcSeal note, sealed until quicknet round 31415926 — opens by itself',
    ),
  },
  {
    name: 'max-onchain',
    round: ROUNDS[2],
    note: '665 bytes: the largest plaintext under the 1,024-byte ciphertext cap of Sealed.sol (1,024 - 359)',
    plaintext: pattern(665),
  },
  {
    name: 'empty',
    round: ROUNDS[2],
    note: 'edge case: empty plaintext, one empty final STREAM chunk (359-byte file)',
    plaintext: new Uint8Array(0),
  },
];

async function fetchJson(path) {
  const errors = [];
  for (const relay of RELAYS) {
    const url = `${relay}/${QUICKNET.chainHash}/${path}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { url, body: await res.json() };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(`all drand relays failed:\n${errors.join('\n')}`);
}

async function prepare(dir) {
  const info = await fetchJson('info');
  if (info.body.public_key !== QUICKNET.publicKey || info.body.hash !== QUICKNET.chainHash) {
    throw new Error('the live quicknet chain info does not match the pinned QUICKNET constant');
  }
  const beacons = [];
  for (const round of ROUNDS) {
    const { url, body } = await fetchJson(`public/${round}`);
    if (body.round !== round || !verifyBeacon(body)) throw new Error(`beacon from ${url} does not verify`);
    beacons.push({ round, randomness: body.randomness, signature: body.signature, source: url });
  }
  writeFileSync(join(dir, 'chain-info.json'), JSON.stringify({ source: info.url, info: info.body }));
  writeFileSync(join(dir, 'beacons.json'), JSON.stringify(beacons));
  for (const pair of PAIRS) writeFileSync(join(dir, `${pair.name}.plain`), pair.plaintext);
  writeFileSync(join(dir, 'pairs.txt'), `${PAIRS.map((p) => `${p.name} ${p.round}`).join('\n')}\n`);
}

async function encryptAll(dir) {
  for (const pair of PAIRS) {
    writeFileSync(join(dir, `${pair.name}.lib.age`), await encrypt(pair.round, pair.plaintext));
  }
}

function write(dir) {
  const generatedAt = new Date().toISOString();
  const { source, info } = JSON.parse(readFileSync(join(dir, 'chain-info.json'), 'utf8'));
  const beacons = JSON.parse(readFileSync(join(dir, 'beacons.json'), 'utf8'));
  const read = (name) => readFileSync(join(dir, name));
  const tle = PAIRS.map((pair) => {
    const ciphertext = read(`${pair.name}.tle.age`);
    if (roundOf(ciphertext) !== BigInt(pair.round))
      throw new Error(`${pair.name}: tle wrote the wrong round`);
    return {
      name: pair.name,
      round: pair.round,
      note: pair.note,
      plaintext: hex(pair.plaintext),
      ciphertext: hex(ciphertext),
    };
  });
  const lib = PAIRS.map((pair) => {
    const decrypted = read(`${pair.name}.lib.tle-decrypted`);
    if (!decrypted.equals(Buffer.from(pair.plaintext)))
      throw new Error(`${pair.name}: tle -d did not return the plaintext`);
    return {
      name: pair.name,
      round: pair.round,
      note: pair.note,
      plaintext: hex(pair.plaintext),
      ciphertext: hex(read(`${pair.name}.lib.age`)),
      tleDecrypted: hex(decrypted),
    };
  });
  const out = (file, value) =>
    writeFileSync(new URL(file, VECTORS_DIR), `${JSON.stringify(value, null, 2)}\n`);
  out('chain-info.json', { source, fetchedAt: generatedAt, info });
  out('beacons.json', { chainHash: QUICKNET.chainHash, fetchedAt: generatedAt, beacons });
  out('tle-to-lib.json', {
    description:
      'Encrypted by Go tle v1.2.0 (`tle -e -f -r <round>`, binary output); @arcseal/tlock must decrypt them',
    generator: 'tle v1.2.0 (github.com/drand/tlock/cmd/tle)',
    generatedAt,
    vectors: tle,
  });
  out('lib-to-tle.json', {
    description:
      'Encrypted by @arcseal/tlock; tleDecrypted is what Go tle v1.2.0 (`tle -d`) returned for each one',
    generator: '@arcseal/tlock encrypt() (vendored tlock-js 0.9.0)',
    checkedWith: 'tle v1.2.0 (github.com/drand/tlock/cmd/tle)',
    generatedAt,
    vectors: lib,
  });
}

const [command, dir] = process.argv.slice(2);
if (!dir) throw new Error('usage: gen-vectors.mjs <prepare|encrypt|write> <dir>');
if (command === 'prepare') await prepare(dir);
else if (command === 'encrypt') await encryptAll(dir);
else if (command === 'write') write(dir);
else throw new Error(`unknown command ${command}`);
