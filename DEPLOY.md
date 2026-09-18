# DEPLOY: ArcSeal (SealedDAO) on Arc

Runbook for the **human operator**. Agents never run the testnet or mainnet steps: they need keys and spend real USDC (testnet USDC is free from the faucet). Every step that sends a transaction is marked **[SENDS]**; everything else is read-only or local.

Commands are **fish** (the operator's shell). Environment variables go on the command line with `env VAR=value cmd`, shell variables are set with `set`, and command substitution is `(cmd)`. Private keys never appear on a command line, in an environment variable or in a file in the repo: every signer is a Foundry encrypted keystore in `~/.foundry/keystores`.

## TL;DR

```fish
# 0. local: green build and an offline rehearsal of the whole flow (no keys, no network)
pnpm install; and pnpm check; and pnpm e2e:dry-run

# 1. keystores: hidden prompt, paste each key once (main wallet = deployer and member 1)
cast wallet import arcseal-deployer --interactive
cast wallet import arcseal-wallet-b --interactive
cast wallet import arcseal-wallet-c --interactive
set DEPLOYER (cast wallet address --account arcseal-deployer)
set WALLET_B (cast wallet address --account arcseal-wallet-b)
set WALLET_C (cast wallet address --account arcseal-wallet-c)

# 2. testnet [SENDS]: deploy, record, then the e2e run (spans >= 24 h: re-run it to resume)
cd contracts
env "INITIAL_MEMBERS=$DEPLOYER,$WALLET_B,$WALLET_C" forge script script/Deploy.s.sol --rpc-url arc_testnet --account arcseal-deployer --sender $DEPLOYER --broadcast
node script/record-deployment.mjs 5042002
cd ..; and pnpm e2e:testnet

# 3. mainnet [SENDS]: deploy (CREATE2, salt keccak256("arcseal.v1")), record, verify, fund the treasury
cd contracts
env "INITIAL_MEMBERS=$DEPLOYER,$WALLET_B,$WALLET_C" forge script script/Deploy.s.sol --rpc-url arc --account arcseal-deployer --sender $DEPLOYER --broadcast
node script/record-deployment.mjs 5042
set DAO (jq -r .contracts.SealedDAO.address ../deployments/arc-mainnet.json)
forge verify-contract $DAO src/SealedDAO.sol:SealedDAO --chain-id 5042 --verifier sourcify --watch
cast send 0x3600000000000000000000000000000000000000 "transfer(address,uint256)" $DAO 2000000 --rpc-url arc --account arcseal-deployer
# 4. proofs, README, site, submission: CHECKLIST.md
```

| Item | Value |
|---|---|
| Chains | Arc mainnet `5042` (Foundry alias `arc`), Arc testnet `5042002` (alias `arc_testnet`), both in `contracts/foundry.toml` |
| RPC | `https://rpc.mainnet.arc.io`, `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io`, `https://explorer.testnet.arc.io` (Blockscout; its API sits behind a Cloudflare challenge, so verification goes to Sourcify) |
| USDC | `0x3600000000000000000000000000000000000000`, the 6-decimal ERC-20 view of the native gas token. The native balance is the same USDC in an 18-decimal view: never add the two |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` (present on both Arc networks and on every anvil) |
| Salt | `keccak256("arcseal.v1")` = `0xab625800dd8b6a1ec1cafaa199bb72f27c5482aec13bf092272907043180863e` |
| Constructor | `SealedDAO(usdc, [main, WALLET_B, WALLET_C], 5000, 10_000)`: quorum half the members, bounty 0.01 USDC per revealed vote (D16) |
| Immutable | No owner, no upgrade, no pause (D14). A mistake means a new deployment with a new salt label (see Rollback) |
| Mainnet scope | The DAO only (D1). `Sealed.sol` is an abstract module and is never deployed on its own |
| Budget | About 5 USDC in total on mainnet (§4.1). Deploy is about 2.9 M gas (2,886,722 in the anvil dry run), about 0.058 USDC at the 20 gwei floor |

---

## 0. Preflight (read-only)

| Check | Command | Expected |
|---|---|---|
| Toolchain | `forge --version; node -v; pnpm -v; jq --version` | forge 1.7.x, node >= 22, pnpm 11 |
| Submodules | `git submodule update --init --recursive` | `contracts/lib/forge-std` populated |
| Green build | `pnpm install; and pnpm check` | exit 0 (build, tests, typecheck, lint, forge fmt, ABI drift, gas snapshot) |
| Offline rehearsal | `pnpm e2e:dry-run` | ends with `proposal 1: 2 for / 1 against / 0 abstain, ... executed, claimed` and `resume check: ... 0 transactions sent` (§6) |
| RPCs | `cast chain-id --rpc-url arc; cast chain-id --rpc-url arc_testnet` | `5042`, `5042002` |
| CREATE2 deployer | `cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url arc` | non-empty (same on `arc_testnet`) |
| USDC | `cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)" --rpc-url arc` | `6` |

