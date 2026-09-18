# DoraHacks BUIDL submission: Arc Microgrants

Paste-ready fields for https://dorahacks.io/hackathon/arc-microgrants. Deadline: **2026-10-14 23:59 ET**.
The form keeps no draft (fill every field in one sitting) and its dropdowns linger from a previous attempt
(re-check each one before submitting) — see [CHECKLIST.md](CHECKLIST.md).
Lines starting with `TODO(owner):` still need the owner. Find them with `grep -n "TODO(owner)" SUBMISSION.md`.
Everything else below is filled from the repo as of 2026-09-18; mainnet-specific fields stay `TBD` until the
[CHECKLIST.md](CHECKLIST.md) deploy and proof steps run — **never fill a `TBD` here with a guess.**

## Name

ArcSeal

## One-liner (≤ 100 chars)

Timelock-encrypted sealed voting for Arc: no running tally, no bandwagon, no lost votes.

## Description (≤ 300 words)

ArcSeal is an MIT-licensed timelock-encryption primitive for Arc, plus a reference DAO built on it.

An abstract module, `Sealed.sol`, stores only a hash commitment and a drand round per sealed item; it never sees
a ciphertext or a vote choice. A TypeScript SDK (`@arcseal/sdk`) seals data with tlock — identity-based encryption
keyed to a future drand quicknet round. Nobody can open it early, not even the author; anyone can open it once the
round arrives, with no relayer and no singleton contract.

The reference app, `SealedDAO`, is a member-list DAO with a USDC treasury where every vote stays sealed until
voting closes: no running tally, no bandwagon, no vote readable onchain while voting is open, and no vote lost
because a member never came back to reveal it. After the close, anyone — the site has a button — decrypts every
vote in the browser and submits them in one `revealBatch`. For a proposal that met quorum, the treasury pays a
small fixed amount per revealed vote to cover that gas. Every payout is pulled with `claim()`, never pushed, so a
blocklisted address can never stall anyone else.

Secrecy holds only during voting: after the reveal, each vote is public per address, permanently. This is not
anonymity, and the site says so plainly. No token, no sale, no yield, no prize, no chance.

Status: live on Arc mainnet since 2026-09-18 (`SealedDAO` `0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44`, Sourcify
exact match). The three demo proofs are proposed, sealed and revealed onchain; finalize and execute follow when the
24 h reveal window ends on 2026-09-19 14:08 UTC.

## How Arc is used

Gas on Arc is paid in USDC at a 20 gwei floor, so sealing a vote costs about 0.0014 USDC and the reveal payment
is denominated in the same unit the revealer spends on gas. Arc's sub-second, deterministic finality means a
`Sealed` event is final on inclusion — no reorg handling, no confirmation depth. USDC is native to Arc *and* an
ERC-20 at `0x3600000000000000000000000000000000000000` (6 decimals): the DAO treasury and the gas are the same
asset, and the app reads only the ERC-20 view, never mixing it with the native 18-decimal view of the identical
balance. USDC's compliance blocklist reverts transfers to a flagged address, which is exactly why every payout in
`SealedDAO` is pull-based (`claim()`) instead of pushed — a blocked or unresponsive recipient can never stall
anyone else's reveal, finalize, execute or claim.

## What is built

- `Sealed.sol` (abstract) + `SealedDAO.sol`: Foundry contracts, unit/fuzz/invariant/blocklist/FFI/fork tests, a
  Phase 4 adversarial security review with 9 repro + regression tests in `contracts/test/audit/`, a committed gas
  snapshot, a CREATE2 deploy script.
- `@arcseal/tlock`: vendored tlock-js 0.9.0 pinned to drand quicknet, working in Node 22 and browsers, with test
  vectors cross-checked against the Go `tle` CLI.
- `@arcseal/sdk`: `sealVote`/`unsealVote`/`unsealProposal`, round math, viem actions for every contract call, Zod
  schemas, a drand relay fallback (three endpoints), pino logging with correlation ids.
- `apps/web`: a static Next.js app (EN/PT-BR) — proposal list and detail, seal/reveal/finalize/execute/claim
  flows, a create-proposal form, a treasury and members page, docs rendered from Markdown.
- Docs: a full spec (`docs/SPEC.md`), a per-threat security model (`docs/THREATS.md`), a measured gas breakdown
  (`docs/GAS.md`), and an operator runbook (`DEPLOY.md`).
- Test counts from a real `pnpm check` run on 2026-09-18: contracts 173 passed + 3 skipped (read-only mainnet
  fork tests, skipped without `ARC_RPC`), `@arcseal/tlock` 72, `@arcseal/sdk` 129 (including an anvil integration
  suite and a headless-Chromium browser smoke test), `apps/web` 77, `@arcseal/scripts` 43 — 494 tests total, all
  passing, `pnpm check` exits 0.

