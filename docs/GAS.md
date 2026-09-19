# Gas

> Measured 2026-09-18 with forge and anvil 1.7.1 (solc 0.8.30, optimizer 10,000 runs, `evm_version = "prague"`),
> re-measured after the Phase 4 security fixes (see [Phase 4 deltas](#phase-4-deltas)).
> **Execution gas (forge)**: `vm.lastCallGas` of the call on cold storage, from `test/unit/SealedDAO.gas.t.sol`. It excludes
> the 21,000 intrinsic gas and the calldata cost. **Full tx gas (anvil prague)**: `gasUsed` of the real receipt on a local
> `anvil --hardfork prague` (intrinsic, calldata, execution and refunds included), from `contracts/script/gas-anvil.sh`.
> USDC is `MockUSDC` (6 decimals, blocklist), so token calls differ slightly from Arc's USDC proxy (see "Other measurements").
> Cost column: Arc's 20 gwei floor, paid in USDC (1 gas = 0.00000002 USDC).
> The Arc mainnet column is filled from the PRD 10.2 proof transactions (`cast receipt <hash> gasUsed`) on
> SealedDAO `0x789f7689efb75a1696c5a25d5ae97ac2cf6a2c44` (2026-09-18/19). On mainnet `execute` TransferUSDC to a
> first-time recipient cost 93,187, over the 60k target: at that moment nothing else was owed, so both
> `claimable[target]` and `totalClaimable` went from zero to non-zero, and the token is Arc's real USDC. Also measured there: deploy 2,886,734 gas (0.0577 USDC),
> `propose` 243,574 – 249,312, funding the treasury (plain USDC transfer) 48,950. Effective gas price was 20.0026 gwei.

## PRD 4.5 calls

| Call | Target (PRD 4.5) | Execution gas (forge) | Full tx gas (anvil prague) | USDC at 20 gwei | vs target | Arc mainnet gasUsed |
|---|---:|---:|---:|---:|---|---:|
| `vote`, 455-byte ciphertext (PRD 4.5 size) | ≤ 80,000 | 39,702 | 69,066 | 0.00138 | within (-10,934) | n/a (the SDK sends 423 bytes) |
| `vote`, 423-byte ciphertext (what the SDK sends) | ≤ 80,000 | 39,439 | 68,303 | 0.00137 | within (-11,697) | 68,291 – 68,315 (6 votes) |
| `revealBatch`, 1 item | ≤ 45,000 per item | 75,362 | 98,426 | 0.00197 | **over** (+53,426) | 51,880 (1 valid + 1 garbage item, below quorum: no bounty, proof 3) |
| `revealBatch`, 3 items (demo size), per item | ≤ 45,000 per item | 40,469 | 48,634 | 0.00097 | **over** (+3,634) | 50,405 (151,214 for 3; first bounty credit, proof 1) |
| `revealBatch`, 10 items, per item | ≤ 45,000 per item | 20,207 | 23,427 | 0.00047 | within (-21,573) | — |
| `revealBatch`, 50 items, per item | ≤ 45,000 per item | 13,264 | 14,719 | 0.00029 | within (-30,281) | — |
| `revealBatch`, 256 items, per item | ≤ 45,000 per item | 11,887 | 12,986 | 0.00026 | within (-32,014) | — |
| `finalize` | ≤ 60,000 | 11,623 | 32,827 | 0.00066 | within (-27,173) | 32,827 (proof 1) · 49,927 / 49,904 (proofs 2, 3) |
| `execute` TransferUSDC, first payout to the recipient | ≤ 60,000 | 49,559 | 70,763 | 0.00142 | **over** (+10,763) | **93,187** (proof 1: `claimable[target]` and `totalClaimable` both 0 → non-zero, real USDC) |
| `execute` TransferUSDC, recipient with a pending claim | ≤ 60,000 | 32,459 | 53,663 | 0.00107 | within (-6,337) | — |
| `execute` SetMember (add) | none | 45,735 | 66,939 | 0.00134 | n/a | 66,939 (proof 2) |
| `claim` (claimer already holds USDC, as every Arc sender does) | ≤ 55,000 | 33,074 | 49,338 | 0.00099 | within (-5,662) | 52,086 (bounty claim, WALLET_B) |

Whole `revealBatch` calls: 3 items 145,902 (demo DAO, For / For / Against; forge's 3-item scenario cycles
For / Against / Abstain and models 146,512), 10 items 234,275, 50 items 735,997, 256 items 3,324,594 (0.06649 USDC).
All revealBatch rows are the worst case: a proposal that met quorum (so the bounty is due; below quorum nothing is
credited and the call is cheaper), revealed by a first-time revealer (`claimable[revealer]` 0 -> non-zero) in a DAO
with nothing reserved yet (`totalClaimable` 0 -> non-zero). The 1 / 10 / 50-item scenarios seal 128 of 256 member
votes (the 50% quorum) and reveal the first `n`.

PRD 13 metrics on these numbers: a sealed vote costs 0.00137 USDC (target ≤ 0.002) and a revealed vote 0.00197 USDC alone
or 0.00097 USDC in the demo batch (target ≤ 0.003). The 0.01 USDC bounty per revealed vote covers the revealer's gas at
every batch size.

### Where the misses come from

- **`revealBatch` fixed cost.** One call pays 21,000 intrinsic gas plus about 64k of fixed execution (75,362 at 1 item
  minus 11,638 per extra item): the first bounty credit writes two zero slots (`claimable[revealer]` and
  `totalClaimable`, 22,100 each under EIP-2200/2929), the tally lives in two proposal slots (about 5,000 each),
  `usdc.balanceOf` is a cold external call (about 5,000), and the reentrancy lock and the quorum check add about 1k. The
  marginal cost of one more item is 12,652 full-tx gas ((3,324,594 - 98,426) / 255): a cold commitment read, the
  commitment -> sentinel write, the `Revealed` and `VoteRevealed` logs and 96 bytes of calldata. From 10 items the
  per-item cost is well under target; a repeat revealer, or a DAO that already has claims reserved, saves up to about
  34k of the fixed part (both writes become non-zero -> non-zero). The fixed part is the price of the pull-based bounty
  (D6 + D13); the struct layout of PRD 4.3 is kept as written.
- **`execute` TransferUSDC to a new recipient.** Crediting a pull payment (D13) writes `claimable[target]` from 0: 22,100
  gas on its own. With a pending claim the same call is 53,663, under target. No layout change removes that write.

## EIP-7623 on anvil (PRD 14, second UNKNOWN): settled

Plain `anvil --hardfork prague` (1.7.1) applies EIP-7623 floor pricing; `arc-anvil` is not needed for it. The probe in
`gas-anvil.sh` sends 1,000 non-zero calldata bytes to an EOA:

| anvil | gasUsed | expected |
|---|---:|---|
| `--hardfork prague` | 61,000 | EIP-7623 floor: 21,000 + 10 × 4,000 tokens |
| `--hardfork cancun` | 37,000 | standard: 21,000 + 16 × 1,000 |

The floor never binds for SealedDAO: every call's execution gas dwarfs its calldata (for example `vote` 455 pays 8,364
of standard calldata gas; its floor would be 41,910 against 69,040 used). So "40 gas per non-zero byte" (PRD 9) is the
floor rate, reached only by calldata-heavy transactions with little execution; ArcSeal pays the standard 16 per byte.
The forge "tx model" (21,000 + calldata + execution - capped refund, floored by EIP-7623) printed by
`SealedDAO.gas.t.sol` equals the anvil receipts exactly for `vote` 423, `revealBatch` 1, `finalize`, the three `execute`
rows and `claim`, and is within 48 gas elsewhere (different pseudo-random ciphertext and salt bytes).

## Other measurements

| Measurement | Gas | Source |
|---|---:|---|
| `propose` TransferUSDC, 8-byte description, 15-byte URI (4th proposal) | 201,475 | anvil receipt (first proposal: 218,587, forge model; `proposalCount` 0 -> 1). The same in every second since Phase 4 (audit F4) |
| deploy `SealedDAO`, 3 members | 2,880,794 (0.05762 USDC) | anvil receipt |
| `execute` TransferUSDC with Arc's real USDC proxy, forked Arc mainnet | 47,883 execution | `test/fork/ArcUSDC.fork.t.sol`, warm token account; MockUSDC in the same conditions: 47,059. Measured before Phase 4; that code path did not change (forge execution gas of the row above is identical) |

On Arc mainnet expect roughly +1k to +3.5k gas on every call that touches USDC (`revealBatch` with a bounty, `execute`
TransferUSDC, `claim`): FiatToken is a proxy, so each call adds a DELEGATECALL and, in a fresh transaction, one more cold
account. `claim` cannot be measured locally at all: FiatToken's `transfer` on Arc calls a native-coin precompile at
`0x1800000000000000000000000000000000000000` that plain forge / anvil forks do not implement (the local EVM stops with
`OpcodeNotFound`). The mainnet column settles both.

## Phase 4 deltas

The Phase 4 security review (audit findings F1, F3, F4, F6, F7, F8; repro and regression tests in
`contracts/test/audit/`) changed `SealedDAO` and `Sealed.roundAfter`. Full-tx gas before -> after, anvil receipts:

| Call | Before | After | Delta | Why |
|---|---:|---:|---:|---|
| `revealBatch`, any size | 97,444 (1 item) | 98,426 (1 item) | +982 per call | Reentrancy lock (+573: one TLOAD, two TSTOREs, audit F3) and the quorum check that gates the bounty (+409: sealed count and member snapshot from an already warm slot, audit F1). Per item at 256 items: +4 |
| `propose` | 201,350 | 201,475 | +125 | `BadTarget` also compares the target with the DAO and the USDC token (F6), and `descriptionURI` is length-checked (F8). `roundAfter` is branch-free (F4): before, `propose` cost 70 gas more in two of every three seconds |
| `execute` SetMember | 66,896 | 66,939 | +43 | `LastMember` check on removals (F7) |
| `finalize` | 32,789 | 32,827 | +38 | the D4 quorum formula moved to a helper shared with `revealBatch` |
| `vote`, `claim` | 68,277 / 49,316 | 68,303 / 49,338 | +26 / +22 | function dispatch only: the ABI gained two errors and one constant getter |
| `execute` TransferUSDC | 70,763 / 53,663 | 70,763 / 53,663 | 0 | unchanged |
| deploy | 2,794,295 | 2,880,794 | +86,499 | larger runtime code |

Every PRD 4.5 verdict is unchanged: the same rows are within or over target.

## Regression guard

- `contracts/.gas-snapshot` (from `pnpm contracts:snapshot`) is checked by `pnpm contracts:snapshot:check` (tolerance 5%),
  which is part of `pnpm check`. The `SealedDAOGas*` tests build their state in `setUp` and meter only the measured call,
  so each of those snapshot lines is that call's gas (plus the CALL itself) and a 5% regression in it fails CI.
- `SealedDAO.gas.t.sol` also asserts the PRD 4.5 targets on the full-tx model wherever they are met today: both `vote`
  sizes, `revealBatch` per item at 10 / 50 / 256 items, `finalize`, `execute` TransferUSDC with a pending claim and
  `claim`.
- ffi, fork, invariant and audit suites are excluded from the snapshot (they need node, the network or random call
  sequences; the audit regression tests replay attacks that meter hundreds of millions of gas on purpose). The audit
  tests still run in `forge test`.

## Method

All commands run from the repo root and work unchanged in fish.

```sh
# execution gas and the full-tx model for every row (forge, offline)
cd contracts && forge test --match-contract SealedDAOGas -vv && cd ..

# full tx gasUsed on a throwaway local anvil --hardfork prague (plus the EIP-7623 probe on prague and cancun);
# uses anvil's unlocked dev accounts, never a private key, and refuses any chain id other than 31337
bash contracts/script/gas-anvil.sh

# regenerate / check the per-test snapshot
pnpm contracts:snapshot
pnpm contracts:snapshot:check

# optional: read-only checks on a local fork of Arc mainnet (nothing is broadcast)
cd contracts && env ARC_RPC=https://rpc.mainnet.arc.io forge test --match-contract ArcUsdcForkTest -vv && cd ..
```

Mainnet column (human step, after PRD 10.2): for each proof transaction hash in `deployments/arc-mainnet.json`, run
`cast receipt <hash> gasUsed --rpc-url https://rpc.mainnet.arc.io` and write the value in the row of the same call.