Run the fish blocks below from the repo root unless a block starts with `cd contracts`.

Done when: every row matches.

## 1. Wallets and keystores

The demo DAO has three members, all wallets the author controls (D16). The same three wallets are used on testnet and mainnet.

| Role | Keystore name | Mainnet | Testnet |
|---|---|---|---|
| main = deployer and member 1 | `arcseal-deployer` | deploys; votes For; funds the treasury | funds the treasury, proposes, votes For |
| WALLET_B = member 2 | `arcseal-wallet-b` | votes For; reveals via the site button | votes For; sends revealBatch, finalize, execute; claims the bounty |
| WALLET_C = member 3 | `arcseal-wallet-c` | votes Against; receives and claims the 1 USDC payout | votes Against; claims the 1 USDC payout |

1. **Import the three keys into encrypted keystores.** The keys already exist in `/Users/r4to/Script/arc/.env`. Open that file in an editor, copy one value at a time and paste it into cast's hidden prompt. Never `cat`, `echo` or `grep` it, and never put a key on a command line.
   ```fish
   mkdir -p ~/.foundry/keystores
   cast wallet import arcseal-deployer --interactive   # asks for the key, then a new keystore password
   cast wallet import arcseal-wallet-b --interactive
   cast wallet import arcseal-wallet-c --interactive
   cast wallet list                                    # the three names are listed
   ```