## Tech stack

- **Chain:** Arc mainnet (chainId 5042), USDC `0x3600…0000` (native + ERC-20 view, 6 decimals)
- **Contracts:** Solidity 0.8.30, Foundry (unit, fuzz, invariant, FFI, read-only mainnet fork, adversarial-review
  regression tests), CREATE2 deploy, immutable (no owner, no upgrade, no pause)
- **Timelock encryption:** drand quicknet (League of Entropy) as the clock, vendored `tlock-js` 0.9.0 as the cipher
- **SDK:** TypeScript, viem, Zod, tsup, Vitest (anvil integration + headless-Chromium browser smoke tests)
- **Web:** Next.js (static export), React, wagmi, Tailwind CSS, EN/PT-BR
- **Tooling:** pnpm workspaces, Biome
- **License:** MIT

## Links

| Field | Value |
|---|---|
| Live link (project page) | https://r4topunk.github.io/arcseal/ |
| Public repo | https://github.com/r4topunk/arcseal |
| Hosted dApp (`apps/web`: proposals, vote, reveal, treasury, docs) | https://r4topunk.github.io/arcseal/app/proposals/ (reads the mainnet DAO) |
| SealedDAO contract | https://explorer.arc.io/address/0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44 |
| Source verification (Sourcify, exact match: runtime and creation) | https://repo.sourcify.dev/5042/0x789f7689eFb75a1696C5A25d5aE97Ac2cF6A2c44 |
| Demo video | TODO(owner): video URL (YouTube unlisted or Loom) |
| Builder profile (GitHub / X / Farcaster) | https://github.com/r4topunk · TODO(owner): X and/or Farcaster URL |

## Team

TODO(owner): builder name or pseudonym, role, one line of background. The program allows pseudonymous builders.

## Grant and next milestones

This targets the same Arc Microgrants (DoraHacks) track as the author's other 2026-09 submission, ArcPull.
TODO(owner): confirm the current grant amount and whether the form asks for a use-of-funds breakdown or
milestones; if it does, split the amount across the items below — no amount is assumed here.

Candidate milestones, taken from the repo docs:
1. A hosted, always-on copy of `apps/web` (currently a static export anyone can build and serve themselves).
2. `scripts/reveal-cli.ts` as an optional, run-on-demand reveal helper for proposals nobody has revealed yet
   (the protocol needs no relayer — the site's own "Reveal votes" button already does this for a connected
   visitor).
3. Publish `@arcseal/sdk` and `@arcseal/tlock` to npm (currently pnpm-workspace-only).
4. Explore weighted membership or an `ERC20Votes`-style snapshot as a v2 option (out of v1 scope by design,
   PRD §2.2 — `Sealed.sol` itself is generic enough to support other apps besides `SealedDAO`, for example a
   sealed-bid auction or a hidden-move game, sketched as a non-deployed example in the integration docs).

## Mainnet deployment

