# CHECKLIST: human-only steps, in order

Everything in the repo is built and tested (`pnpm check` green — see [AGENTS.md](AGENTS.md) for exact counts).
These steps need a person: keys, real USDC, waiting out the 24 h reveal window, and publishing. Detailed
commands and explanations are in [DEPLOY.md](DEPLOY.md); the paste-ready DoraHacks text is in
[SUBMISSION.md](SUBMISSION.md). Never put a private key, seed or keystore password on a command line, in an
environment variable, or in any file inside this repo — only keystore **account names** (`arcseal-deployer`,
`arcseal-wallet-b`, `arcseal-wallet-c`) and `.env` **variable names** appear below.

**Definition of done:** `SealedDAO` is deployed and Sourcify-verified on Arc mainnet, the project page is live,
the repo is public, all three PRD §10.2 proofs are recorded with tx hashes in the README proof table and in
`deployments/arc-mainnet.json`, and the BUIDL is submitted on DoraHacks — all before **2026-10-14 23:59 ET**.

**Timing note:** every proposal's reveal window is a fixed 24 h after its close round, no matter how short its
voting period is (D5). Finalize is only possible after that window. So each of the three proofs costs at least a
day, and there is no way to shorten it — the fix is to run them **in parallel**: propose all three (and seal every
vote) in one sitting, let all three close within the same hour, then come back roughly a day later to reveal,
finalize, execute and claim all three. Do not run them one after another.