2. **Read the public addresses** (each command asks for that keystore's password):
   ```fish
   set DEPLOYER (cast wallet address --account arcseal-deployer)
   set WALLET_B (cast wallet address --account arcseal-wallet-b)
   set WALLET_C (cast wallet address --account arcseal-wallet-c)
   echo $DEPLOYER $WALLET_B $WALLET_C
   ```
   Copy them into your local `.env` as `DEPLOYER_ADDRESS`, `WALLET_B_ADDRESS` and `WALLET_C_ADDRESS`. Addresses are public; keys never go there.
3. **Optional password file**, only for an unattended `pnpm e2e:testnet --wait`. Otherwise cast prompts on the terminal whenever a keystore is first needed.
   ```fish
   read -s -P 'keystore password: ' pw; and printf '%s' $pw > ~/.foundry/arcseal.pw; and chmod 600 ~/.foundry/arcseal.pw; set -e pw
   # delete it when the run is done
   rm ~/.foundry/arcseal.pw
   ```
   One file serves every keystore when they share a password; otherwise use `MEMBER1_PASSWORD_FILE`, `MEMBER2_PASSWORD_FILE` and `MEMBER3_PASSWORD_FILE`.

Done when: `cast wallet list` shows the three names and the three addresses are in `.env`.

## 2. Environment variables

Nothing here is secret. Pass values per command with `env VAR=value cmd`.

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `INITIAL_MEMBERS` | `Deploy.s.sol` | none (required) | Comma-separated member addresses, no spaces: `$DEPLOYER,$WALLET_B,$WALLET_C` |
| `QUORUM_BPS` | `Deploy.s.sol` | `5000` | Quorum in basis points of the member count |
| `REVEAL_BOUNTY` | `Deploy.s.sol` | `10000` | USDC base units per revealed vote (0.01 USDC) |
| `SALT_LABEL` | `Deploy.s.sol`, `record-deployment.mjs` | `arcseal.v1` | Salt = keccak256(label). Change it only for a new deployment (Rollback) |
| `USDC_ADDRESS` | `Deploy.s.sol` | `0x3600…0000` | Any other value is accepted on a local chain only; on Arc the script reverts |
| `MEMBER1_ACCOUNT` / `MEMBER2_ACCOUNT` / `MEMBER3_ACCOUNT` | `pnpm e2e:testnet` | `arcseal-deployer` / `arcseal-wallet-b` / `arcseal-wallet-c` | Keystore names of members 1 to 3 |
| `KEYSTORE_PASSWORD_FILE` | `pnpm e2e:testnet` | unset: cast prompts | Password file for every keystore |
| `MEMBER1_PASSWORD_FILE` … `MEMBER3_PASSWORD_FILE` | `pnpm e2e:testnet` | `KEYSTORE_PASSWORD_FILE` | Per-keystore password file |
| `KEYSTORE_DIR` | `pnpm e2e:testnet` | `~/.foundry/keystores` | Keystore directory |
| `ARC_TESTNET_RPC` | `pnpm e2e:testnet` | `https://rpc.testnet.arc.io` | The run refuses any RPC that is not chain 5042002 |
| `SEALED_DAO_ADDRESS`, `SEALED_DAO_DEPLOY_BLOCK` | `pnpm e2e:testnet` | from `deployments/arc-testnet.json` | Override the recorded testnet DAO |
| `E2E_VOTING_SECONDS` | `pnpm e2e:testnet` | `600` | Voting duration, 600 to 604,800 |
| `E2E_PAYOUT` | `pnpm e2e:testnet` | `1000000` | TransferUSDC amount in base units (1 USDC) |
| `E2E_MAX_WAIT_SECONDS` | `pnpm e2e:testnet` | `900` | Longest wait slept through inline; a longer one pauses the run |
| `LOG_LEVEL` | scripts (SDK logs on stderr) | `warn` | `info` or `debug` shows the SDK's pino lines with correlation ids |

`.env.example` lists the network, keystore and web values. The scripts read the process environment only; they never load `.env` themselves.

## 3. Testnet (5042002): deploy, record, end-to-end run [SENDS]

### 3.1 Fund the three wallets

Get testnet USDC at `https://faucet.circle.com` for each address. Member 1 needs about 1.1 USDC: it funds the treasury with the 1 USDC payout plus 3 × 0.01 bounties, and pays some gas. Members 2 and 3 need about 0.05 USDC each for gas.

```fish
for a in $DEPLOYER $WALLET_B $WALLET_C
    cast call 0x3600000000000000000000000000000000000000 "balanceOf(address)(uint256)" $a --rpc-url arc_testnet
end   # 6-decimal units: 1000000 = 1 USDC
```

### 3.2 Deploy

```fish
cd contracts
# simulation only (no --broadcast): prints every parameter and the predicted address, sends nothing
env "INITIAL_MEMBERS=$DEPLOYER,$WALLET_B,$WALLET_C" forge script script/Deploy.s.sol --rpc-url arc_testnet --account arcseal-deployer --sender $DEPLOYER
# real deploy
env "INITIAL_MEMBERS=$DEPLOYER,$WALLET_B,$WALLET_C" forge script script/Deploy.s.sol --rpc-url arc_testnet --account arcseal-deployer --sender $DEPLOYER --broadcast
```

- The script refuses unknown chains, a USDC override on Arc, a token that does not report 6 decimals and a missing CREATE2 deployer. It reads the new contract back (token, quorum, bounty, members, zero proposals) and reverts on any mismatch.
- It is idempotent: when the predicted address already has code it prints `already deployed, nothing to do` and sends nothing.
- CREATE2 address = f(deployer, salt, init code), and the init code includes the constructor arguments. With the same three members, the testnet and mainnet DAOs therefore get the **same address**.

### 3.3 Record and check

```fish
node script/record-deployment.mjs 5042002     # reads broadcast/Deploy.s.sol/5042002/run-latest.json; no RPC, no keys
set DAO (jq -r .contracts.SealedDAO.address ../deployments/arc-testnet.json)
cast call $DAO "memberCount()(uint32)" --rpc-url arc_testnet       # 3
cast call $DAO "quorumBps()(uint16)" --rpc-url arc_testnet         # 5000
cast call $DAO "revealBounty()(uint256)" --rpc-url arc_testnet     # 10000
cast call $DAO "usdc()(address)" --rpc-url arc_testnet             # 0x3600000000000000000000000000000000000000
cd ..
```

`record-deployment.mjs` writes the address, deploy block, deploy tx, deployer, constructor arguments, salt label and salt hash. It checks that the salt in the transaction is keccak256 of the label. Optionally verify on Sourcify with the §5 command and `--chain-id 5042002`; Sourcify supports Arc testnet.

### 3.4 Run the end-to-end flow (PRD 8.4) — spans at least 24 hours

```fish
pnpm e2e:testnet                                               # cast prompts for each keystore password when needed
env KEYSTORE_PASSWORD_FILE=$HOME/.foundry/arcseal.pw pnpm e2e:testnet --wait   # unattended: sleeps through the 24 h window
```

The run spans **at least 24 hours**. D5 fixes the reveal window at 28,800 drand rounds (24 h) after the close round, and `finalize` is allowed only after it ends. The script cannot shorten this, so the close-to-execute time is 24 h plus minutes, never under 5 minutes.

| Chain time | What `pnpm e2e:testnet` does | Signs |
|---|---|---|
| t0 | Funds the treasury with 1.03 USDC (a plain USDC transfer), proposes "pay 1 USDC to member 3" with 10-minute voting, then three sealed votes: For, For, Against. Each ballot (salt, choice, ciphertext) is written to the state file before its vote transaction is sent | members 1, 3 (address only), 1, 2, 3 |
| t0 + 10 min | Waits inline. Then `unsealProposal` reads the `Sealed` logs, fetches the close-round beacon from drand and decrypts the votes, and member 2 sends `revealBatch` and is credited the fixed reveal payment (3 × 0.01 USDC; the proposal met quorum). The script then **pauses**, prints the time to come back, and exits 0 | member 2 |
| t0 + 24 h 10 min | Run `pnpm e2e:testnet` again. It sends `finalize` (2 for > 1 against, quorum 3 of 3 sealed) and `execute`. Member 3 claims the 1 USDC payout and member 2 claims its reveal payment. The run prints `DONE` | members 2, 3 |

- **Resumable and idempotent.** The run state lives in `scripts/.state/5042002.json` (gitignored). Every step checks the state file and then the chain, so a re-run skips finished steps and waits for a sent-but-unconfirmed transaction. A propose that was interrupted is found again by the run tag in its description. Re-running at any time is safe.
- **Flags.** `--wait` sleeps through every wait instead of pausing; keep the terminal open for a day. `--reset` archives the state file and starts a new run with a new proposal.
- **Guards.** The run refuses an RPC that is not chain 5042002 and a keystore whose address is not a DAO member. It never touches `deployments/arc-mainnet.json`.
- **Gas margin.** Signing wallets add 20 % to the node's gas estimate, as a browser wallet does, and so does `@arcseal/sdk` for local accounts. Gas can depend on state that moves between the estimate and inclusion (a `revealBatch` that credits the bounty costs more than one that skips it), so an exact estimate can run out of gas. `propose` itself costs the same in every second since `roundAfter` became branch-free (it used to cost 70 gas more off a drand round boundary).
- **Output.** Every transaction prints its hash, block, gasUsed, fee in USDC and explorer link. Confirmed hashes go into `deployments/arc-testnet.json`:
  - `proofTxs.fundTreasury`, `transferPropose`, `transferVotes` (3 hashes), `transferRevealBatch`, `transferFinalize`, `transferExecute`, `transferClaim` and `transferBountyClaim`;
  - plus an `e2e` block with the run tag, proposal id, close and reveal-end rounds, and gasUsed per step.

Done when: the last run prints `DONE: proposal N: 2 for / 1 against / 0 abstain, 3 of 3 sealed votes revealed, passed, executed, claimed`, and every hash in `proofTxs` opens on `https://explorer.testnet.arc.io`.

**Optional reference relayer.** `scripts/reveal-cli.ts` reveals every sealed vote of one proposal. It is not hosted and not required: the site's "Reveal votes" button does the same.

```fish
pnpm --filter @arcseal/scripts reveal --proposal 1                                   # read-only: decrypt and list
pnpm --filter @arcseal/scripts reveal --proposal 1 --account arcseal-wallet-b        # [SENDS] revealBatch
```

## 4. Mainnet (5042): deploy, record, verify, fund (PRD 10.2 steps 1-3) [SENDS]

### 4.1 Fund the wallets (about 5 USDC in total)

| Wallet | Pays for | Suggested |
|---|---|---|
| main (`arcseal-deployer`) | deploy (≈ 0.058 USDC), 2 USDC treasury, proposals, its votes | 3 USDC |
| WALLET_B | votes, revealBatch from the site, finalize/execute | 1 USDC |
| WALLET_C | votes, claim | 0.5 USDC |
| buffer | retries, gas above the 20 gwei floor | 0.5 USDC |

Bridge USDC to Arc with Circle CCTP (Arc domain 26, App Kit Bridge: `https://docs.arc.io/app-kit/bridge.md`), then split it with `cast send` or a wallet. Check the balances with the §3.1 loop and `--rpc-url arc`.

### 4.2 Simulate, then deploy with the CREATE2 salt

```fish
cd contracts
env "INITIAL_MEMBERS=$DEPLOYER,$WALLET_B,$WALLET_C" forge script script/Deploy.s.sol --rpc-url arc --account arcseal-deployer --sender $DEPLOYER
# check the printed "SealedDAO (CREATE2)" address: with the same members it equals the testnet DAO
env "INITIAL_MEMBERS=$DEPLOYER,$WALLET_B,$WALLET_C" forge script script/Deploy.s.sol --rpc-url arc --account arcseal-deployer --sender $DEPLOYER --broadcast
```

Done when: the output ends with `deployed 0x…` and `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`, and the transaction is successful on `https://explorer.arc.io/tx/<hash>`.

### 4.3 Record

```fish
node script/record-deployment.mjs 5042
set DAO (jq -r .contracts.SealedDAO.address ../deployments/arc-mainnet.json)
set DEPLOY_BLOCK (jq -r .contracts.SealedDAO.deployBlock ../deployments/arc-mainnet.json)
cast call $DAO "memberCount()(uint32)" --rpc-url arc        # 3
cast call $DAO "isMember(address)(bool)" $WALLET_C --rpc-url arc   # true
cast call $DAO "proposalCount()(uint256)" --rpc-url arc     # 0
```

Commit `deployments/arc-mainnet.json` and `contracts/broadcast/Deploy.s.sol/5042/run-latest.json`. It contains no secrets (`contracts/cache/` is gitignored). Point the web app at the deployment with `NEXT_PUBLIC_DAO_ADDRESS=$DAO` and `NEXT_PUBLIC_DAO_DEPLOY_BLOCK=$DEPLOY_BLOCK`; the SDK reads logs from the deploy block on.

### 4.4 Verify on Sourcify (exact match)

See §5.

```fish
forge verify-contract $DAO src/SealedDAO.sol:SealedDAO --chain-id 5042 --verifier sourcify --watch
curl -s "https://sourcify.dev/server/v2/contract/5042/$DAO?fields=runtimeMatch,creationMatch"
# expect "runtimeMatch":"exact_match"; then set contracts.SealedDAO.verified to true in deployments/arc-mainnet.json
```

### 4.5 Fund the treasury with 2 USDC

The treasury is funded with a plain ERC-20 transfer. SealedDAO has no `receive`, so a native-value transfer reverts.

```fish
cast send 0x3600000000000000000000000000000000000000 "transfer(address,uint256)" $DAO 2000000 --rpc-url arc --account arcseal-deployer
cast call 0x3600000000000000000000000000000000000000 "balanceOf(address)(uint256)" $DAO --rpc-url arc   # 2000000
cast call $DAO "totalClaimable()(uint256)" --rpc-url arc                                               # 0
cd ..
```

Record the hash as `proofTxs.fundTreasury`. The proofs themselves (PRD 10.2 steps 4-9: pay 1 USDC, add a member, a failed quorum with a skipped garbage item) run from the site and are listed in `CHECKLIST.md`.

Done when: `deployments/arc-mainnet.json` has the address, block, deploy tx, `verified: true` and `fundTreasury`.

## 5. Sourcify verification with a CREATE2 salt (PRD 14, third UNKNOWN)

**Answer: no, the constructor arguments do not need to be encoded manually for Sourcify.** Evidence gathered on 2026-09-18:

1. Foundry 1.7.1 `forge verify-contract --help` documents `--constructor-args` as "The ABI-encoded constructor arguments. Only for Etherscan". The Sourcify verifier does not send them. The only related Sourcify option is `--creation-transaction-hash`, which the help marks as optional.
2. ArcPull is the reference repo's contract, deployed through the same CREATE2 deployer with one constructor argument stored as an immutable. It was verified on Sourcify on 2026-09-17. A read-only query (`/server/v2/contract/5042/0xEf025D3Bbf4eb7df27cB3cD62b63d65139EE2923`) returns:
   - `"runtimeMatch":"exact_match"` and `"creationMatch":null`, with no deployment transaction recorded;
   - the immutable's value, recovered from the deployed code by a runtime transformation.

   Sourcify matched the runtime bytecode and filled the immutables itself; no constructor arguments were involved.
3. SealedDAO's constructor arguments land in two places:
   - `usdc`, `quorumBps` and `revealBounty` are immutables, recovered the same way;
   - `initialMembers` is written to storage only, so it is not part of the runtime bytecode at all.
4. Sourcify's `/server/chains` lists Arc (`5042`) and Arc Testnet (`5042002`) as supported, both with `trace_transaction` RPCs.

**Procedure** (run from `contracts/`; solc 0.8.30, optimizer 10,000 runs and evm `prague` come from `foundry.toml`):

```fish
# 1. The proven path, the same as ArcPull's and ArcDraw's exact matches:
forge verify-contract $DAO src/SealedDAO.sol:SealedDAO --chain-id 5042 --verifier sourcify --watch
# 2. Confirm:
curl -s "https://sourcify.dev/server/v2/contract/5042/$DAO?fields=runtimeMatch,creationMatch"
```

**UNKNOWN: whether Sourcify also records a creation match for this factory deployment** when given the deploy transaction. It would have to trace the call into the CREATE2 deployer, and Arc's RPCs are listed with `trace_transaction`. A creation match is optional; the runtime exact match is what the PRD asks for. Try it only after step 1 succeeded, and ignore a failure:

```fish
forge verify-contract $DAO src/SealedDAO.sol:SealedDAO --chain-id 5042 --verifier sourcify --creation-transaction-hash (jq -r .contracts.SealedDAO.deployTx ../deployments/arc-mainnet.json) --watch
```

**Explorer fallback (Blockscout).** Use it only if a "Contract" tab on `explorer.arc.io` is wanted. The API is behind Cloudflare, so use the UI with Standard JSON input. Blockscout does need the ABI-encoded constructor arguments:

```fish
forge verify-contract $DAO src/SealedDAO.sol:SealedDAO --chain-id 5042 --show-standard-json-input > sealeddao.standard.json
cast abi-encode "constructor(address,address[],uint16,uint256)" 0x3600000000000000000000000000000000000000 "[$DEPLOYER,$WALLET_B,$WALLET_C]" 5000 10000
# explorer.arc.io/address/<DAO> -> Contract -> Verify & publish -> Solidity (Standard JSON input), compiler v0.8.30,
# contract SealedDAO; paste the encoded arguments (drop the 0x if the form asks for raw hex). Delete the JSON afterwards.
```

That `cast abi-encode` output equals the tail of the deploy transaction's init code, as checked on a local anvil deployment.

## 6. Local dry run (no keys, no network)

```fish
pnpm e2e:dry-run                 # offline; about 10 s
pnpm e2e:dry-run --online        # the close-round beacon comes from the drand relays instead
pnpm e2e:dry-run --keep-alive    # leaves anvil on :8545 and prints NEXT_PUBLIC_* for apps/web (Ctrl-C stops it)
```

- **Setup.** It starts its own anvil with `--hardfork prague`, the same EIP-7623 calldata pricing as Arc, and a genesis time in the past. It etches MockUSDC (6 decimals) at `0x3600…0000`, deploys through the real `Deploy.s.sol` (CREATE2, salt `arcseal.v1`) from anvil's unlocked dev accounts, and records the result with `record-deployment.mjs` in `deployments/anvil-dry-run.json`, which is gitignored.
- **Flow.** It runs the same flow as §3.4, with time jumps (`anvil_setNextBlockTimestamp`) instead of waits, and prints every transaction hash.
- **Offline.** The proposal is created exactly 10 minutes before drand round 32,000,000, whose beacon is committed in `packages/tlock/test/vectors/beacons.json`.
- **Idempotency check.** It then re-runs the flow from the state file and requires 0 transactions sent.
- **Why not a fork.** Real USDC transfers cannot run on a local fork of Arc (FiatToken calls a native-coin precompile that anvil lacks), so the dry run uses MockUSDC on a plain anvil.
- **Keep-alive chain time.** With `--keep-alive` the chain time stays in the past. Skip ahead with `cast rpc evm_increaseTime 600 --rpc-url http://127.0.0.1:8545`, then `cast rpc evm_mine --rpc-url http://127.0.0.1:8545`.

## Rollback and failure modes

| Problem | Action |
|---|---|
| Deploy tx fails or hangs | Nothing to roll back. Rerun the same command: CREATE2 gives the same address, and the script skips an existing deployment |
| Wrong members or parameters deployed, or a contract bug | The contract is immutable (D14). Stop promoting it and deploy again with a **new** label: add `SALT_LABEL=arcseal.v2` to the `env` of the §4.2 commands, record with `node script/record-deployment.mjs 5042 --salt-label arcseal.v2`, and update the web app, README and site. Never reuse `arcseal.v1` for different bytecode or different arguments: one label, one deployment. Funds in the old DAO leave only through its own proposals (a passed TransferUSDC) |
| The demo fails midway (quorum missed, reveal missed, proposal expired) | Do **not** redeploy: proposals are cheap. Create a new proposal on the same DAO. Redeploy only when the contract or its constructor arguments are wrong |
| `pnpm e2e:testnet` stopped (crash, Ctrl-C, closed laptop) | Run it again. The state file resumes it and nothing is sent twice. `--reset` starts a new proposal instead |
| drand relays unreachable at reveal time | The e2e run waits up to 15 minutes for the beacon, then exits; re-run later. quicknet is unchained, so round R can be fetched whenever the relays return. The reveal window is 24 h, and voters can also reveal their own vote from the local receipt ("Reveal only mine") without drand |
| Reveal window missed | Unrevealed votes count toward quorum and nothing else (D4). Finalize after the window as usual, or run a new proposal |
| A write reverted with gasUsed equal to the gas limit | Out of gas from an exact estimate (§3.4 gas margin). Send it again. The scripts and the SDK (local accounts) add a 20 % margin; browser wallets add their own |
| A claim reverts with "Blacklistable: account is blacklisted" | The recipient is on USDC's blocklist. The balance stays claimable (D13) and nothing else is blocked |
| Sourcify verification fails | Run §5 step 1 again without `--creation-transaction-hash`; use the Blockscout Standard JSON fallback for the explorer tab |
| A keystore or wallet leaks | Move its funds and import a new keystore. Membership changes only through a SetMember proposal (remove the old address, add the new one) |