| Contract | Address | Deploy tx | Block | Verified |
|---|---|---|---|---|
| SealedDAO | `0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44` | [`0xf583c2a2…`](https://explorer.arc.io/tx/0xf583c2a2be72d010465b4ea7cd70cd48ffeab8ee26dc2878a8e0f0838aae2287) | 21508506 | [Sourcify exact match](https://repo.sourcify.dev/5042/0x789f7689eFb75a1696C5A25d5aE97Ac2cF6A2c44) (runtime + creation) |

Members at deploy: three wallets the author controls (PRD D16); the address list and per-role names are in
`DEPLOY.md` §1 as keystore account names, never as keys. Deployed 2026-09-18 with CREATE2 salt
`keccak256("arcseal.v1")`, quorum 5000 bps, reveal payment 0.01 USDC per revealed vote; treasury funded with 2 USDC.

## Mainnet proof transactions

Same data as `deployments/arc-mainnet.json` `proofTxs` and the README's Mainnet proof table (links there). Rows
still `TBD` (finalize, execute, the transfer claim) land after the reveal window ends on 2026-09-19 14:08 UTC.

| # | Proof | Tx |
|---|---|---|
| 0 | Deploy (Sourcify-verified) / fund treasury (2 USDC) | 0xf583c2a2be72d010465b4ea7cd70cd48ffeab8ee26dc2878a8e0f0838aae2287 / 0xb7470d0b1c5fc7058e08c4ddac6b538093159bfd8b5fbe9fcb9eed2a1af4cc70 |
| 1 | Transfer proof: propose "pay 1 USDC" → 3 sealed votes (For, For, Against) → reveal → finalize → execute → claim | propose 0x353ef369ff80270563033490020657e81a2eb1154fc369784ae4470e89f13467; votes 0xf0f54f3ba7f6cefa321fae6004aec8ac70279569cb57495eebe900f08929a914 / 0x695a8ba13d59a20b24b9f42b650c63b3726b18ba358d21c3870a5150c1ccad8e / 0x9aa7f643784e588175d66c8edcce8cc5d4e7b4ac1f32e298c9b4add62efa5627; revealBatch 0x66e70f35000463ec17d28acfa7d035b2ca3ab81af332f44a50026dc41b828320; reveal-payment claim 0x4c534dc5d42fa2035cb1ed9018a2751ef0838929471fa94793f3ec5aacff1552; finalize `TBD`; execute `TBD`; claim `TBD` |
| 2 | Membership proof: propose "add a 4th member" → 2 sealed votes, 1 member abstains by not voting → reveal → finalize → execute (`memberCount == 4`) | propose 0x96991c2d06c38b299448c96a8e4ff8a412f037d44a7ea36adcbf52dde182e45a; votes 0x01886649dd11dc6a4a30d4d2c049d957ecee22ef0db476c4c6577a790a79f779 / 0xc32dc596c9172ec5959e94b2457bd65cd2fc99fda718142290fb678312a8aa43; revealBatch 0x781c14ee4a48f51c99fd3e161f9dafe2bc569b38812959b077fe486ccfb12319; finalize `TBD`; execute `TBD` |
| 3 | Negative proof: a proposal that fails quorum (only one member seals), revealed with one garbage item that gets skipped | propose 0x771c4edf0aeec984689bedf1cfb51801f69ffa0c8d16c4591caa0553ec4e8154; vote 0x516f2e824407ebf62e13034acd59150bd773dd39376da04652dbca93b4226391; revealBatch with a skipped item 0x49b4f6e0f582c8cb4d901b771af6e1a9e830fa8b7cc4d53a5cc5153bc13dafd2; finalize `TBD` (result `Failed`) |

PRD §10.2 definition of done: all three proofs recorded (done once the table above has real hashes), each
transaction status `success` on `https://explorer.arc.io`.

## Demo video script (2:00)

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Project page hero, then the envelope-metaphor diagram | "ArcSeal brings timelock encryption to Arc — data nobody can read before a chosen moment, and that anyone can open after it, without the author coming back." |
| 0:15–0:35 | Guarantees table, then `Sealed.sol` on the explorer/Sourcify page | "The primitive is one small abstract contract: it stores a hash and a drand round, and never parses a ciphertext. No relayer, no singleton, no onchain BLS check." |
| 0:35–1:00 | `/app/new/` creating a proposal, then `/app/proposal/?id=…` sealing a vote | "SealedDAO is the reference app: a member DAO with a USDC treasury. Every vote is sealed — encrypted to a future drand round — so there's no running tally and no bandwagon while voting is open." |
| 1:00–1:25 | "Reveal votes" button decrypting in the browser, then the `revealBatch` tx on the explorer | "Once the round is public, anyone can decrypt every vote in their own browser and submit them in one transaction. The treasury pays a small fixed amount per revealed vote to cover that gas." |
| 1:25–1:45 | Finalize → Execute → Claim, then the D17 privacy panel | "The vote is public per address after the reveal — this is not anonymity, and we say so plainly. What it removes is the running tally, and the bandwagon that comes with it, while voting is open." |
| 1:45–2:00 | Docs page (integration guide), then the repo | "It's MIT-licensed: inherit `Sealed.sol` for your own sealed-anything app, or use `SealedDAO` as-is. No token, no sale, no yield, no prize, no chance." |

Recording tips: record at 1440p; capture the reveal step live against a real drand round rather than a canned
demo, since the point of the primitive is that anyone, unscripted, can do it.

## Before pasting

- [ ] Contract deployed and Sourcify-verified (exact match) — [CHECKLIST.md](CHECKLIST.md) steps 9–11
- [ ] Public repo pushed and project page live — [CHECKLIST.md](CHECKLIST.md) steps 24–25
- [ ] All three proofs have status `success` on mainnet and are recorded above and in `deployments/arc-mainnet.json`
- [ ] `docs/GAS.md` mainnet column filled — [CHECKLIST.md](CHECKLIST.md) step 21
- [ ] TODO(owner): demo video uploaded and linked
- [ ] TODO(owner): X/Farcaster profile and team line
- [ ] TODO(owner): grant amount/milestones section confirmed against the live DoraHacks form
- [ ] Every `TBD` in this file replaced with a real value (`grep -n "TBD" SUBMISSION.md` returns nothing)