**Progress (2026-09-18):** testnet was skipped by owner decision; the offline anvil dry run covered the flow.
Mainnet SealedDAO `0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44` is deployed and Sourcify-verified, the treasury is
funded, and all three proofs ran end to end (finalize, execute and WALLET_C's claim on 2026-09-19 14:11 UTC,
after the reveal window; BUIDL https://dorahacks.io/buidl/48963). They ran through `cd scripts; and pnpm exec tsx
.state/mainnet-close.ts`, a gitignored operator script; the same calls are the site's Finalize / Execute / Claim
buttons.

| # | Step | Command / place | Done when | ✓ |
|---|---|---|---|---|
| 1 | Preflight: install, full check, offline rehearsal of the whole flow (no keys, no network) | `pnpm install; and pnpm check; and pnpm e2e:dry-run` (DEPLOY §0) | `pnpm check` exits 0; the dry run ends with `... executed, claimed` then `resume check: ... 0 transactions sent` | ✅ |
| 2 | Confirm the public repo name/URL (fixed by PRD D15, no decision needed) | `github.com/r4topunk/arcseal` free/owned; page will be `https://r4topunk.github.io/arcseal/` | name available or already yours | ✅ |
| 3 | Create the three keystores and read their addresses | DEPLOY §1: `cast wallet import arcseal-deployer --interactive` (repeat for `arcseal-wallet-b`, `arcseal-wallet-c`), then `set DEPLOYER (cast wallet address --account arcseal-deployer)` etc. | `cast wallet list` shows all three names; `$DEPLOYER`, `$WALLET_B`, `$WALLET_C` echoed and saved as `DEPLOYER_ADDRESS`/`WALLET_B_ADDRESS`/`WALLET_C_ADDRESS` in your local `.env` | ✅ |
| 4 | Pick the 4th member's address for proof 2 (`OPS_ADDRESS`) | Reuse any wallet you control, or `cast wallet import arcseal-ops --interactive` + `cast wallet address --account arcseal-ops` | `OPS_ADDRESS` set in `.env`; no vote or reveal is required from it in the proofs, only its address | ✅ |
| 5 | Fund the three testnet wallets from the faucet | `https://faucet.circle.com` for each of `$DEPLOYER`, `$WALLET_B`, `$WALLET_C`; check with the DEPLOY §3.1 balance loop against `--rpc-url arc_testnet` | each balance > 0 (member 1 needs ≈ 1.1 USDC, members 2–3 ≈ 0.05 USDC each) | ⏭ skipped |
| 6 | Deploy `SealedDAO` on **testnet** and record it | DEPLOY §3.2–§3.3 (simulate, then `--broadcast`; `node script/record-deployment.mjs 5042002`) | `deployments/arc-testnet.json` has the address, block and deploy tx; `memberCount`/`quorumBps`/`revealBounty`/`usdc` read back correctly | ⏭ skipped |
| 7 | Run the full PRD §8.4 end-to-end flow on **testnet first** — rehearses everything mainnet will do, with free USDC | `pnpm e2e:testnet` (DEPLOY §3.4); resumable, spans ≥ 24 h, re-run to continue after the pause | terminal prints `DONE: proposal N: 2 for / 1 against / 0 abstain, 3 of 3 sealed votes revealed, passed, executed, claimed`; `deployments/arc-testnet.json` `proofTxs` + `e2e` block are filled and every hash opens on `https://explorer.testnet.arc.io` | ⏭ skipped |
| 8 | Get ~5 USDC on Arc **mainnet** and split it | CCTP bridge (`https://docs.arc.io/app-kit/bridge.md`) or an exchange; split ≈ 3 / 1 / 0.5 / 0.5 USDC across deployer / WALLET_B / WALLET_C / buffer (DEPLOY §4.1) | balances confirmed with the DEPLOY §3.1 loop against `--rpc-url arc` | ✅ |
| 9 | Simulate, then deploy `SealedDAO` on **mainnet** with the CREATE2 salt | DEPLOY §4.2: simulate without `--broadcast` first, check the printed address (must equal the testnet DAO's address — same members, same CREATE2 formula), then deploy `--broadcast` | output ends `deployed 0x…` and `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`; tx successful on `https://explorer.arc.io/tx/<hash>` | ✅ |
| 10 | Record the mainnet deployment | DEPLOY §4.3: `node script/record-deployment.mjs 5042` | `deployments/arc-mainnet.json` has address, deploy block, deploy tx, deployer, salt hash | ✅ |
| 11 | Verify on Sourcify (exact match) | DEPLOY §4.4/§5: `forge verify-contract $DAO src/SealedDAO.sol:SealedDAO --chain-id 5042 --verifier sourcify --watch`, then the `curl .../fields=runtimeMatch` check | response shows `"runtimeMatch":"exact_match"`; set `contracts.SealedDAO.verified: true` in `deployments/arc-mainnet.json` | ✅ |
| 12 | Fund the treasury with 2 USDC | DEPLOY §4.5: `cast send 0x3600...0000 "transfer(address,uint256)" $DAO 2000000 --rpc-url arc --account arcseal-deployer` | `balanceOf($DAO)` reads `2000000`; hash recorded as `proofTxs.fundTreasury` | ✅ |
| 13 | Propose all three proofs together, 10-minute voting each | Site `/app/new/` (or SDK/`cast send propose`) from `arcseal-deployer`: (a) "Pay 1 USDC to WALLET_C" (`TransferUSDC`), (b) "Add member $OPS_ADDRESS" (`SetMember`), (c) any third action for the negative proof | 3 proposals exist (`proposalCount == 3`); hashes recorded as `proofTxs.transferPropose`, `addMemberPropose`, `quorumFailPropose` | ✅ |
| 14 | Proof 1 — seal 3 votes before its close round | Site `/app/proposal/?id=<transfer id>`, "Seal vote": For (deployer), For (WALLET_B), Against (WALLET_C) | 3 `Sealed` events on that proposal; hashes recorded as `proofTxs.transferVotes` (array of 3) | ✅ |
| 15 | Proof 2 — seal 2 votes, let the third member abstain by not voting | Site, same proposal id for the membership proposal: For (deployer), For (WALLET_B) — WALLET_C seals nothing | 2 `Sealed` events, `sealedCount == 2`; hashes recorded as `proofTxs.addMemberVotes` (array of 2) | ✅ |
| 16 | Proof 3 — only **one** member seals | Site, the negative-proof proposal id: one vote from any member (e.g. WALLET_B) | `sealedCount == 1`, below quorum for the member count at snapshot; hash recorded as `proofTxs.quorumFailVote` | ✅ |
| 17 | **Wait.** All three close rounds have passed and at least 24 h has elapsed since the *earliest* one | `cast call $DAO "status(uint256)(uint8)" <id> --rpc-url arc` for each id, or the site's countdown | all three proposals show `Revealing` or `Ready`; roughly a day has passed since step 13–16 | ✅ |
| 18 | Proof 1 — reveal, finalize, execute, claim | Site, from WALLET_B: "Reveal votes" → `revealBatch` (3 items); then "Finalize"; then "Execute"; then WALLET_C connects and clicks "Claim" | proposal `Passed` then `Executed`; WALLET_C's claimable balance is 0 after claiming; hashes recorded as `proofTxs.transferRevealBatch`, `transferFinalize`, `transferExecute`, `transferClaim`, and WALLET_B's reveal-payment claim as `transferBountyClaim` | ✅ |
| 19 | Proof 2 — reveal, finalize, execute | Site, from WALLET_B: "Reveal votes" → `revealBatch` (2 items); "Finalize"; "Execute" | `cast call $DAO "memberCount()(uint32)" --rpc-url arc` reads `4`; hashes recorded as `proofTxs.addMemberRevealBatch`, `addMemberFinalize`, `addMemberExecute` | ✅ |
| 20 | Proof 3 — reveal with one garbage item, then finalize (expected to fail) | `pnpm --filter @arcseal/scripts reveal --network mainnet --proposal <id> --account arcseal-wallet-b --garbage-item` (decrypts the one real vote and appends one item that matches no commitment); then "Finalize" on the site | the `RevealSkipped` event fires for the garbage item and `VoteRevealed` for the real one; `finalize` sets the proposal `Failed` (quorum not met); the reveal hash recorded as `proofTxs.revealBatchWithSkippedItem`, the finalize hash as `proofTxs.quorumFailFinalize` | ✅ |
| 21 | Fill the mainnet column of the gas table | For each hash above: `cast receipt <hash> gasUsed --rpc-url https://rpc.mainnet.arc.io` | every `TBD` in the "Arc mainnet gasUsed" column of `docs/GAS.md` is replaced with a number | ✅ |
| 22 | Update README, `deployments/arc-mainnet.json`, and the site | README "Mainnet proof" table + the `Contract`/`App` header rows; every `proofTxs` key in `deployments/arc-mainnet.json`; `site/index.html`'s status line and address list (both `en` and `pt` dictionaries) | no `TBD` left anywhere that has a real value now; `grep -rn "TBD — pending mainnet deployment" README.md site/index.html deployments/arc-mainnet.json` shows nothing left to fill | ✅ |
| 23 | Rebuild and check once more with the filled-in deployment files | `pnpm build; and pnpm check` | exits 0 | [ ] |
| 24 | Create the public GitHub repo and push (this repo currently has **no commits**) | `git add -A; and git commit -m "..."`, then `gh repo create r4topunk/arcseal --public --source=. --remote=origin --push` (or add the remote and push manually) | repo is public, README renders on GitHub, `contracts/lib/forge-std` submodule reference is present | [ ] |
| 25 | Enable GitHub Pages | Repo Settings → Pages → Source: GitHub Actions (uses the committed `.github/workflows/pages.yml`) | `https://r4topunk.github.io/arcseal/` is live, shows the filled-in status line and addresses, and `/app/proposals/` lists the three proof proposals as `Executed`/`Failed` | [ ] |
| 26 | Submit the BUIDL on DoraHacks | `https://dorahacks.io/hackathon/arc-microgrants` (see `SUBMISSION.md`) — **the form keeps no draft, so fill every field in one sitting; dropdown selections linger from a previous attempt, so re-check each one before submitting** | submission confirmed before **2026-10-14 23:59 ET** | [ ] |

## If short on time

Steps 1–12 have no shortcut (deploy, verify, fund). For the proofs, the only real time-saver is already the
default path above: propose and seal all three in one sitting (step 13–16) so their 24 h reveal windows overlap,
instead of running them one after another (which would cost 3 days instead of about 1). Do not skip any of the
three proofs — PRD §10.2 requires all three (positive transfer, positive membership change, negative/quorum-fail)
for the definition of done. Step 21 (mainnet gas column) can be filled right up until submission if time is short;
it is not required for the BUIDL text itself, only for `docs/GAS.md`.

## UNKNOWN

- Whether Sourcify also records a `creationMatch` for a CREATE2 factory deployment when given
  `--creation-transaction-hash` (DEPLOY §5). The runtime `exact_match` from step 11 is what PRD §10.2 requires; a
  creation match is a bonus, try it once and ignore a failure.
- The exact content of proof 3's proposal (PRD §10.2 step 6 only specifies that it must fail quorum). Any
  `TransferUSDC` or `SetMember` action works, provided it does not accidentally pass or get executed later at a
  different quorum — a small, clearly-labeled test payload (for example "quorum-fail proof, ignore if seen") is
  simplest so it reads unambiguously as a deliberate negative test in the explorer and in the README.
- Whether `WALLET_C`'s USDC withdrawal path to fund its testnet/mainnet balance needs an exchange or only the
  Circle faucet + CCTP bridge (mainnet has no faucet; see DEPLOY §4.1).
