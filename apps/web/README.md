# @arcseal/web

Static Next.js app for **SealedDAO**: list proposals, seal a vote, reveal every vote in the browser, finalize,
execute, claim, fund the treasury, and read the docs. English and Brazilian Portuguese. No backend: the browser reads
the chain over the public RPC and decrypts votes locally with drand.

## Routes

| Path | What |
|---|---|
| `/app/proposals/` (also `/app/`) | Proposals with status chips, close and reveal deadlines (drand round + wall-clock time + countdown), sealed/revealed/for/against/abstain counts and quorum progress |
| `/app/proposal/?id=N` | One proposal and the action for its status: seal a vote (Voting), reveal votes or only mine (Revealing), finalize (Ready), execute (Passed), result (Executed, Failed, Expired). Event timeline with explorer links |
| `/app/new/` | Create a proposal (members only): TransferUSDC or SetMember, description up to 256 bytes, optional link, 10 min / 1 h / 24 h / 7 d |
| `/app/treasury/` | Treasury balance, owed to claimers, free, your claimable and Claim, Fund treasury, members, parameters |
| `/docs/<slug>/` | `content/<locale>/<slug>.md` rendered at build time (one page per file in `content/en`) |
| `/` | Local entry point only. On GitHub Pages, `site/index.html` replaces it |

The proposal page takes its id from the query string because a static export cannot pre-render ids that do not
exist yet.

## Configuration

Read at build time (`NEXT_PUBLIC_*` values are baked into the export). Placeholders such as `[ADDRESS]` count as unset.

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `5042` | `5042` Arc mainnet, `5042002` Arc testnet, `31337` local anvil |
| `NEXT_PUBLIC_RPC_URL` | per chain | `https://rpc.mainnet.arc.io`, `https://rpc.testnet.arc.io`, `http://127.0.0.1:8545` |
| `NEXT_PUBLIC_EXPLORER_URL` | per chain | `https://explorer.arc.io`, `https://explorer.testnet.arc.io`, none on anvil (hashes shown without links) |
| `NEXT_PUBLIC_DAO_ADDRESS` | unset | Without it every page shows "No DAO configured" and nothing is read from the chain |
| `NEXT_PUBLIC_DAO_DEPLOY_BLOCK` | `0` | First block of every log scan. Set it: scans walk 9,999-block windows from here |
| `NEXT_PUBLIC_SITE_URL` | `https://r4topunk.github.io/arcseal` | Project page link |
| `NEXT_PUBLIC_REPO_URL` | `https://github.com/r4topunk/arcseal` | Source links |
| `NEXT_PUBLIC_BASE_PATH` | empty | `/arcseal` on GitHub Pages |

A connected wallet on another chain gets a banner with a switch button. Configuration problems (unsupported chain,
missing deploy block) show in a banner too.

## Commands

```sh
pnpm --filter @arcseal/web dev          # http://localhost:3000/app/proposals/
pnpm --filter @arcseal/web build        # static export in apps/web/out
pnpm --filter @arcseal/web test         # vitest + Testing Library (jsdom)
pnpm --filter @arcseal/web typecheck
pnpm --filter @arcseal/web lint         # biome

# A build for a deployed DAO (fish: env VAR=value cmd)
env NEXT_PUBLIC_CHAIN_ID=5042002 NEXT_PUBLIC_DAO_ADDRESS=0x... NEXT_PUBLIC_DAO_DEPLOY_BLOCK=123 pnpm --filter @arcseal/web build

# The GitHub Pages layout, locally: export under /arcseal, then site/ on top (what .github/workflows/pages.yml does)
env NEXT_PUBLIC_BASE_PATH=/arcseal pnpm --filter "@arcseal/web..." build
rm -rf _site; mkdir _site; cp -R apps/web/out/. _site/; cp -R site/. _site/
```

### End-to-end check on a local anvil

`pnpm --filter @arcseal/web e2e:anvil` starts a throwaway anvil, deploys MockUSDC and SealedDAO with three members,
builds the export for it and drives headless Chromium through the whole flow: create a proposal, three sealed votes
(one with localStorage blocked, which must force the receipt download), reveal only mine from the uploaded receipt,
reveal all (decrypt in the browser, one `revealBatch`), finalize, execute, claim, fund, the non-member notice and the
PT-BR toggle. It fails on any console error. A wallet stub forwards to anvil's unlocked dev accounts, so no key is
handled, and drand round 32,000,000 comes from the committed beacon, so it runs offline in about 15 seconds on a laptop.

It needs `anvil`, `contracts/out` (`pnpm contracts:build`) and Chromium (`pnpm exec playwright install chromium`),
and it overwrites `apps/web/out`: rebuild afterwards for a normal export. Screenshots:
`env SHOTS_DIR=/tmp/arcseal-shots pnpm --filter @arcseal/web e2e:anvil`.

## Rules the app follows

| Rule | Where |
|---|---|
| Every deadline shows the drand round and the wall-clock time | `components/deadline.tsx`. Countdowns follow the chain clock when it differs from the local one by 10 s or more (`components/chain-clock.tsx`) |
| USDC always in the 6-decimal ERC-20 view, never the 18-decimal native view | `lib/format.ts`. Balances use `balanceOf` on the DAO's `usdc()` |
| Fee estimates in USDC | `estimateGas x gasPrice` (18-decimal native units) converted to 6 decimals, labelled "est. network fee" (`components/fee.tsx`) |
| Every write shows its hash with an explorer link | toasts plus the session list (`components/tx.tsx`) |
| Every contract error is a sentence, in both languages | `lib/errors.ts` maps all SealedDAO ABI errors (typed, so a new error fails typecheck), the USDC blocklist string, wallet rejection, RPC and drand failures |
| Vote receipts survive without drand | stored in localStorage under `arcseal:receipt:v1:<chainId>:<dao>:<proposalId>:<voter>` before the vote transaction exists; offered as a JSON download; downloaded automatically when storage is blocked (`lib/receipts.ts`) |
| Privacy statement (D17) next to the vote button | `components/proposal/privacy-note.tsx` |
| Language | EN default; the choice is stored under `arcseal:lang`, the same key the project page uses, so it carries over |
| Storage never breaks a page | every localStorage access, wagmi's included, goes through `lib/storage.ts` |

## Tests

`test/`: status chip for each of the 7 statuses, form validation and the byte counter, USDC formatting and parsing
edge cases, fee conversion, receipt round trip including disabled and full storage, contract and wallet error mapping
in EN and PT-BR, i18n completeness and placeholders, countdowns and round display, the chain clock offset, markdown
link rewriting with a basePath, and build configuration parsing.
