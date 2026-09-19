# ArcSeal

**Timelock-encrypted sealed voting for [Arc](https://arc.io).**

ArcSeal brings *timelock encryption* to Arc: data nobody can read before a chosen moment, and that anyone can open
after it, without the author coming back. It uses [drand quicknet](https://drand.love) as the clock and
[tlock](https://github.com/drand/tlock) as the cipher. Onchain it is a small abstract Solidity module, `Sealed.sol`,
that stores only a hash commitment and a drand round and verifies a reveal by hash — no relayer, no singleton, no
onchain BLS check. The reference app, `SealedDAO`, is a member-list DAO with a USDC treasury where every vote stays
sealed until the voting round closes: no running tally, no bandwagon, no vote readable onchain while voting is open,
and no vote lost just because a member never comes back to reveal it. (A voter can still prove their own vote by
sharing their receipt; see [Not provided](#not-provided).)

> **Status:** live on Arc mainnet since 2026-09-18 (Sourcify exact match). All three proofs ran end to end: every
> sealed vote revealed, proposals finalized, executed and claimed on 2026-09-19 (see [Mainnet proof](#mainnet-proof)). Every package builds and its tests pass (`pnpm check`). Testnet was skipped:
> the offline anvil dry run of the same flow (`pnpm e2e:dry-run`) stood in for it.
> **Unaudited and experimental**: keep amounts small.

| | |
|---|---|
| Contract | `SealedDAO` at [`0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44`](https://explorer.arc.io/address/0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44) · [Sourcify exact match](https://repo.sourcify.dev/5042/0x789f7689eFb75a1696C5A25d5aE97Ac2cF6A2c44) · [deployments/arc-mainnet.json](deployments/arc-mainnet.json) |
| Project page | https://r4topunk.github.io/arcseal/ |
| DoraHacks BUIDL | https://dorahacks.io/buidl/48963 (Arc Microgrants, under review) |
| App | https://r4topunk.github.io/arcseal/app/proposals/ (reads the mainnet DAO; any wallet can reveal, finalize, execute or claim; only members can propose and vote) |
| Chain | Arc mainnet, chainId 5042, USDC `0x3600000000000000000000000000000000000000` (ERC-20 view, 6 decimals) |

## What it does

A member proposes one of two actions — `TransferUSDC(to, amount)` or `SetMember(account, isMember)` — and picks a
voting window from 10 minutes to 7 days. Each member seals their vote (For, Against or Abstain) as a hash
commitment plus a tlock-encrypted ciphertext locked to a drand round chosen at propose time; only the hash and the
ciphertext ever reach the chain, and the contract never inspects either. Once that round is public, **anyone** —
the site has a button for it — decrypts every sealed vote in their own browser and submits them in a single
`revealBatch` transaction. For a proposal that met quorum, a small fixed payment per validly revealed vote covers
that transaction's gas. Quorum is measured over sealed votes; whether a proposal passes is measured over revealed
votes only. A passed proposal can be executed within 7 days after the reveal window ends, and every payout — a
transfer or a reveal payment — is pulled by its own recipient with `claim()`, never pushed.

**Stated plainly (D17): secrecy holds *during* voting. From the close round on, anyone can decrypt every sealed vote
from the chain; after the reveal, each vote is public per address, permanently. This is not anonymity.**

### Guarantees enforced onchain

| Guarantee | Mechanism |
|---|---|
| **The hash is the sole authority** | `commitment = keccak256(abi.encode(proposalId, voter, choice, salt))`, a 32-byte CSPRNG salt. The contract never parses a ciphertext; it only compares hashes at reveal time |
| **No relayer required** | The site's "Reveal votes" button decrypts every vote in the visitor's own browser and sends one `revealBatch` transaction; nothing in the protocol requires the site, and any script with the SDK can do the same |
| **Invalid items never block a batch** | `revealBatch` skips a mismatched, unknown or duplicate item (`RevealSkipped`) instead of reverting the whole call |
| **Pull-only payouts** | `execute()` and `revealBatch()` only credit an internal `claimable` balance; `claim()` alone moves USDC, and always to `msg.sender`. A blocked or unresponsive recipient can never stall anyone else's transfer, reveal or claim |
| **Quorum vs. outcome are measured separately** | Quorum uses **sealed** votes against the member count frozen at propose time; passing uses **revealed** votes only (`forCount > againstCount`, ties fail). An unrevealed vote counts toward quorum and nothing else |
| **No treasury drain without a passed proposal** | The reveal payment is credited only for a proposal that met quorum (below quorum it cannot pass), so a lone member cannot empty the treasury with throwaway proposals. A proposal can never pay or add the DAO itself or the USDC token, and the last member can never be removed |
| **Immutable** | No owner, no upgrade, no pause. The treasury token, quorum and reveal payment are fixed forever at deployment; membership changes only through a passed, executed proposal |

### Not provided

- **Anonymity.** Voting is a transaction from your own address; sealing hides the choice, not the voter. After the
  reveal, `(voter, choice)` is public forever in the event log.
- **Coercion resistance.** A voter can always prove their own vote to a third party by handing over their local
  receipt (`{proposalId, choice, salt}`).
- **Protection against a majority of members colluding.** Members holding quorum and a majority of the revealed
  votes can pass and execute any proposal, including paying the whole treasury to themselves.

No token, no sale, no yield, no prize, no chance. Membership changes and treasury transfers happen only through
approved proposals — this framing is deliberate, not stylistic: it keeps ArcSeal a governance and treasury primitive,
never a game of chance, a prize, a token sale or custody of other people's savings. The full analysis is in
[docs/THREATS.md](docs/THREATS.md).

## Why Arc

| Arc property | What ArcSeal does with it |
|---|---|
| Gas paid in USDC, 20 gwei floor | Sealing a vote costs about 0.0014 USDC (measured with EIP-7623 active). The reveal payment is paid in the same unit the revealer spends on gas |
| Sub-second deterministic finality, no reorgs | A `Sealed` event is final on inclusion; the round-to-block mapping needs no confirmation depth |
| USDC is native and an ERC-20 at `0x3600…0000` (6 decimals) | The DAO treasury and the gas are the same asset. Members hold only USDC, read through the 6-decimal ERC-20 view only |
| USDC blocklist reverts transfers | All payouts are pull-based (`claim`), never pushed, so a blocked recipient can never stall a proposal |
| No VRF, no timelock service on Arc | ArcSeal is greenfield: it brings its own timelock-encryption primitive (drand + tlock) rather than depending on one |

## Architecture

```
                         drand League of Entropy — quicknet (unchained, 3 s period)
                                            |
                         HTTP: api.drand.sh / api2 / cloudflare (SDK getBeacon)
                                            |
                          Arc mainnet (chainId 5042)
  ┌──────────────────────────────────────────────────────────────────┐
  │  USDC 0x3600…0000 (ERC-20, 6 dec)                                │
  │        ▲ claim() pulls claimable[msg.sender]                     │
  │  ┌─────┴────────────────────────────┐                            │
  │  │ SealedDAO (immutable, no owner)  │── ProposalCreated, Sealed, │
  │  │ inherits Sealed                  │   VoteRevealed, Finalized, │
  │  │ members · proposals · claimable  │   Executed, Claimed        │
  │  └──▲────────────▲────────────▲─────┘                            │
  └─────┼────────────┼────────────┼──────────────────────────────────┘
        │propose     │vote()      │revealBatch / finalize / execute / claim
        │            │            │(anyone — the site button decrypts and sends)
  ┌─────┴─────┐ ┌────┴────────┐ ┌─┴───────────────────────────────────────┐
  │ member    │ │ member      │ │ revealer (anyone: the site or a script) │
  │ (propose) │ │(seal a vote)│ │ decrypts every vote in the browser      │
  └─────┬─────┘ └────┬────────┘ └─┬───────────────────────────────────────┘
        └──────────────── @arcseal/sdk (viem actions, ABI, tlock, drand, round math)
```

| Path | Package | What |
|---|---|---|
| [`contracts/`](contracts) | Foundry | `Sealed.sol` (abstract, D7) + `SealedDAO.sol`, unit/fuzz/invariant/blocklist/FFI/fork tests, CREATE2 deploy script, gas snapshot |
| [`packages/tlock`](packages/tlock) | `@arcseal/tlock` | Vendored tlock-js 0.9.0, quicknet only, Node and browser, cross-checked against the Go `tle` CLI |
| [`packages/sdk`](packages/sdk) | `@arcseal/sdk` | viem actions for every contract call, `seal`/`unseal`/`unsealProposal`, drand relay fallback with BLS verification, round math, Zod schemas |
| [`apps/web`](apps/web) | `@arcseal/web` | Static Next.js export: proposals, voting, reveal, treasury, docs (EN/PT-BR) |
| [`scripts/`](scripts) | `@arcseal/scripts` | `e2e-testnet.ts` (PRD §8.4); an optional reference reveal CLI is not hosted and not required (D9) |
| [`deployments/`](deployments) | | Addresses, deploy block and mainnet proof tx hashes |

No backend and no database: the site reads the chain and drand from the browser.

## Quickstart

Requirements: Node ≥ 22, pnpm 11, Foundry.

```bash
git clone https://github.com/r4topunk/arcseal && cd arcseal
pnpm install
pnpm build          # forge build + tlock, sdk, web, scripts builds
pnpm test           # forge test (unit/fuzz/invariant/ffi; fork tests skip without ARC_RPC) + every vitest suite
pnpm check          # build + test + typecheck + lint + forge fmt --check + ABI drift check + gas snapshot check
pnpm --filter @arcseal/web dev      # http://localhost:3000
```

### Integrate

```ts
import { sealAndVote, serializeVoteReceipt } from '@arcseal/sdk';

const ballot = await sealAndVote(wallet, {
  dao, proposalId: 1n, choice: 'for',
  onSealed: (b) => localStorage.setItem(key, serializeVoteReceipt({ version: 1, chainId, dao, ...b, createdAt: new Date().toISOString() })),
});
```

See the [integration guide](https://r4topunk.github.io/arcseal/docs/integration/) for inheriting `Sealed.sol` in
your own contract, and the [SDK README](packages/sdk/README.md) for the full API (seal, unseal, reveal-all,
contract actions, errors).

## Gas

Measured locally with Foundry and a local `anvil --hardfork prague` ([docs/GAS.md](docs/GAS.md)). At Arc's 20 gwei
floor, paid in USDC. The mainnet proof run replaces the last column.

| Call | Full tx gas (anvil) | ≈ USDC | vs. PRD target |
|---|---:|---:|---|
| `vote`, 423-byte ciphertext | 68,303 | 0.0014 | within (≤ 80k) |
| `revealBatch`, 3 items (demo size), per item | 48,634 | 0.0010 | over by 3,634 (≤ 45k/item; within from 10 items on) |
| `finalize` | 32,827 | 0.0007 | within (≤ 60k) |
| `execute` TransferUSDC, first payout to the recipient | 70,763 | 0.0014 | over by 10,763 (≤ 60k) |
| `claim` | 49,338 | 0.0010 | within (≤ 55k) |

The two misses come from unavoidable zero-to-non-zero storage writes that the pull-payment design (D6, D13)
requires; the full breakdown, every call and the Arc mainnet column (from the proof transactions) are
in [docs/GAS.md](docs/GAS.md).

## Metrics

Targets are from PRD §13, measured against the local gas snapshot until the mainnet proof run fills in real
receipts.

| Metric | Target | Measured |
|---|---|---|
| Cost per sealed vote | ≤ 0.002 USDC | 0.00137 USDC on mainnet (68,303 gas, six votes) |
| Cost per revealed vote | ≤ 0.003 USDC | 0.00101 per vote in the 3-vote mainnet batch (151,214 gas); locally 0.00197 alone and 0.00026 at 256 items |
| Close-to-execute latency, mainnet demo | < 5 minutes | **Not achievable as stated.** The reveal window is a fixed 24 h from the close round regardless of voting duration (D5), so the earliest any proposal can be finalized is 24 h after it closes. Measured on mainnet: close 2026-09-18 14:08:27 UTC, execute 2026-09-19 14:11:50 UTC (24 h 3 min; the close script was scheduled 3 min after the window). What is achievable in minutes is close-to-**reveal**: the close round's drand beacon is published at the close itself, and one `revealBatch` can follow right away. See [docs/SPEC.md §6.4](docs/SPEC.md#64-reveal-window-and-expiry-timeline-d5) |
| Votes lost in the mainnet proofs | 0 | 0: 6 of 6 sealed votes revealed (3 + 2 + 1), 1 garbage item skipped |
| Regression | gas snapshot + test counts tracked in CI | `contracts/.gas-snapshot` checked at 5% tolerance; counts below |

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| Member | Propose, seal one vote per proposal, reveal any decrypted vote | Vote twice on a proposal, change a sealed vote, seal after being removed, collect reveal payments from proposals below quorum |
| Anyone (revealer) | Decrypt and submit votes once the round is public, receiving the fixed reveal payment when the proposal met quorum | Change a vote's content, revert someone else's reveal, front-run more than the payment |
| Deployer | Nothing after deploy (no owner, no admin, no upgrade, no fee) | Pause, upgrade, change quorum or the reveal payment, remove a member unilaterally |
| Circle (USDC issuer) | Blocklist an address, which stalls that address's own `claim()`; blocklist the SealedDAO contract itself or pause USDC, which stalls every `claim()` until lifted | Change a vote, the tally or what `execute()` credits (reveal, finalize and execute keep working) |
| drand (League of Entropy) | Publish each round on schedule. A colluding threshold of its nodes could read sealed votes early (outside this model, as with any tlock use) | Change a vote, a commitment or the tally |
| A majority of members | Pass and execute any proposal, including paying the treasury to themselves | Anything not routed through a passed, executed proposal |

Full analysis: [docs/SPEC.md](docs/SPEC.md) and [docs/THREATS.md](docs/THREATS.md). The contract is **unaudited**.

## What's built

| Part | Tests |
|---|---:|
| `contracts/` (Foundry: `Sealed` + `SealedDAO`, unit/fuzz/invariant/blocklist/FFI, security-review regression tests in `test/audit/`, deploy script; fork skipped without `ARC_RPC`) | 173 passed, 3 skipped |
| `@arcseal/tlock` (Vitest) | 72 passed |
| `@arcseal/sdk` (Vitest, incl. anvil integration and a browser smoke test) | 129 passed |
| `apps/web` (Vitest + Testing Library: status chips, form validation, USDC formatting, receipts, error mapping, i18n) | 77 passed |
| `scripts/` (Vitest, incl. the anvil dry run of the e2e flow and a resume check) | 43 passed |

## Mainnet proof

Recorded in [`deployments/arc-mainnet.json`](deployments/arc-mainnet.json) (PRD §10.2). Proofs 1 and 2 were revealed
with the app's "Reveal votes" button (decrypted in the browser, one `revealBatch` each, from WALLET_B); proof 3 with
`reveal-cli --garbage-item`. Finalize, execute and claim ran on 2026-09-19 at 14:11 UTC, right after the 24 h
reveal window ended. Every transaction has status `success`.

All members of the proof DAO are wallets the author controls (PRD D16). The proofs show the mechanism working end
to end, not independent voters.

| Proof | Tx |
|---|---|
| Deploy `SealedDAO` (verified on Sourcify) / fund treasury (2 USDC) | [`0xf583c2a2…`](https://explorer.arc.io/tx/0xf583c2a2be72d010465b4ea7cd70cd48ffeab8ee26dc2878a8e0f0838aae2287) / [`0xb7470d0b…`](https://explorer.arc.io/tx/0xb7470d0b1c5fc7058e08c4ddac6b538093159bfd8b5fbe9fcb9eed2a1af4cc70) |
| Proof 1 — transfer: propose → 3 sealed votes (For, For, Against) → reveal → finalize → execute → claim | propose [`0x353ef369…`](https://explorer.arc.io/tx/0x353ef369ff80270563033490020657e81a2eb1154fc369784ae4470e89f13467) · votes [`0xf0f54f3b…`](https://explorer.arc.io/tx/0xf0f54f3ba7f6cefa321fae6004aec8ac70279569cb57495eebe900f08929a914) [`0x695a8ba1…`](https://explorer.arc.io/tx/0x695a8ba13d59a20b24b9f42b650c63b3726b18ba358d21c3870a5150c1ccad8e) [`0x9aa7f643…`](https://explorer.arc.io/tx/0x9aa7f643784e588175d66c8edcce8cc5d4e7b4ac1f32e298c9b4add62efa5627) · revealBatch [`0x66e70f35…`](https://explorer.arc.io/tx/0x66e70f35000463ec17d28acfa7d035b2ca3ab81af332f44a50026dc41b828320) (0.03 USDC reveal payment, claimed [`0x4c534dc5…`](https://explorer.arc.io/tx/0x4c534dc5d42fa2035cb1ed9018a2751ef0838929471fa94793f3ec5aacff1552)) · finalize [`0x8dca055e…`](https://explorer.arc.io/tx/0x8dca055ebe4b7f35307349d7d94c402756ff1553b9d67fe16c8993ebec27660f) (Passed, 2–1) · execute [`0xdfa967ad…`](https://explorer.arc.io/tx/0xdfa967add56dcb1be2673a90243019bcae1536251f2a164973cde67a300a2d46) · claim [`0x8abcfd37…`](https://explorer.arc.io/tx/0x8abcfd3775e7459e7135b82427f749250d8e7b1d524dd4cd2229f999188a6527) (1 USDC to WALLET_C) |
| Proof 2 — membership: propose → 2 sealed votes, 1 abstains by not voting → reveal → finalize → execute | propose [`0x96991c2d…`](https://explorer.arc.io/tx/0x96991c2d06c38b299448c96a8e4ff8a412f037d44a7ea36adcbf52dde182e45a) · votes [`0x01886649…`](https://explorer.arc.io/tx/0x01886649dd11dc6a4a30d4d2c049d957ecee22ef0db476c4c6577a790a79f779) [`0xc32dc596…`](https://explorer.arc.io/tx/0xc32dc596c9172ec5959e94b2457bd65cd2fc99fda718142290fb678312a8aa43) · revealBatch [`0x781c14ee…`](https://explorer.arc.io/tx/0x781c14ee4a48f51c99fd3e161f9dafe2bc569b38812959b077fe486ccfb12319) · finalize [`0x0116d663…`](https://explorer.arc.io/tx/0x0116d663ca7cebb641fb2cb7be047859a637bc4c1c4f413997023370acf7ede4) (Passed) · execute [`0x7c97e2cd…`](https://explorer.arc.io/tx/0x7c97e2cd6f904392c6a78a5813214e5f30dd0d823d53424c1d18b51dc48b08ea) (`memberCount` 3 → 4) |
| Proof 3 — negative: a proposal that fails quorum, and a `revealBatch` with one garbage item skipped | propose [`0x771c4edf…`](https://explorer.arc.io/tx/0x771c4edf0aeec984689bedf1cfb51801f69ffa0c8d16c4591caa0553ec4e8154) · vote [`0x516f2e82…`](https://explorer.arc.io/tx/0x516f2e824407ebf62e13034acd59150bd773dd39376da04652dbca93b4226391) · revealBatch [`0x49b4f6e0…`](https://explorer.arc.io/tx/0x49b4f6e0f582c8cb4d901b771af6e1a9e830fa8b7cc4d53a5cc5153bc13dafd2) (1 revealed, 1 `RevealSkipped`, no reveal payment below quorum) · finalize [`0xc473d686…`](https://explorer.arc.io/tx/0xc473d686c51498c8c35efd97ccb8ee4ffa788eb740a4859ec5076b7c9b714602) (Failed: quorum not met) |

## Docs

[PRD](PRD.md) · [Spec](docs/SPEC.md) · [Threat model](docs/THREATS.md) · [Gas](docs/GAS.md) ·
[Deploy runbook](DEPLOY.md) · [Checklist](CHECKLIST.md) · [Submission](SUBMISSION.md) ·
[Agent/contributor guide](AGENTS.md) · [SDK README](packages/sdk/README.md) ·
Interfaces: [`Sealed.sol`](contracts/src/Sealed.sol) · [`SealedDAO.sol`](contracts/src/SealedDAO.sol)

Hosted docs (same content, rendered): [Integration guide](https://r4topunk.github.io/arcseal/docs/integration/) ·
[FAQ](https://r4topunk.github.io/arcseal/docs/faq/) · [Spec summary](https://r4topunk.github.io/arcseal/docs/spec/)

## Credits

- [drand](https://drand.love) / League of Entropy: the quicknet randomness beacon that makes the clock.
- [drand/tlock](https://github.com/drand/tlock): identity-based timelock encryption on drand.
- [Arc](https://docs.arc.io) and [Circle](https://www.circle.com) for the chain and USDC.
- [Foundry](https://github.com/foundry-rs/foundry) and [forge-std](https://github.com/foundry-rs/forge-std),
  [viem](https://viem.sh), [wagmi](https://wagmi.sh), [Next.js](https://nextjs.org),
  [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [zod](https://zod.dev),
  [Vitest](https://vitest.dev), [Biome](https://biomejs.dev), [pino](https://getpino.io).
- ArcPull and ArcDraw (same author), whose repo layout and docs style this project follows.

## License

[MIT](LICENSE)
