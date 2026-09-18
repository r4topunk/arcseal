# @arcseal/sdk

TypeScript SDK for **ArcSeal**: timelock-sealed votes for `SealedDAO` on [Arc](https://arc.io), using
[drand quicknet](https://drand.love) as the clock and tlock as the cipher. Built on [viem](https://viem.sh).
ESM only, runs in Node 22 and browsers, strict types, every public input validated with Zod.

> Experimental and unaudited. Keep amounts small.

## TL;DR

| Step | Who | Call |
|---|---|---|
| Seal a vote | the member, while voting is open | `sealAndVote(wallet, { dao, proposalId, choice, onSealed })` |
| Decrypt every vote | anyone, after the close round | `unsealProposal({ client, dao, proposalId, fromBlock })` |
| Reveal them onchain | anyone (a small fixed payment per revealed vote covers the gas, for proposals that met quorum) | `buildRevealBatch(items)` then `revealBatch(wallet, { dao, proposalId, ...batch })` |
| Close the tally | anyone, after the 24 h reveal window | `finalize(wallet, { dao, proposalId })` |
| Apply a passed proposal | anyone, within 7 days after the reveal window | `execute(wallet, { dao, proposalId })` |
| Withdraw | payee or revealer | `claim(wallet, { dao })` |

## Install

```sh
pnpm add @arcseal/sdk viem
```

`viem` (^2.56) is a peer dependency. `@arcseal/tlock` (vendored tlock-js, quicknet only), `zod` and `pino` come with
the SDK. No Buffer polyfill or bundler plugin is needed in the browser.

## Examples

### Seal a vote

```ts
import { sealAndVote, serializeVoteReceipt } from '@arcseal/sdk';
import { createWalletClient, custom } from 'viem';
import { arc } from 'viem/chains';

const wallet = createWalletClient({ account, chain: arc, transport: custom(window.ethereum) });

const ballot = await sealAndVote(wallet, {
  dao,
  proposalId: 1n,
  choice: 'for',
  // Runs after sealing and before the transaction exists: persist the receipt here.
  onSealed: (b) =>
    localStorage.setItem(
      `arcseal:${arc.id}:${dao}:${b.proposalId}:${b.voter}`,
      serializeVoteReceipt({ version: 1, chainId: arc.id, dao, ...b, createdAt: new Date().toISOString() }),
    ),
});
console.log(ballot.hash, ballot.commitment); // ciphertext: 423 bytes of raw tlock output, locked to closeRound
```

`sealAndVote` reads the proposal's `closeRound`, draws a 32-byte CSPRNG salt, runs `sealVote` and sends `vote`. If
you pass `closeRound` yourself it must equal the proposal's, or `sealAndVote` throws `InvalidInputError` before
sealing anything: an earlier round would make the vote readable before voting closes.
The lower-level pieces are `sealVote({ proposalId, voter, choice, closeRound, salt? })` and `vote(wallet, ...)`.

### Unseal one vote

```ts
import { unsealVote } from '@arcseal/sdk';

// After roundTime(closeRound). Without `beacon`, it is fetched from drand (api.drand.sh, api2, cloudflare).
const vote = await unsealVote({ ciphertext, closeRound });
// { choice: 'for', salt: '0x…' }, or null for garbage, truncated data, another round, a wrong beacon or choice > 2
```

### Reveal all votes of a proposal

```ts
import { buildRevealBatch, revealBatch, unsealProposal, waitForSuccess } from '@arcseal/sdk';
import { createPublicClient, http } from 'viem';

const client = createPublicClient({ chain: arc, transport: http() });
const { items, skipped, skipReasons } = await unsealProposal({
  client,
  dao,
  proposalId: 1n,
  fromBlock: DAO_DEPLOY_BLOCK, // scanned in windows of 9,999 blocks (Arc caps eth_getLogs at 10,000)
});
// items: votes whose hash matches the live commitment. skipped: garbage, mismatched or already revealed voters.
for (const batch of buildRevealBatch(items)) {
  // at most 256 items per transaction
  await waitForSuccess(client, await revealBatch(wallet, { dao, proposalId: 1n, ...batch }), 'revealBatch');
}
```

`unsealProposal` reads `proposal(id)` for the close round, reads the proposal's `Sealed` logs, gets the close-round
beacon **once**, BLS-verifies it, decrypts every ciphertext and keeps an item only if
`hashVote(decoded) == commitmentOf(id, voter)`. Pass `beaconSource: beacon` (or `(round) => Promise<beacon>`) to
bring your own beacon; nothing is fetched when no vote was sealed.

## API

### Votes and sealing

| Export | Signature | Notes |
|---|---|---|
| `CHOICES`, `Choice` | `['abstain', 'for', 'against']` | index = Solidity enum value |
| `choiceToIndex` / `choiceFromIndex` | `(Choice) => 0 \| 1 \| 2` / `(number \| bigint) => Choice` | `RangeError` outside 0..2 |
| `generateSalt` | `() => Hex` | 32 random bytes from `crypto.getRandomValues` |
| `hashVote` | `({ proposalId, voter, choice, salt }) => Hex` | `keccak256(abi.encode(uint256, address, uint8, bytes32))` = `SealedDAO.hashVote` |
| `encodeVotePlaintext` | `(choice, salt) => Hex` | `abi.encode(uint8 choice, bytes32 salt)`, 64 bytes |
| `decodeVotePlaintext` | `(Hex \| Uint8Array) => { choice, salt } \| null` | null on wrong length, choice > 2 or a dirty uint8 word |
| `sealVote` | `({ proposalId, voter, choice, closeRound, salt? }) => Promise<{ commitment, ciphertext, salt, plaintext }>` | ciphertext = raw tlock bytes (hex) for `closeRound`, 423 bytes |
| `unsealVote` | `({ ciphertext, closeRound, beacon? }, drandOptions?) => Promise<{ choice, salt } \| null>` | checks the ciphertext's round before fetching; a drand outage throws `DrandFetchError` |
| `unsealProposal` | `({ client, dao, proposalId, fromBlock?, toBlock?, beaconSource?, logger?, windowSize?, onWindow? })` | `=> { items, skipped, skipReasons, closeRound, correlationId }` |
| `buildRevealBatch` | `(items, { size? }) => { voters, choices, salts }[]` | chunks of at most 256 (`MAX_REVEAL_BATCH`); refuses a voter listed twice |

`skipReasons[i].reason` is `undecryptable` (not a vote for this round), `commitment-mismatch` (decrypts, but the hash
is not the live commitment) or `already-revealed`.

### drand

| Export | Notes |
|---|---|
| `getBeacon(round, { urls?, timeoutMs?, signal?, fetch?, logger? })` | `GET <relay>/<chainHash>/public/<round>` (v1 API, never v2) on `DRAND_URLS` in order: `api.drand.sh`, `api2.drand.sh`, `drand.cloudflare.com`. 5 s per relay (`DRAND_TIMEOUT_MS`). Each body is Zod-validated, must be for the requested round and must BLS-verify against the pinned quicknet key, else the next relay is tried. Throws `DrandFetchError` with every attempt (`early: true` when the round is not published yet) |
| `waitForRound(round, { signal, retryMs?, now?, ...getBeaconOptions })` | sleeps until `roundTime(round)`, then retries `getBeacon` every `retryMs` (3 s) until it succeeds. Bound it with `signal` |
| `drandBeaconResponseSchema`, `FetchLike` | response schema and the injectable fetch shape |

### Contract actions

Every action takes a viem client first (public, wallet or wagmi client), like viem's own actions. Reads work with any
client. Writes need a client with an account; they are **simulated first**, so most reverts throw
`ContractRevertError` before anything is sent, then return the transaction hash. A transaction can still revert
onchain if the state changes between the simulation and inclusion (a window closing, for example); `waitForSuccess`
then throws `TransactionRevertedError`. A local account (a key or keystore signing in the process) sends the node's
gas estimate plus `GAS_MARGIN_PERCENT` (20%, `withGasMargin`), so a call whose gas depends on state that moves before
inclusion does not run out of gas; a JSON-RPC account (a browser wallet) keeps the wallet's own estimate.

| Contract function | SDK action | Returns |
|---|---|---|
| `propose` | `propose(wallet, { dao, kind, target, amount?, flag?, description, descriptionURI?, votingSeconds })` | `{ hash, proposalId, closeRound, receipt }` (waits for the receipt) |
| `vote` | `vote(wallet, { dao, proposalId, commitment, ciphertext })`, or `sealAndVote(wallet, { dao, proposalId, choice, salt?, closeRound?, onSealed? })` | `Hash`, or the sealed ballot plus `hash` |
| `revealBatch` | `revealBatch(wallet, { dao, proposalId, voters, choices, salts })` | `Hash` |
| `finalize` / `execute` | `finalize(wallet, { dao, proposalId })` / `execute(...)` | `Hash` |
| `claim` | `claim(wallet, { dao })` | `Hash` |
| `proposal` | `getProposal(client, { dao, proposalId })` (`readProposal` for the raw struct) | `Proposal` with `kind` as `'TransferUSDC' \| 'SetMember'`; `ProposalNotFoundError` for an unknown id |
| `status` | `getStatus(client, { dao, proposalId })` (`readStatus` for the index) | `'Voting' \| 'Revealing' \| 'Ready' \| 'Passed' \| 'Failed' \| 'Executed' \| 'Expired'` |
| `commitmentOf` | `readCommitmentOf(client, { dao, proposalId, voter })` | `Hex`: zero if not sealed, `REVEALED_COMMITMENT` once revealed |
| `hashVote` | `readHashVote(client, { dao, proposalId, voter, choice, salt })` | `Hex` (the local `hashVote` gives the same) |
| `isMember`, `claimable` | `readIsMember` / `readClaimable(client, { dao, account })` | `boolean` / `bigint` (USDC, 6 decimals) |
| `memberCount`, `proposalCount`, `totalClaimable` | `readMemberCount`, `readProposalCount`, `readTotalClaimable(client, { dao })` | `number`, `bigint`, `bigint` |
| `usdc`, `quorumBps`, `revealBounty` | `readUsdc`, `readQuorumBps`, `readRevealBounty(client, { dao })` | `Address`, `number`, `bigint` |
| `sealingOpen`, `revealOpen` | `readSealingOpen`, `readRevealOpen(client, { dao, proposalId })` | `boolean` |
| `ProposalCreated` logs | `listProposals(client, { dao, fromBlock?, toBlock?, windowSize?, onWindow? })` | `{ proposals, nextFromBlock }`: pass `nextFromBlock` back to poll |
| `Sealed` logs | `getSealedLogs(client, { dao, proposalId, fromBlock, toBlock?, windowSize?, onWindow? })` | `{ voter, commitment, ciphertext, blockNumber, transactionHash }[]` |

Also exported: `sealedDaoAbi`, `sealedDaoBytecode`, `SEALED_DAO_CREATE2_SALT` (generated from the Foundry artifact
into `src/abi/SealedDAO.ts`), `waitForSuccess(client, hash)`, `toContractRevertError(err, fn)`, `ACTION_KINDS`,
`PROPOSAL_STATUSES`, `proposeInputSchema`, `splitBlockRange`, `LOG_WINDOW_BLOCKS` (9,999). The Sealed round-math
views (`roundAt`, `roundAfter`, `roundTime`) have no action: the local functions below return the same values.

### Round math

Rounds are `bigint` (uint64 onchain), timestamps are unix seconds (`number` or `bigint` in, `number` out). Same
formulas as `Sealed.sol` (PRD §4.1), tested against the 20 shared vectors in `contracts/test/vectors/rounds.json`.

| Export | Returns | Notes |
|---|---|---|
| `QUICKNET_GENESIS`, `QUICKNET_PERIOD`, `REVEAL_WINDOW` | `bigint` | `1692803367n`, `3n`, `28_800n` |
| `MIN_VOTING`, `MAX_VOTING`, `EXECUTION_GRACE` | `number` | `600`, `604_800`, `604_800` seconds |
| `roundAt(t)` | `bigint` | `(t - GENESIS) / PERIOD + 1`; `RangeError` for `t < GENESIS` |
| `roundAfter(t)` | `bigint` | first round published at or after `t` |
| `roundTime(round)` | `number` | `GENESIS + (round - 1) * PERIOD`; `RangeError` for round 0 |
| `closeRoundFor(now, votingSeconds)` | `bigint` | `roundAfter(now + votingSeconds)`; `RangeError` outside `[600, 604800]` (`BadDuration`) |
| `revealEndRoundFor(closeRound)` | `bigint` | `closeRound + REVEAL_WINDOW` |
| `votingOpen(closeRound, now)` | `boolean` | `now < roundTime(closeRound)` |
| `revealOpen(closeRound, now)` | `boolean` | `roundTime(closeRound) <= now < roundTime(closeRound + REVEAL_WINDOW)` |
| `pastRevealEnd(closeRound, now)` | `boolean` | reveal window over: `finalize` allowed |
| `executionDeadline(revealEndRound)` | `number` | last second `execute` is allowed: `roundTime(revealEndRound) + EXECUTION_GRACE` |

```ts
import { closeRoundFor, roundTime, votingOpen } from '@arcseal/sdk';

const now = Math.floor(Date.now() / 1000);
const closeRound = closeRoundFor(now, 600); // what propose(..., 600) stores onchain
const closesAt = roundTime(closeRound);     // show next to the round number
votingOpen(closeRound, now);                // true until closesAt
```

### Receipts

The app keeps a local receipt per sealed vote so the voter can reveal their own vote even if drand is unreachable.

| Export | Notes |
|---|---|
| `voteReceiptSchema`, `VoteReceipt` | `{ version: 1, chainId, dao, proposalId, voter, choice, salt, commitment, closeRound, txHash?, createdAt }` |
| `serializeVoteReceipt(receipt)` | pretty JSON, fixed key order, bigints as decimal strings |
| `parseVoteReceipt(jsonOrObject)` | validates, and checks `commitment == hashVote(...)`; throws `InvalidInputError` |

### Schemas

`addressSchema` (lowercase or EIP-55, output checksummed), `hexSchema`, `bytes32Schema`, `saltSchema` (exactly 32
bytes), `ciphertextSchema` (359..1,024 bytes), `beaconSignatureSchema` (48 bytes), `choiceSchema`,
`uint256Schema`, `proposalIdSchema` (uint256), `roundSchema` (1..2^64-1), `chainIdSchema`, `hashVoteInputSchema`,
`sealVoteInputSchema`, `beaconSchema`, `unsealVoteInputSchema`, `revealItemSchema`, `voteReceiptSchema`,
`proposeInputSchema`. Integer schemas accept a `bigint`, a safe-integer `number` or a decimal string (JSON) and
output `bigint`. Hex outputs are lowercase.

## Logging

pino, JSON lines in Node and objects in the browser console. The SDK never logs at import time.

| Export | Notes |
|---|---|
| `createLogger({ level?, name?, bindings?, destination? })` | pino logger with `name: 'arcseal'` |
| `withCorrelationId(logger, id?)` | child logger that stamps `correlationId` on every line |
| `newCorrelationId()` | UUID v4 layout from `crypto.getRandomValues` |
| `defaultLogLevel()` | `LOG_LEVEL` if valid, else `silent` under Vitest / `NODE_ENV=test`, else `info` |

`unsealProposal` logs through a child logger with a fresh `correlationId` per call (returned as
`result.correlationId`) plus `dao` and `proposalId`: `unseal start` (close round, sealed count), one debug line per
log window, `vote skipped` (voter, reason), `unseal done` (items, skipped). `getBeacon` and `waitForRound` log failed
relays at debug level when given a `logger`.

## Errors

All SDK errors extend `ArcSealError`. Switch on `code`, not on the message.

| Class | `code` | When |
|---|---|---|
| `InvalidInputError` | `INVALID_INPUT` | an argument failed its schema (`issues[]`); nothing was hashed, sent or signed |
| `DrandFetchError` | `DRAND_FETCH_FAILED` | no relay served a valid beacon (`attempts[]`, `early` when the round is in the future) |
| `InvalidBeaconError` | `INVALID_BEACON` | a beacon given to `unsealProposal` is for another round or does not BLS-verify |
| `WalletRequiredError` | `WALLET_REQUIRED` | a write action got a client without an account |
| `ProposalNotFoundError` | `PROPOSAL_NOT_FOUND` | `getProposal` / `unsealProposal` on an id that was never proposed |
| `ContractRevertError` | `CONTRACT_REVERT` | a read or a write's simulation reverted; see below |
| `TransactionRevertedError` | `TX_REVERTED` | a mined transaction reverted (`waitForSuccess`, `propose`) |
| `EventNotFoundError` | `EVENT_NOT_FOUND` | a receipt lacks the expected event (`propose` reads `ProposalCreated`) |
| `RangeError` (built-in) | | round math input where the contract reverts |

`ContractRevertError.errorName` is a SealedDAO custom error (typed as `SealedDaoErrorName`: `NotMember`,
`SealingClosed`, `AlreadySealed`, `BadCiphertextLength`, `RevealNotOpen`, `NotReady`, `NotPassed`, `Expired`,
`InsufficientTreasury`, `NothingToClaim`, `UnknownProposal`, ...), `Error` for a revert string (`args[0]`, for
example USDC's `Blacklistable: account is blacklisted`), `Panic` (`args[0]` is the code) or `Unknown`. The web app maps
`errorName` to a sentence. Network errors and wallet rejections are rethrown unchanged.

## Rules this SDK enforces

| Rule | What the SDK does |
|---|---|
| The hash is the authority (D11) | `hashVote` binds `proposalId` and `voter`. `unsealProposal` keeps a decrypted vote only if its hash is the live onchain commitment |
| Salts come from a CSPRNG | `generateSalt()` uses `crypto.getRandomValues`. Salts that are not exactly 32 bytes are refused; `sealVote` also refuses an all-zero salt |
| A hostile ciphertext cannot pick the beacon | the round inside a ciphertext must equal the close round before any beacon is fetched or used |
| Beacons are verified | every drand response and every supplied beacon is BLS-checked against the pinned quicknet key |
| Arc's eth_getLogs cap | every log scan uses windows of at most 9,999 blocks, oldest first |
| Batch cap | `buildRevealBatch` and `revealBatch` never exceed 256 items |
| Ciphertext bounds | `vote` accepts 359..1,024 bytes, like `Sealed._seal` |

## Cross-checks and tests

| What | Where |
|---|---|
| `contracts/test/vectors/rounds.json` (20 vectors) | `test/round.test.ts` and the Foundry round-math tests |
| `contracts/test/vectors/hashvote.json` (10 vectors) | `test/seal.test.ts`, `test/ffi.test.ts` and the Foundry FFI test |
| Go `tle` v1.2.0 vote ciphertext | `test/seal.test.ts` opens it with `unsealVote` |
| Full DAO flow on local anvil | `test/anvil.test.ts`: deploys MockUSDC + SealedDAO from `contracts/out`, 5 members, 5 sealed votes (one garbage) spread over 21,000 blocks, `unsealProposal` through a transport that rejects eth_getLogs ranges above 10,000 blocks, `revealBatch`, tally, `finalize`, `execute`, `claim`, decoded reverts. Offline: anvil starts in the past so the close round is one with a committed beacon |
| Browser | `test/browser/smoke.test.ts`: Vite build (no config, no polyfills) of a page that seals and unseals with a committed beacon, run in headless Chromium; asserts PASS, zero console errors and zero off-host requests |

No test calls the network: drand is mocked or served from `packages/tlock/test/vectors/beacons.json`.
`scripts/ffi-hash-vote.mjs` prints `hashVote` from the built SDK for Foundry's `vm.ffi`:

```sh
pnpm --filter @arcseal/sdk build
node packages/sdk/scripts/ffi-hash-vote.mjs 1 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 1 0x7f03d7f6c28f22eb389f3b2b3f8000e0bd10814b592bcbec14a2bfaedc522b4e
# 0x0836fa805c79dc993147f1e959ba5b9e3e460cefe9500469b9c92c56950c6b51   (no newline)
```

## Development

```sh
pnpm contracts:abi                     # forge build + regenerate src/abi/SealedDAO.ts (commit it)
pnpm --filter @arcseal/sdk build       # tsup: dist/ (ESM + d.ts)
pnpm --filter @arcseal/sdk test        # vitest: unit, anvil integration, browser smoke (needs contracts/out and Chromium)
pnpm --filter @arcseal/sdk typecheck
pnpm --filter @arcseal/sdk lint        # biome
pnpm --filter @arcseal/sdk check:abi   # fails if src/abi/SealedDAO.ts is stale for contracts/out
env LOG_LEVEL=debug pnpm --filter @arcseal/sdk test   # show SDK logs during tests
```

The anvil test needs `anvil` on `PATH` (Foundry) and `contracts/out` (the root `pnpm test` builds it). It starts
anvil with `--hardfork cancun --prune-history`: on anvil 1.7's default hardfork, mining 21,000 blocks takes minutes,
and without `--prune-history` anvil writes gigabytes of per-block state to `~/.foundry/anvil/tmp`. The browser smoke
test needs Chromium: `pnpm exec playwright install chromium`.

## License

MIT
