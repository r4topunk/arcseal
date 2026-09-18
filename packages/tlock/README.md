# @arcseal/tlock

Timelock encryption to [drand quicknet](https://drand.love) rounds for **ArcSeal**. A ciphertext made today opens
only with the drand beacon of a chosen future round, and anyone who has that beacon can open it. This package is a
vendored, quicknet-only copy of [tlock-js](https://github.com/drand/tlock-js) 0.9.0. It is ESM, has no Node
`Buffer`, makes no network calls, and runs in Node 22 and in browsers.

> Unaudited and experimental. The cryptography is upstream tlock-js on @noble/curves; see "Diff against upstream"
> for everything ArcSeal changed.

## TL;DR

```ts
import { decrypt, encrypt, roundOf, verifyBeacon } from '@arcseal/tlock';

const ciphertext = await encrypt(32_000_000n, payload); // Uint8Array: raw age file, payload.length + 359 bytes
roundOf(ciphertext); // 32000000n, the beacon you need

// after the round is published (fetch it yourself, e.g. https://api.drand.sh/<chainHash>/public/32000000)
const beacon = { round: 32_000_000, signature: 'b1c90cc3…91b91f' };
verifyBeacon(beacon); // true: BLS check against the pinned quicknet key, no network
const plaintext = await decrypt(ciphertext, beacon); // throws TlockError on a wrong beacon or bad bytes
```

```sh
pnpm --filter @arcseal/tlock build
pnpm --filter @arcseal/tlock test        # vitest: API, tle vectors in both directions, headless Chromium smoke
pnpm --filter @arcseal/tlock typecheck
pnpm --filter @arcseal/tlock lint
```

## Why a vendored copy

| Reason | Detail |
|---|---|
| Upstream is dormant | tlock-js 0.9.0 (2024-03-18) is the latest release. No branch of the upstream repo has a commit after that date (checked 2026-09-18). |
| Fewer moving parts | Upstream pulls in `drand-client` (HTTP, chain verification) and the `buffer` npm polyfill. ArcSeal needs neither: the chain is pinned and the SDK fetches beacons. |
| Explicit beacon | Upstream `timelockDecrypt` fetches the beacon over HTTP inside the call and logs it to the console. ArcSeal decrypts many votes with one beacon and needs decryption to work offline (PRD 5.1, D9). |
| Raw bytes | Upstream returns ASCII-armored strings, which are 1.54x larger. ArcSeal posts the raw age file in calldata (PRD D10). |
| Correctness | Two upstream bugs in the age STREAM layer are fixed (see below). The Go `tle` vectors keep the copy interoperable. |

Upstream: https://github.com/drand/tlock-js, commit **`17d817ee259e79381111dd75009b0f022c39ace3`**
(2024-03-18, "updated noble curves for point fix (#42)"), `package.json` version 0.9.0. Dual-licensed Apache-2.0 OR
MIT; vendored under MIT (see `LICENSE-tlock-js`).

## API

| Export | Signature | Notes |
|---|---|---|
| `QUICKNET` | `{ chainHash, publicKey, genesis, period, scheme }` | Pinned chain info: `52db9ba7…e971`, 96-byte G2 key (hex), genesis `1692803367`, period `3` s, `bls-unchained-g1-rfc9380`. |
| `QUICKNET_DST` | `string` | `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_` (RFC 9380 hash-to-G1 tag). |
| `encrypt` | `(round: number \| bigint, plaintext: Uint8Array) => Promise<Uint8Array>` | Raw binary age file, the same format `tle -e` (v1.2.0, no `-a`) writes. Round in `1..2^64-1`. |
| `decrypt` | `(ciphertext: Uint8Array, beacon: Beacon) => Promise<Uint8Array>` | No HTTP. `Beacon = { round: number \| bigint; signature: string }` (48-byte hex, `0x` optional). |
| `roundOf` | `(ciphertext: Uint8Array) => bigint` | Parses the tlock stanza. Checks that it is quicknet. Needs no beacon. |
| `verifyBeacon` | `(beacon: Beacon) => boolean` | Pure BLS verification of `signature` over `sha256(uint64be(round))` against the pinned key. Returns false for anything invalid. |
| `TlockError`, `isTlockError` | `class TlockError extends Error { code }` | Every thrown error. Switch on `code`. |

| `TlockError.code` | When |
|---|---|
| `INVALID_INPUT` | Bad argument: a round that is not an integer in `1..2^64-1`, a non-`Uint8Array` input, or a signature that is not 48-byte hex. |
| `MALFORMED_CIPHERTEXT` | Not an age v1 file with a well-formed tlock stanza: garbage, armored text, cut inside the header, bad base64, a stanza body that is not 128 bytes, or U not a G2 point. |
| `WRONG_CHAIN` | The stanza names a chain hash other than quicknet's. |
| `ROUND_MISMATCH` | The beacon is for a different round than the stanza. Checked before any pairing work. |
| `WRONG_BEACON` | The signature does not open the stanza. Either it is not quicknet's signature for that round, it is not a G1 point, or V/W were tampered with. |
| `DECRYPTION_FAILED` | The file key was recovered, but the header MAC or the payload failed authentication. This means tampering or truncation, including a payload cut to its nonce. |

### Ciphertext size

The overhead is **359 bytes flat**: `length = plaintext + 359`. The 64-byte DAO payload `abi.encode(uint8, bytes32)`
becomes 423 bytes. The 1,024-byte cap in `Sealed.sol` fits plaintexts up to 665 bytes. The tests measure this, and it
matches PRD 9:

| Part | Bytes |
|---|---|
| `age-encryption.org/v1\n` | 22 |
| `-> tlock <round> <chainHash>\n` | 83 for an 8-digit round |
| stanza body: base64 of U (96, G2) ‖ V (16) ‖ W (16), wrapped at 64 columns | 171 + 3 newlines |
| `--- <HMAC-SHA256>\n` | 48 |
| payload: 16-byte nonce ‖ ChaCha20-Poly1305 STREAM (plaintext + 16-byte tag per 64 KiB chunk) | 32 + plaintext |

The round is written in decimal, so the overhead is 359 only for 8-digit rounds. That covers round 10,000,000
(2024-08-04) through round 99,999,999 (2033-02-23). A test pins 358 bytes for 7 digits and 360 bytes for 9 digits.

## Diff against upstream

The vendored files keep upstream's layout and formatting. Biome's formatter is off for `src/age`, `src/crypto` and
`src/drand` and the linter stays on. That way a plain diff shows only real changes:

```sh
git clone https://github.com/drand/tlock-js /tmp/tlock-js
git -C /tmp/tlock-js checkout 17d817ee259e79381111dd75009b0f022c39ace3
diff -ru /tmp/tlock-js/src packages/tlock/src
```

| Upstream file | Here | Change |
|---|---|---|
| `src/index.ts` | replaced | New API in `src/tlock.ts` + `src/index.ts`: `encrypt`/`decrypt`/`roundOf`/`verifyBeacon` on raw bytes. Removed `timelockEncrypt`/`timelockDecrypt`, the `ChainClient` re-exports, `mainnetClient`/`testnetClient`/`nonRFCMainnetClient`, `roundAt`/`roundTime` (the SDK owns round math) and the `Buffer` re-export. |
| `src/drand/defaults.ts` | removed | Replaced by the pinned `QUICKNET` constant in `src/quicknet.ts`. The fastnet and testnet chain info is gone. |
| `src/drand/timelock-encrypter.ts` | modified | No `ChainClient`. Uses the pinned key, keeps only the `bls-unchained-g1-rfc9380` branch, uses `bigint` rounds, no Buffer. |
| `src/drand/timelock-decrypter.ts` | modified | The beacon is a parameter: no `fetchBeacon`, no "too early" clock check, no `console.log`. New validation: the chain hash must be quicknet's (upstream had a TODO), the round is strict uint64 and must equal the beacon's round, and the body must be exactly 96 + 16 + 16 bytes. Errors are typed. |
| `src/drand/index.d.ts`, `src/version.ts`, `src/types/js-chacha20/` | removed | These were used only by removed code or not at all (`js-chacha20` is not a dependency). |
| `src/crypto/ibe.ts` | trimmed | Keeps `encryptOnG2RFC9380` and `decryptOnG2`. Drops `encryptOnG1`/`decryptOnG1` (testnet) and the non-RFC `encryptOnG2` (fastnet). No Buffer. `!=` became `!==`. |
| `src/crypto/fp.ts` | trimmed | Types only. The unused tuple converters and `declare const` field objects are dropped. The export list is `export type`, because upstream's mixed value/type export fails this package's `verbatimModuleSyntax` typecheck (TS1205). |
| `src/crypto/utils.ts` | modified | `hexToBytes`/`concatBytes` replace Buffer. Non-null index reads for strict TypeScript. `!=` became `!==`. |
| `src/age/age-encrypt-decrypt.ts` | modified | Bytes in and out. The no-op default wrappers are gone. The MAC comparison is constant-time. The payload must hold a full 16-byte nonce. Every stage throws a typed error. |
| `src/age/age-reader-writer.ts` | modified | `writeAge` returns bytes. `readAge` decodes base64 strictly, with no Buffer. |
| `src/age/stream-cipher.ts` | **bug fix** | Empty plaintext is sealed as one empty final chunk, and `open` rejects a payload with no final chunk (details below). `==` became `===`. |
| `src/age/utils.ts` | modified | Base64 uses `btoa`/`atob` with strict unpadded decoding (like Go's `RawStdEncoding.Strict()`). `unpaddedBase64Buffer` was removed. |
| `src/age/utils-crypto.ts` | modified | `random` uses Web Crypto `getRandomValues` via @noble/hashes. It replaces the `window.crypto` check plus a CommonJS `require("crypto")` fallback, which threw in ESM Node and in Web Workers. |
| `src/age/armor.ts`, `src/age/no-op-encdec.ts` | removed | Raw bytes only. The tests do not need armor. |
| n/a | new | `src/bytes.ts` (the Buffer replacements), `src/errors.ts`, `src/quicknet.ts`, `src/tlock.ts`. |

Dependencies are pinned to the exact versions in upstream's `package-lock.json`: `@noble/curves` 1.4.0,
`@noble/hashes` 1.4.0 and `@stablelib/chacha20poly1305` 1.0.1. The `buffer` and `drand-client` dependencies are dropped.

### STREAM bug fix (empty plaintext and truncation)

The age spec, and Go age with it, requires every payload to end with a final chunk, even an empty one. Upstream
`STREAM.seal` emitted **zero** chunks for an empty plaintext, and `STREAM.open` accepted zero chunks. This was
reproduced with the published tlock-js 0.9.0 package:

- Upstream encrypts an empty plaintext to a 343-byte file. `tle -d` rejects it with `write: unexpected EOF`.
- Upstream decrypts a 64-byte ciphertext cut down to header + nonce to **an empty plaintext, with no error**.
  Truncation went undetected.

After the fix, an empty plaintext becomes a 359-byte file that `tle` opens (the `empty` vector in both directions).
The truncated form fails with `DECRYPTION_FAILED`. For any non-empty plaintext the bytes are exactly what upstream
produced.

## Browser support

This section settles PRD 14's first UNKNOWN: *does the vendored code need a `Buffer` polyfill in the browser?*
**No. After the changes above there is no `Buffer` usage left, so no polyfill is needed.**

| | Detail |
|---|---|
| What broke | Upstream imports `Buffer` from `"buffer"` in 10 of its 15 source files. That works only because upstream lists the `buffer` npm polyfill as a runtime dependency. Vendored without it, a standard browser build breaks. Vite 8 prints `Module "buffer" has been externalized for browser compatibility` and the page dies at runtime with `Cannot read properties of undefined (reading 'from')`. This was reproduced in headless Chromium with a Vite 8 page that imports `Buffer` from `"buffer"`, and again by the negative control below. Separately, upstream `random()` fell back to `require("crypto")`, which throws in ESM and in Web Workers (no `window`). |
| What changed | Every Buffer call now goes through `src/bytes.ts`, which uses `Uint8Array`, `DataView`, `btoa`/`atob`, `TextEncoder` and @noble/hashes utils. `random()` uses `crypto.getRandomValues`. Nothing depends on Node builtins, so the same code runs in Node 22 and in browsers. The `lib-to-tle` vectors were produced by the built `dist/index.js` in Node. |
| How it is proven | `test/browser/smoke.test.ts` runs the `vite build` CLI on `test/browser/index.html` + `main.ts`, which imports the package entry `src/index.ts` so the test does not depend on build order. The build uses no config file: no polyfill plugin, no `define`, no target override, and a clean production env. The test fails if the build output mentions `externalized for browser compatibility` or `buffer`. It serves the bundle from a local server on a free port and loads it in headless Playwright Chromium. The page checks that `globalThis.Buffer` is undefined, encrypts and decrypts the 64-byte DAO payload with a committed beacon (423 bytes), decrypts all four `tle` vectors, checks that a wrong beacon fails with `WRONG_BEACON`, and verifies the committed beacons. The test asserts `PASS`, zero console errors, zero page errors, and zero requests outside the local server. It runs in the package `test` script, so `pnpm check` runs it offline. A negative control, adding `import { Buffer } from 'buffer'` to `main.ts`, fails both smoke assertions. |

Upstream's README advised Vite users to set `build.target: "es2020"` for BigInt. Vite 8's default target already
supports BigInt, and the smoke build uses the default.

## Test vectors

Committed in `test/vectors/`. Tests read them offline and never call the network (one test replaces `fetch` with a
spy that must never be called).

| File | Content |
|---|---|
| `chain-info.json` | The `/info` response of quicknet from api.drand.sh. A test checks it against `QUICKNET`. |
| `beacons.json` | `{round, randomness, signature, source}` for rounds **30,000,000** (2026-06-30), **31,415,926** (2026-08-18) and **32,000,000** (2026-09-07). Each was BLS-verified against the pinned key before it was committed. |
| `tle-to-lib.json` | 4 `(round, plaintext)` pairs encrypted by Go **tle v1.2.0** (`tle -e -f -r <round>`, binary). This package must decrypt each one to `plaintext`. |
| `lib-to-tle.json` | The same 4 pairs encrypted by this package. `tleDecrypted` is what `tle -d` returned when the vectors were generated. A test checks that it equals `plaintext`. |

| Pair | Round | Plaintext | Ciphertext |
|---|---|---|---|
| `dao-vote-for` | 30,000,000 | 64 B: `abi.encode(uint8 1, bytes32 sha256("arcseal/tlock/vector/salt-1"))` | 423 B |
| `utf8-text` | 31,415,926 | 70 B UTF-8 text with a non-ASCII character | 429 B |
| `max-onchain` | 32,000,000 | 665 B deterministic pattern (the largest that fits `Sealed.sol`'s 1,024-byte cap) | 1,024 B |
| `empty` | 32,000,000 | 0 B (edge case for the STREAM fix) | 359 B |

To regenerate (needs network and Go; the lib ciphertexts change because encryption is randomized):

```sh
go install github.com/drand/tlock/cmd/tle@v1.2.0
pnpm --filter @arcseal/tlock vectors:gen
# tle elsewhere: env TLE=/path/to/tle pnpm --filter @arcseal/tlock vectors:gen
```

`scripts/gen-vectors.sh` checks that `tle --help` reports v1.2.0 and builds `dist/`. It then fetches the chain info
and beacons (api.drand.sh, then api2.drand.sh, then drand.cloudflare.com), verifies them, runs `tle -e` on every pair,
encrypts every pair with the built package, and runs `tle -d` on the results. Before writing the JSON it checks that
`tle -d` returned each plaintext and that `roundOf` reads each `tle` round. The Node half is `scripts/gen-vectors.mjs`.

## License

MIT. The vendored tlock-js code is © 2022 drand team (MIT; see `LICENSE-tlock-js`). The ArcSeal changes are
© 2026 r4to (MIT; see the repository `LICENSE`).
