# AGENTS.md: ArcSeal

Instructions for AI agents and contributors working in this repo.

## TL;DR

```bash
git submodule update --init --recursive
pnpm install
pnpm build                  # forge build + tlock, sdk, web, scripts builds
pnpm test                   # forge test (full suite) + tlock/sdk/web/scripts vitest (throwaway anvil where needed)
pnpm check                  # build + test + typecheck + lint (biome) + forge fmt --check + ABI drift + gas snapshot check
pnpm contracts:test         # forge test -vvv only (builds the SDK first: test/ffi needs the built hashVote FFI script)
pnpm contracts:test:ci      # forge test, quiet (same build-SDK-first step; what `pnpm test` runs)
# read-only fork check against real Arc mainnet USDC (nothing broadcast); skipped unless ARC_RPC is set:
cd contracts && env ARC_RPC=https://rpc.mainnet.arc.io forge test --match-contract ArcUsdcForkTest -vv
# regenerate SDK ABI after a contract change (writes packages/sdk/src/abi/SealedDAO.ts, generated, never hand-edited):
pnpm contracts:abi
pnpm sdk:check-abi          # fails if the committed module is stale (part of `pnpm check`)
# gas snapshot (contracts/.gas-snapshot; excludes invariant/ffi/fork/audit — see docs/GAS.md):
pnpm contracts:snapshot         # regenerate
pnpm contracts:snapshot:check   # check at 5% tolerance (part of `pnpm check`)
# per-operation gas breakdown + the EIP-7623 anvil probe (throwaway local anvil, unlocked accounts, no keys):
bash contracts/script/gas-anvil.sh
# regenerate the tlock cross-implementation vectors (packages/tlock/test/vectors/*.json) — needs network + Go tle v1.2.0:
go install github.com/drand/tlock/cmd/tle@v1.2.0
pnpm --filter @arcseal/tlock vectors:gen
# offline rehearsal of the whole PRD 8.4 flow on a local anvil (no keys, no network, ~10 s):
pnpm e2e:dry-run
pnpm e2e:dry-run --keep-alive   # leaves anvil on :8545 and prints NEXT_PUBLIC_* for `apps/web` dev/e2e use
```

## Sources of truth

| Topic | File |
|---|---|
| Product scope, the 18 fixed decisions (D1–D18), non-goals | `PRD.md` |
| Contract behavior, round math, security model in full detail (per-threat handling + tests) | `docs/SPEC.md`, `docs/THREATS.md` |
| Contract ABI (binding) | `contracts/src/Sealed.sol` (abstract primitive), `contracts/src/SealedDAO.sol` (app) |
| Generated ABI for TS | `packages/sdk/src/abi/SealedDAO.ts` (never edit by hand — see TL;DR) |
| Gas numbers | `docs/GAS.md` |
| Addresses and proof txs | `deployments/arc-mainnet.json`, `deployments/arc-testnet.json` |
| Mainnet/testnet runbook (human steps) | `DEPLOY.md`, `CHECKLIST.md` |
| DoraHacks submission text | `SUBMISSION.md` |
| SDK API reference | `packages/sdk/README.md` |

If code and `docs/SPEC.md` disagree, fix the code, or update SPEC in the same commit with a reason. The PRD's 18 decisions (D1–D18) are final: do not reopen them; a genuine gap goes in a doc's own UNKNOWN section, not into a silent behavior change.

## Layout

```
contracts/          Foundry (solc 0.8.30, evm prague), forge-std as a git submodule
  src/Sealed.sol       abstract primitive: commitment + drand-round bookkeeping, hash verification, reveal window
  src/SealedDAO.sol     concrete app: members, USDC treasury, proposals, sealed voting, tally, execute, claim
  src/interfaces/       IERC20.sol only — no other external dependency
  script/               Deploy.s.sol (CREATE2), record-deployment.mjs, gas-anvil.sh
  test/unit,fuzz,invariant,ffi,fork,audit,mocks/   see "Test layers" below
packages/tlock       @arcseal/tlock   vendored tlock-js 0.9.0, quicknet only, Node + browser
packages/sdk         @arcseal/sdk    viem-based client: round math, seal/unseal, viem actions, Zod schemas, pino logs
apps/web             @arcseal/web    Next.js static export: proposals, vote, reveal, treasury, docs (EN/PT-BR)
scripts/             @arcseal/scripts   e2e-testnet.ts (PRD §8.4, also the dry-run harness), reveal-cli.ts (optional, not hosted)
docs/                SPEC.md, THREATS.md, GAS.md
deployments/         arc-mainnet.json, arc-testnet.json (committed); anvil-dry-run.json (gitignored, local only)
site/                index.html — project page, GitHub Pages root, no build step
```

