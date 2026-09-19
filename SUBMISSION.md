# DoraHacks BUIDL submission: ArcSeal

Paste-ready submission for **Arc Microgrants | Circle** on DoraHacks, ordered like the form. Deadline:
**2026-10-14 23:59 ET** (DoraHacks shows 2026/10/15 00:59 in its own timezone). One BUIDL per project; the
author already has ArcDraw (48845), MemoKit (48844) and ArcPull (48843) under review in the same hackathon.

## For the operator session (read this first)

**Submitted on 2026-09-18: https://dorahacks.io/buidl/48963** (under review, editable before judging). What was
pasted is below. Mainnet status is in
[README.md](README.md#mainnet-proof) and `deployments/arc-mainnet.json`.

Rules:

- The final **Submit** click needs the owner's explicit OK in chat, after they have seen the filled form.
- The owner approved accepting the **Organizer Disclaimer** on 2026-09-18 (it shows before the form). If the
  harness asks again, ask the owner again.
- In the previous session the Claude Code auto-mode classifier blocked typing into this form ("Real-World
  Transactions"). Before starting, ask the owner to allow Chrome actions on `dorahacks.io` (or to approve each
  prompt). Do not work around a denial.
- The form keeps **no draft**: fill every step in one sitting. Dropdown options linger from earlier attempts, so
  re-check each select before moving on.
- Never paste keys; nothing here needs one.

Flow: https://dorahacks.io/hackathon/arc-microgrants/buidl → **Manage Submission** → tab **Submit new BUIDL** →
Organizer Disclaimer (**I Agree & Continue**) → **Create new BUIDL** → **Continue** → the 5 steps below:
Profile → Details → Team → Contact → Submission.

Logo: the form wants JPEG/PNG under 2 MB, 480 × 480 recommended; there is no logo file in the repo. Run this in
the page (Chrome `javascript_tool`) on the Profile step. It draws the project page's wax-seal favicon at 480 × 480
and puts it in the hidden file input (`#dh-form-test-logo`), which the form previews immediately:

```js
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 480'><rect width='480' height='480' fill='#FBF7EF'/><g transform='translate(48 48) scale(12)'><circle cx='16' cy='16' r='15' fill='#8C2A1E'/><path d='M10 21 L16 9 L22 21 M12.5 17 H19.5' fill='none' stroke='#FBF7EF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></g></svg>`;
const img = new Image();
await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480;
canvas.getContext('2d').drawImage(img, 0, 0, 480, 480);
const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
const input = document.getElementById('dh-form-test-logo');
const dt = new DataTransfer(); dt.items.add(new File([blob], 'arcseal-logo.png', { type: 'image/png' })); input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
```

After submitting: record the BUIDL URL in the README header table and in the owner's memory notes, then do
[After the proofs close](#after-the-proofs-close) once finalize and execute are onchain.

## Step 1: Profile

| Field | Value |
|---|---|
| BUIDL (project) name | `ArcSeal` |
| BUIDL logo | the snippet above |
| Vision | `Timelock-encrypted sealed voting for Arc: no running tally, no bandwagon, no lost votes.` |
| Category | `Crypto / Web3` |
| Key innovation domains (optional) | leave empty (ArcPull left it empty) |
| Layer-1s/L1s (optional) | type `Arc` and press Enter (Arc is not in the preset list; ArcPull shows the same `Arc` tag) |
| Layer-2s, Appchains, Other ecosystems (optional) | leave empty |
| GitHub/Gitlab/Bitbucket (required) | `https://github.com/r4topunk/arcseal` |
| Project website (optional) | `https://r4topunk.github.io/arcseal/` |
| Demo video (optional) | leave empty (no video; the other three BUIDLs have none either) |
| Social links (at least one, up to 3) | `https://x.com/r4topunk` · `https://farcaster.xyz/r4topunk` · `https://github.com/r4topunk` |

## Step 2: Details

Paste the whole block below as the BUIDL details. It is Markdown and uses the same sections as the ArcPull BUIDL.
The input box is inside the fence; the fence itself is not part of the text.

````markdown
ArcSeal is an MIT-licensed timelock-encryption primitive for Arc, plus a reference DAO built on it: a building block, not a SaaS.

An abstract module, `Sealed.sol`, stores only a hash commitment and a drand round per sealed item; it never sees a ciphertext or a vote choice. A TypeScript SDK (`@arcseal/sdk`) seals data with tlock, identity-based encryption keyed to a future drand quicknet round. Nobody can open it early, not even the author; anyone can open it once the round arrives, with no relayer and no singleton contract.

The reference app, `SealedDAO`, is a member-list DAO with a USDC treasury where every vote stays sealed until voting closes:

- no running tally and no bandwagon while voting is open: no vote is readable onchain
- no vote lost because a member never came back to reveal it: after the close, anyone (the site has a button) decrypts every vote in the browser and submits them in one `revealBatch`
- quorum counts sealed votes; passing counts revealed votes; ties fail
- for a proposal that met quorum, the treasury pays a small fixed amount per revealed vote to cover the revealer's gas
- every payout is pulled with `claim()`, never pushed, so a blocklisted address can never stall anyone else
- immutable contract: no owner, no upgrade, no pause

Secrecy holds only during voting: after the reveal, each vote is public per address, permanently. This is not anonymity and not coercion resistance, and the site says so plainly. No token, no sale, no yield, no prize, no chance.

What it uses Arc for:

- USDC as gas and as a 6-decimal ERC-20: the treasury and the gas are the same asset. A sealed vote (423-byte ciphertext in calldata and in an event) measured 68,303 gas, about 0.0014 USDC, on mainnet.
- Deterministic sub-second finality: a `Sealed` event is final on inclusion, so the drand round-to-block mapping needs no confirmation depth.
- USDC blocklist semantics drove pull-based payouts.
- The 10,000-block `eth_getLogs` cap is handled by windowed log scans in the SDK and the app.
- Arc has no VRF or timelock service today; ArcSeal brings its own.

Live on Arc mainnet since 2026-09-18 and Sourcify-verified (exact match, runtime and creation). All three demo proofs ran end to end: sealed, revealed (the first two through the site's "Reveal votes" button in the browser), finalized, executed and claimed on 2026-09-19, right after the fixed 24 h reveal window ended. 0 votes lost.

## Mainnet deployment

| Contract | Address | Deploy tx | Block | Verified |
|---|---|---|---|---|
| SealedDAO | [0x789f…2c44](https://explorer.arc.io/address/0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44) | [0xf583…2287](https://explorer.arc.io/tx/0xf583c2a2be72d010465b4ea7cd70cd48ffeab8ee26dc2878a8e0f0838aae2287) | 21508506 | [Sourcify exact match](https://repo.sourcify.dev/5042/0x789f7689eFb75a1696C5A25d5aE97Ac2cF6A2c44) |

Members at deploy: three wallets the author controls (0x39a7B6fa1597BB6657Fe84e64E3B836c37d6F75d, 0x47bD13c0e697Cb9324c19FbC1857D226781234E0, 0xE5A415927B5cCec27BC54a3F7b0140c9dc13bf31). Quorum 5,000 bps, reveal payment 0.01 USDC per revealed vote, treasury funded with 2 USDC. The proofs show the mechanism working end to end, not independent voters.

## Mainnet proof transactions

All transactions below have status success. Gas and cost come from the mainnet receipts (gas price ≈ 20 gwei).

| # | Proof | Tx | Gas | Cost (USDC) |
|---|---|---|---:|---:|
| 1 | Deploy `SealedDAO` (CREATE2 salt `keccak256("arcseal.v1")`) | [0xf583…2287](https://explorer.arc.io/tx/0xf583c2a2be72d010465b4ea7cd70cd48ffeab8ee26dc2878a8e0f0838aae2287) | 2,886,734 | 0.0577 |
| 2 | Fund the treasury (2 USDC, plain ERC-20 transfer) | [0xb747…cc70](https://explorer.arc.io/tx/0xb7470d0b1c5fc7058e08c4ddac6b538093159bfd8b5fbe9fcb9eed2a1af4cc70) | 48,950 | 0.0010 |
| 3 | Proof 1 · propose "pay 1 USDC to WALLET_C" | [0x353e…3467](https://explorer.arc.io/tx/0x353ef369ff80270563033490020657e81a2eb1154fc369784ae4470e89f13467) | 243,574 | 0.0049 |
| 4 | Proof 1 · sealed vote For (member 1) | [0xf0f5…a914](https://explorer.arc.io/tx/0xf0f54f3ba7f6cefa321fae6004aec8ac70279569cb57495eebe900f08929a914) | 68,291 | 0.0014 |
| 5 | Proof 1 · sealed vote For (member 2) | [0x695a…ad8e](https://explorer.arc.io/tx/0x695a8ba13d59a20b24b9f42b650c63b3726b18ba358d21c3870a5150c1ccad8e) | 68,315 | 0.0014 |
| 6 | Proof 1 · sealed vote Against (member 3) | [0x9aa7…5627](https://explorer.arc.io/tx/0x9aa7f643784e588175d66c8edcce8cc5d4e7b4ac1f32e298c9b4add62efa5627) | 68,303 | 0.0014 |
| 7 | Proof 1 · `revealBatch` from the site's "Reveal votes" button (3 of 3 revealed, 0.03 USDC reveal payment) | [0x66e7…8320](https://explorer.arc.io/tx/0x66e70f35000463ec17d28acfa7d035b2ca3ab81af332f44a50026dc41b828320) | 151,214 | 0.0030 |
| 8 | Reveal-payment `claim()` by the revealer (0.05 USDC: proofs 1 + 2) | [0x4c53…1552](https://explorer.arc.io/tx/0x4c534dc5d42fa2035cb1ed9018a2751ef0838929471fa94793f3ec5aacff1552) | 52,086 | 0.0010 |
| 9 | Proof 2 · propose "add OPS as the 4th member" | [0x9699…e45a](https://explorer.arc.io/tx/0x96991c2d06c38b299448c96a8e4ff8a412f037d44a7ea36adcbf52dde182e45a) | 249,312 | 0.0050 |
| 10 | Proof 2 · sealed vote For (member 1) | [0x0188…f779](https://explorer.arc.io/tx/0x01886649dd11dc6a4a30d4d2c049d957ecee22ef0db476c4c6577a790a79f779) | 68,315 | 0.0014 |
| 11 | Proof 2 · sealed vote For (member 2); member 3 abstains by not voting | [0xc32d…aa43](https://explorer.arc.io/tx/0xc32dc596c9172ec5959e94b2457bd65cd2fc99fda718142290fb678312a8aa43) | 68,315 | 0.0014 |
| 12 | Proof 2 · `revealBatch` from the site's "Reveal votes" button (2 of 2 revealed) | [0x781c…2319](https://explorer.arc.io/tx/0x781c14ee4a48f51c99fd3e161f9dafe2bc569b38812959b077fe486ccfb12319) | 82,106 | 0.0016 |
| 13 | Proof 3 · propose (negative proof, must fail quorum) | [0x771c…8154](https://explorer.arc.io/tx/0x771c4edf0aeec984689bedf1cfb51801f69ffa0c8d16c4591caa0553ec4e8154) | 249,212 | 0.0050 |
| 14 | Proof 3 · the only sealed vote (1 of 3 members, below the 50% quorum) | [0x516f…6391](https://explorer.arc.io/tx/0x516f2e824407ebf62e13034acd59150bd773dd39376da04652dbca93b4226391) | 68,303 | 0.0014 |
| 15 | Proof 3 · `revealBatch` with one garbage item: 1 `VoteRevealed` + 1 `RevealSkipped`, no reveal payment below quorum | [0x49b4…afd2](https://explorer.arc.io/tx/0x49b4f6e0f582c8cb4d901b771af6e1a9e830fa8b7cc4d53a5cc5153bc13dafd2) | 51,880 | 0.0010 |
| 16 | Proof 1 · `finalize`: Passed, 2 For / 1 Against | [0x8dca…660f](https://explorer.arc.io/tx/0x8dca055ebe4b7f35307349d7d94c402756ff1553b9d67fe16c8993ebec27660f) | 32,827 | 0.00066 |
| 17 | Proof 2 · `finalize`: Passed | [0x0116…ede4](https://explorer.arc.io/tx/0x0116d663ca7cebb641fb2cb7be047859a637bc4c1c4f413997023370acf7ede4) | 49,927 | 0.0010 |
| 18 | Proof 3 · `finalize`: Failed, quorum not met | [0xc473…4602](https://explorer.arc.io/tx/0xc473d686c51498c8c35efd97ccb8ee4ffa788eb740a4859ec5076b7c9b714602) | 49,904 | 0.0010 |
| 19 | Proof 1 · `execute`: 1 USDC credited to WALLET_C (pull-based) | [0xdfa9…2d46](https://explorer.arc.io/tx/0xdfa967add56dcb1be2673a90243019bcae1536251f2a164973cde67a300a2d46) | 93,187 | 0.0019 |
| 20 | Proof 2 · `execute`: `memberCount` 3 → 4 | [0x7c97…08ea](https://explorer.arc.io/tx/0x7c97e2cd6f904392c6a78a5813214e5f30dd0d823d53424c1d18b51dc48b08ea) | 66,939 | 0.0013 |
| 21 | Proof 1 · `claim()` by WALLET_C: 1 USDC | [0x8abc…6527](https://explorer.arc.io/tx/0x8abcfd3775e7459e7135b82427f749250d8e7b1d524dd4cd2229f999188a6527) | 52,086 | 0.0010 |

## Tech stack

- Chain: Arc mainnet (chainId 5042), USDC 0x3600…0000 (ERC-20 view, 6 decimals)
- Contracts: Solidity 0.8.30, Foundry (unit, fuzz, invariant, FFI vectors shared with the SDK, blocklist mock, read-only mainnet fork, adversarial-review regression tests), CREATE2 deploy
- Timelock encryption: drand quicknet (League of Entropy) as the clock; tlock-js 0.9.0 vendored, pinned to quicknet, running in Node and browsers, cross-checked against the Go `tle` CLI in both directions
- SDK: TypeScript, viem, Zod, tsup, Vitest (anvil integration and headless-Chromium seal/unseal tests)
- Website: Next.js (static export), React, wagmi, Tailwind CSS, EN/PT-BR
- Tests: 494 passing (contracts 173 + 3 fork tests skipped offline, tlock 72, SDK 129, web 77, scripts 43), CI on every push
- Tooling: pnpm workspaces, Biome
- License: MIT

## Links

| Field | Value |
|---|---|
| Live link (project page) | https://r4topunk.github.io/arcseal/ |
| Public repo | https://github.com/r4topunk/arcseal |
| App (proposals, vote, reveal, finalize, execute, claim) | https://r4topunk.github.io/arcseal/app/proposals/ |
| SealedDAO contract | https://explorer.arc.io/address/0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44 |
| Source verification (Sourcify, exact match) | https://repo.sourcify.dev/5042/0x789f7689eFb75a1696C5A25d5aE97Ac2cF6A2c44 |
| Spec and threat model | https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md · https://github.com/r4topunk/arcseal/blob/main/docs/THREATS.md |

## Grant and next milestones

The microgrant is a fixed 500 USDC.

Next milestones:

1. Publish `@arcseal/sdk` and `@arcseal/tlock` to npm, so any Arc app can seal and unseal with one install.
2. A second reference app on `Sealed.sol`: a sealed-bid auction (same module, different payload).
3. Measure Arc block timestamps against wall-clock time and drand publication latency on mainnet, and publish the result (the one open item in the threat model).
4. v2 option: weighted membership through `ERC20Votes`-style snapshots.
````

## Step 3: Team

Solo builder. Team description (pseudonym only, the owner's choice):

> r4to (r4topunk), solo builder. Researcher and builder working on AI agents and Web3. GitHub
> https://github.com/r4topunk, X and Farcaster @r4topunk. Designed, built, tested and deployed ArcDraw, ArcPull,
> MemoKit and ArcSeal on Arc mainnet.

## Step 4: Contact

Use the owner's contact details from the previous submissions (DoraHacks usually pre-fills them from the
profile). Not shown publicly. Ask the owner if a field is empty.

## Step 5: Submission

| Field | Value |
|---|---|
| Track | `All BUIDLs` |
| Need teammates? | `No` |

Stop here, show the owner the filled form (screenshots of each step), and click **Submit** only after their OK.

## After the proofs close

The reveal window ends on **2026-09-19 14:08 UTC** (11:08 BRT); the execution deadline is 2026-09-26 14:08 UTC.
The close runs with `cd scripts; and pnpm exec tsx .state/mainnet-close.ts` (a gitignored operator script that
finalizes all three proofs, executes 1 and 2, and claims WALLET_C's 1 USDC; it also writes the hashes into
`deployments/arc-mainnet.json`). Then:

1. Fill rows 16–21 of the proof table above (tx link, gas from `cast receipt <hash> gasUsed --rpc-url
   https://rpc.mainnet.arc.io`, cost = gas × 20 gwei), and change the status paragraph in the Details block to
   "finalized, executed and claimed".
2. Same values in the README proof table, `docs/GAS.md` (finalize / execute rows), and the proof tracker in
   `site/index.html` (EN and PT-BR dictionaries).
3. `pnpm check`, commit, push.
4. On DoraHacks: open https://dorahacks.io/buidl/48963 → **Edit** → replace rows 16–21 (they read "Pending: runs after
   the reveal window ends (2026-09-19 14:08 UTC)") and the status paragraph → save, with the owner's OK.

## Demo video script (2:00, optional)

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Project page hero | "ArcSeal brings timelock encryption to Arc: data nobody can read before a chosen moment, and that anyone can open after it, without the author coming back." |
| 0:15–0:35 | The anatomy of a sealed vote, then `SealedDAO` on Sourcify | "The primitive is one small abstract contract: it stores a hash and a drand round, and never parses a ciphertext. No relayer, no singleton, no onchain BLS check." |
| 0:35–1:00 | `/app/proposal/?id=1` on mainnet | "SealedDAO is the reference app: a member DAO with a USDC treasury. Every vote is sealed to a future drand round, so there is no running tally and no bandwagon while voting is open." |
| 1:00–1:25 | "Reveal votes", then the `revealBatch` tx on the explorer | "Once the round is public, anyone can decrypt every vote in their own browser and submit them in one transaction. The treasury pays a small fixed amount per revealed vote to cover that gas." |
| 1:25–1:45 | Finalize → Execute → Claim, then the privacy panel | "After the reveal each vote is public per address. This is not anonymity, and we say so plainly. What it removes is the running tally, and the bandwagon that comes with it, while voting is open." |
| 1:45–2:00 | Integration docs, then the repo | "It's MIT-licensed: inherit `Sealed.sol` for your own sealed-anything app, or use `SealedDAO` as it is. No token, no sale, no yield, no prize, no chance." |

## Checklist

- [x] Contract deployed and Sourcify-verified (exact match)
- [x] Public repo pushed, project page and app live
- [x] Proofs proposed, sealed and revealed on mainnet (0 votes lost)
- [x] BUIDL submitted: https://dorahacks.io/buidl/48963
- [x] Proofs finalized, executed, claimed (2026-09-19 14:11 UTC)
- [x] Details block, README, `docs/GAS.md` and site tracker updated with rows 16–21
- [ ] BUIDL 48963 edited with rows 16–21 and the new status paragraph (owner's OK)