## Test layers (`contracts/test/`)

- **unit/** — one file per contract/behavior area (`Sealed.t.sol`, `SealedDAO.t.sol`, `SealedDAO.revealBatch.t.sol`, `SealedDAO.blocklist.t.sol`, `SealedRoundMath.t.sol`, `Deploy.t.sol`) plus the gas-measurement suite (`SealedDAO.gas.t.sol`, feeds `docs/GAS.md`).
- **fuzz/** — `Sealed.fuzz.t.sol`, `SealedDAO.fuzz.t.sol`: random members/choices/salts/ciphertext lengths, tally-vs-oracle.
- **invariant/** — `SealedDAO.invariant.t.sol` + `SealedDAOHandler.sol`: `balanceOf(this) >= totalClaimable`, `forCount + againstCount + abstainCount == revealedCount <= sealedCount <= memberSnapshot`, a proposal never leaves `Executed`/`Expired`.
- **ffi/** — `HashVote.ffi.t.sol`: shells out to `packages/sdk/scripts/ffi-hash-vote.mjs` (built SDK) and checks 10 vectors in `test/vectors/hashvote.json` against the Solidity `hashVote`. Needs the SDK built first — `pnpm contracts:test`/`test:ci`/`test` all do this for you.
- **fork/** — `ArcUSDC.fork.t.sol`: read-only checks against the real Arc mainnet USDC proxy. Skipped unless `ARC_RPC` is set (3 tests skip by default; this is expected, not a failure).
- **audit/** — `A0`–`F8`: Phase 4 security-review repro + regression tests (see `docs/THREATS.md` for what each one pins). Excluded from the gas snapshot (they replay attacks that meter unrepresentative gas) but always run in `forge test`.

Current counts (from a real `pnpm check` run, re-check before trusting an older number): contracts 173 passed + 3 skipped (fork, no `ARC_RPC`) = 176 total; `@arcseal/tlock` 72; `@arcseal/sdk` 129; `@arcseal/web` 77; `@arcseal/scripts` 43.

## Conventions

- Language: English everywhere (code, comments, docs, commits). The web app additionally ships PT-BR strings (`apps/web/src/lib/i18n.ts`, `apps/web/content/pt-BR/*.md`, `site/index.html`); every EN string needs a PT-BR counterpart with the same `data-i18n` / dictionary key.
- Package manager: pnpm workspaces (`pnpm-workspace.yaml`). Do not add npm or yarn lockfiles. Add a dependency with `pnpm --filter <pkg> add ...`, never a bare `pnpm install` unless the lockfile actually needs re-resolving.
- USDC amounts onchain and in the SDK are **6-decimal ERC-20 base units** (`bigint`), read from `0x3600000000000000000000000000000000000000`. The same address also has a native, 18-decimal *view* of the identical balance — never read it, never sum it with the ERC-20 view, never mix decimals in a UI string.
- Solidity: custom errors (no revert strings), NatSpec on external/public functions, checks-effects-interactions, `nonReentrant` on `claim`, `execute` and `revealBatch` (they share one transient lock), no external dependency beyond `IERC20`. `forge fmt` line length 120 (`contracts/foundry.toml`).
- TypeScript: strict mode, ESM, viem only (no ethers), Zod for every public SDK input and for env/config parsing in `scripts/` and `apps/web`.
- Logging (`@arcseal/sdk`): pino child logger with a correlation id per `unsealProposal` call (`packages/sdk/src/logger.ts`); `LOG_LEVEL=info`/`debug` shows it in the operator scripts.
- Tests that need a chain start their own throwaway anvil on a free port with unlocked dev accounts (`scripts/`, `packages/sdk/test/anvil.test.ts`, `apps/web/scripts/e2e-anvil.mjs`). Never hardcode an anvil private key; sign from an unlocked account or a `cast wallet new --unsafe-password` throwaway keystore created inside the test.
- Every contract function, every round-math/seal/unseal/reveal SDK helper, and every non-trivial web helper (formatting, receipts, error mapping) needs a test. A new custom error needs both a Foundry revert test and, if it is user-facing, an entry in `apps/web/src/lib/errors.ts` (EN + PT-BR).
- Commits: small, imperative subject (for example `contracts: gate the reveal bounty on quorum`).

## Invariants not to break

These are load-bearing; a change to `SealedDAO.sol` or `Sealed.sol` that violates one needs a PRD decision update, not just a passing test tweak:

1. `usdc.balanceOf(address(this)) >= totalClaimable` at all times (checked by `SealedDAOInvariantTest`).
2. `forCount + againstCount + abstainCount == revealedCount <= sealedCount <= memberSnapshot` for every proposal.
3. A proposal never leaves `Executed` or `Expired` once it reaches either.
4. The hash is the sole authority: nothing onchain ever parses a ciphertext (D11). `_verifyReveal` never reverts on mismatch — it returns `false` so `revealBatch` can skip.
5. All payouts are pull-only via `claim()` (D13); no code path pushes USDC to an arbitrary address.
6. Quorum is measured over **sealed** votes against `memberSnapshot`; passing is measured over **revealed** votes only, ties fail (D4). Don't conflate the two counters.
7. The reveal bounty is credited only when quorum was met (Phase 4 finding F1) — a lone member must never be able to farm the treasury with throwaway proposals.
8. `propose` rejects the DAO's own address and the USDC token as a payout/member target (F6); `execute` rejects removing the last member (F7); `descriptionURI` is bounded (F8, `MAX_DESCRIPTION_URI_LENGTH`).
9. Immutable: no owner, no upgrade, no pause, no `SetParams` proposal kind (D14, §2.2).

## Hard rules

1. **Never send a transaction to Arc mainnet or Arc testnet** from an agent session. No `--broadcast` against a remote RPC, no `cast send` to a remote RPC. Local anvil only. `contracts/test/fork/*` (real Arc data) must stay read-only.
2. **Never read, cat, grep, source, print or copy `/Users/r4to/Script/arc/.env`, any other `.env*` file, a Foundry keystore, or a private key or seed.** Use `.env.example` only. Deploy and operator scripts take signers from Foundry encrypted keystores (`--account`), supplied by the human operator (`DEPLOY.md`). Forge cheatcode accounts (`makeAddrAndKey`) are fine in tests only.
3. **Never publish**: no `git commit`, `git push`, `gh repo create`, `npm publish`, or any deploy of `apps/web`/`site/`. This repo has no commits yet; that stays a human step (`CHECKLIST.md`).
4. Keep to the v1 scope in `PRD.md` §2 and the 18 fixed decisions in §3. Anything in §2.2 (out of scope) is documentation/design only, never built.
5. Before calling work done, run the relevant build/test commands above and report the **real** output (exact test counts, exact `pnpm check` exit code) — never an estimate.

## Arc gotchas

- Chain id `5042` (mainnet, Foundry alias `arc`), `5042002` (testnet, alias `arc_testnet`); both RPCs and the CREATE2 deployer alias live in `contracts/foundry.toml` / `DEPLOY.md`.
- USDC `0x3600000000000000000000000000000000000000`: an ERC-20 (6 decimals) view and, at the *same address*, an 18-decimal native-balance view of the identical asset. Read only the ERC-20 view (`balanceOf`, `transfer`) — never the native balance, never both.
- The USDC blocklist reverts `transfer`/`transferFrom` for a blocked address. This is exactly why every payout in `SealedDAO` is pull-based (`claim()`, D13): a blocked or unresponsive recipient can never stall anyone else's reveal, finalize, execute or claim.
- `eth_getLogs` is capped at 10,000 blocks on the public RPC; the SDK's `unsealProposal`/`listProposals` and the web app's log scans all paginate in windows of at most 9,999 blocks.
- EIP-7623 calldata floor pricing is active on Arc. Plain `anvil --hardfork prague` (1.7.1) reproduces it — no need for a special Arc-flavored anvil (`docs/GAS.md` "EIP-7623 on anvil"). It never actually binds for `SealedDAO`'s calls; they're execution-heavy, not calldata-heavy.
- A gas estimate taken one second before inclusion can under-price a call whose cost depends on state that moves between simulation and mining (for example a `revealBatch` that ends up crediting a bounty when the estimate assumed it wouldn't). Local-account SDK/script writers pad the estimate by 20% (`withGasMargin`); a JSON-RPC/browser wallet is expected to add its own margin.
- Sourcify (not Blockscout/`explorer.arc.io`'s API, which sits behind a Cloudflare challenge) is the verification path for both Arc chains; a CREATE2 deployment needs no manually-encoded constructor arguments for a runtime exact match (`DEPLOY.md` §5, PRD §14).
- Plain anvil does not emulate Arc's native-coin precompile that FiatToken's real `transfer` calls on Arc; that's why the local dry run (`pnpm e2e:dry-run`) etches a `MockUSDC` instead of forking Arc, and why `claim`'s exact mainnet gas is a `TBD` in `docs/GAS.md` until the proof run.
