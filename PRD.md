# ArcSeal — Product Requirements Document

Version 1.0 · 2026-09-18 · Owner: r4to · Status: approved, ready for build
Target: Arc Microgrants (DoraHacks), deadline 2026-10-14 23:59 ET. Must be live on Arc mainnet with a public repo.

This document is self-contained. A fresh session must be able to build the whole project from it plus the two reference repos named in §2.4. Everything in the codebase (code, comments, docs, commits, site copy) is in English. The site also ships a PT-BR translation.

---

## 0. TL;DR

**ArcSeal** brings *timelock encryption* to Arc: data that nobody can read before a chosen moment, and that anyone can open after it, without the author coming back. It uses drand quicknet as the clock and tlock (identity-based encryption on drand) as the cipher. Onchain it is a small abstract Solidity module, `Sealed.sol`, that stores a hash commitment and a drand round, and verifies a reveal by hash. Offchain it is a TypeScript SDK that seals and unseals. No BLS verification onchain, no relayer, no singleton.

The reference app is **SealedDAO**: a member-list DAO with a USDC treasury where every vote is sealed until the voting round closes. No running tally, no bandwagon, no verifiable vote-buying while voting is open, and no vote lost because a member failed to come back and reveal. After the close, anyone (the site has a button) decrypts all votes in the browser and submits them in one transaction; the treasury pays a small bounty per revealed vote.

Deliverables: `contracts/` (Foundry), `packages/tlock` (vendored tlock-js, quicknet-only, Node + browser), `packages/sdk`, `apps/web` (static Next.js, EN/PT-BR), `docs/`, mainnet deployment with proof transactions, project page on GitHub Pages, DoraHacks submission text.

---

## 1. Problem and why Arc

### 1.1 Problem
Every onchain commit-reveal scheme (votes, sealed bids, hidden moves) has the same failure mode: the party that dislikes the outcome never reveals, and the protocol either stalls or needs heavy penalties. Voting specifically has three extra problems when votes are public in real time: late voters see the partial tally (bandwagon), the running tally shapes the discussion, and a vote buyer can verify delivery onchain.

### 1.2 What timelock encryption changes
The reveal no longer depends on the author. The ciphertext posted at commit time opens itself when the drand round arrives, and anyone can perform the reveal. The hash commitment stays the authority: the contract never parses ciphertexts.

### 1.3 Why Arc specifically
| Arc property | Use in ArcSeal |
|---|---|
| Gas paid in USDC, 20 gwei floor | Sealing a vote costs about 0.001 USDC (measured with EIP-7623 active). The reveal bounty is paid in the same unit the revealer spends on gas |
| Sub-second deterministic finality, no reorgs | A `Sealed` event is final on inclusion; the round-to-block mapping needs no confirmation depth |
| USDC is native and an ERC-20 at `0x3600…0000` (6 decimals) | The DAO treasury and the gas are the same asset. Members hold only USDC |
| USDC blocklist reverts transfers | All payouts are pull-based (`claim`), never push, so a blocked recipient cannot brick a proposal |
| No VRF, no timelock service on Arc (Randamu shut down 2026-02, blocklock archived) | ArcSeal is greenfield. ArcDraw (same author) already verifies drand onchain if a future design needs it |

Research backing these claims is in `../research/tlock-feasibility.md`, `../research/yield-arc.md`, `../research/legal-br.md` (Portuguese). Key measured facts are restated in §9 so this PRD stands alone.

---

## 2. Scope

### 2.1 In scope (v1)
1. `Sealed.sol`: abstract module. Commitment + round storage, reveal-by-hash, reveal window, batch reveal helper, drand round math.
2. `SealedDAO.sol`: concrete DAO inheriting `Sealed`. Member list (1 address = 1 vote), USDC treasury, two proposal actions, sealed voting, tally, execution, pull-based claims, reveal bounty.
3. `@arcseal/tlock`: vendored tlock-js v0.9.0 pinned to quicknet, working in Node 22 and modern browsers, with test vectors cross-checked against the Go `tle` CLI.
4. `@arcseal/sdk`: `seal`, `unseal`, `unsealProposal`, commitment codec, round math, viem actions for every contract call, Zod schemas, typed ABI checked against Foundry output.
5. `apps/web`: static site. Pages: proposals list, proposal detail (vote, reveal, finalize, execute), create proposal, treasury and members, claim, docs. EN/PT-BR. Wallet via wagmi injected connector.
6. Docs: `README.md`, `docs/SPEC.md`, `docs/THREATS.md`, `docs/GAS.md`, `DEPLOY.md`, `CHECKLIST.md`, `SUBMISSION.md`, `AGENTS.md`.
7. Mainnet deployment, Sourcify verification, proof transactions (§10), `deployments/arc-mainnet.json`, project page at `site/index.html` served by GitHub Pages.

### 2.2 Out of scope (v1), recorded as options
- Sealed-bid auction, hidden-move game, sealed EIP-3009 payments (SDK may include a non-deployed example of a sealed payload of arbitrary bytes, nothing more).
- Weighted membership, governance token, ERC20Votes snapshots.
- Arbitrary-call proposals (Governor style).
- `SetParams` proposal type. All parameters are immutable at deploy.
- Automated relayer. A reference script may exist under `scripts/` but is not hosted and not required.
- Vote changes after commit.
- Permanent voter anonymity (would need ZK/MACI). Votes are public per address after the reveal, and the site says so.
- Onchain BLS verification of drand signatures.

### 2.3 Non-goals stated for reviewers
No token, no sale, no yield, no prize, no chance. Membership changes and payouts happen only through approved proposals. This framing is deliberate (legal research ruled out lottery, no-loss lottery, receipt lottery and stake-based games).

### 2.4 Reference repos (same author, same conventions)
- `/Users/r4to/Script/arc/arc-subscriptions` (ArcPull): monorepo layout, `package.json` scripts (`check` = build + test + typecheck + lint + fmt + ABI check), Foundry config, SDK ABI generation and check, `deployments/arc-mainnet.json` shape, `CHECKLIST.md` and `DEPLOY.md` style, `site/index.html` + `.github/workflows/pages.yml`.
- `/Users/r4to/Script/arc/arc-randomness` (ArcDraw): drand quicknet constants, web app content structure, `docs/GAS.md` format.
Copy structure and tooling from them. Do not copy business logic.

---

## 3. Fixed decisions

| # | Decision |
|---|---|
| D1 | Mainnet scope is the DAO only |
| D2 | Members are an address list; 1 address = 1 vote |
| D3 | Proposal actions: `TransferUSDC(to, amount)` and `SetMember(account, isMember)` |
| D4 | Quorum is measured over **sealed** votes: `sealedCount * 10_000 >= memberCountAtSnapshot * quorumBps`. A proposal passes if `forCount > againstCount` among **revealed** votes. Unrevealed votes count toward quorum and toward nothing else. Ties fail |
| D5 | Voting ends at drand round `R`, chosen from a proposer-supplied duration between 10 minutes and 7 days. Reveal window is open from `R` for 24 hours (28,800 rounds). Finalize and execute only after the reveal window. A passed proposal expires if not executed within 7 days after the reveal window ends |
| D6 | The treasury pays a fixed bounty per validly revealed vote to `msg.sender` of `revealBatch`. If the treasury cannot cover it, the reveal still succeeds and the bounty is skipped for that call. **Amended 2026-09-18 (owner-approved, Phase 4 audit F1):** the bounty is credited only when the proposal met quorum (D4); below quorum the reveal still counts and pays nothing, so one member cannot drain the treasury with throwaway proposals |
| D7 | The primitive is an abstract contract `Sealed.sol` inherited by the app, plus the SDK. No deployed singleton |
| D8 | One commit per member per proposal, no changes. Choices: `For`, `Against`, `Abstain` |
| D9 | No relayer. The site's "Reveal votes" button decrypts in the browser and sends one `revealBatch` transaction. Invalid items are skipped without reverting |
| D10 | Ciphertext goes in calldata and is emitted in an event. State stores only `bytes32 commitment` and the round |
| D11 | The hash is the authority. Commitment = `keccak256(abi.encode(proposalId, voter, choice, salt))` with `bytes32 salt` from a CSPRNG. Domain-separating on `proposalId` and `voter` prevents cross-proposal and cross-voter replay |
| D12 | tlock-js v0.9.0 is vendored (it is unmaintained since 2024-03). quicknet only. Test vectors cross-checked with `tle` |
| D13 | Treasury payouts are pull-based via `claim()`. The contract never pushes USDC to arbitrary addresses |
| D14 | Immutable contract: no owner, no upgrade, no pause. Parameters fixed in the constructor |
| D15 | Name ArcSeal, repo `r4topunk/arcseal`, page `https://r4topunk.github.io/arcseal/`, static site on GitHub Pages |
| D16 | Mainnet demo: initial members are three wallets the author controls. Proposal 1 transfers 1 USDC to an address; proposal 2 adds a fourth member. Both are voted sealed, revealed via the site button, finalized, executed, and the payout is claimed. All tx hashes go in the README and `deployments/arc-mainnet.json` |
| D17 | Site and README state plainly: secrecy holds **during** voting; after the reveal, each vote is public per address. This is not anonymity |
| D18 | Stack: Foundry, Solidity `^0.8.26`, TypeScript, pnpm workspaces, viem + wagmi, Next.js static export, Tailwind + shadcn, Vitest, Zod, pino for SDK logging. Node ≥ 22 |

---

## 4. Onchain specification

### 4.1 Constants
```
QUICKNET_GENESIS  = 1692803367   // unix seconds
QUICKNET_PERIOD   = 3            // seconds
REVEAL_WINDOW     = 28_800       // rounds = 24h
MIN_VOTING        = 600          // seconds
MAX_VOTING        = 7 days
EXECUTION_GRACE   = 7 days       // after reveal window end
USDC              = 0x3600000000000000000000000000000000000000 (6 decimals, ERC-20 view)
```
Round math (pure, in `Sealed`):
```
roundAt(t)      = (t - GENESIS) / PERIOD + 1                 // round whose signature is published at or before t
roundAfter(t)   = roundAt(t) + 1 if (t - GENESIS) % PERIOD != 0 else roundAt(t)   // first round published at or after t
roundTime(r)    = GENESIS + (r - 1) * PERIOD
```
`closeRound = roundAfter(block.timestamp + votingSeconds)`. Voting is open while `block.timestamp < roundTime(closeRound)`. Reveal is open while `roundTime(closeRound) <= block.timestamp < roundTime(closeRound + REVEAL_WINDOW)`.

### 4.2 `Sealed.sol` (abstract)
Responsibilities: commitments keyed by `(sealId, sealer)`, round bookkeeping, hash verification. It does not know about votes.

```solidity
abstract contract Sealed {
    struct SealGroup { uint64 closeRound; uint64 revealEndRound; }  // one group per proposal
    mapping(uint256 groupId => SealGroup) internal _groups;
    mapping(uint256 groupId => mapping(address sealer => bytes32)) internal _commitments;

    event SealGroupOpened(uint256 indexed groupId, uint64 closeRound, uint64 revealEndRound);
    event Sealed(uint256 indexed groupId, address indexed sealer, bytes32 commitment, bytes ciphertext); // ciphertext only in the log
    event Revealed(uint256 indexed groupId, address indexed sealer, bytes32 commitment);

    error SealingClosed(); error RevealNotOpen(); error RevealClosed(); error AlreadySealed(); error NothingSealed(); error BadReveal(); error BadDuration();

    function _openGroup(uint256 groupId, uint32 votingSeconds) internal returns (uint64 closeRound);
    function _seal(uint256 groupId, address sealer, bytes32 commitment, bytes calldata ciphertext) internal;
    function _verifyReveal(uint256 groupId, address sealer, bytes32 expected) internal view returns (bool ok); // pure comparison, never reverts on mismatch
    function _consumeReveal(uint256 groupId, address sealer) internal;  // marks revealed, emits
    function roundAt(uint256 t) public pure returns (uint64);
    function roundAfter(uint256 t) public pure returns (uint64);
    function roundTime(uint64 r) public pure returns (uint256);
    function sealingOpen(uint256 groupId) public view returns (bool);
    function revealOpen(uint256 groupId) public view returns (bool);
}
```
Rules: `_seal` reverts if sealing is closed or the sealer already sealed. Ciphertext length must be between 359 and 1,024 bytes (measured overhead is 359 bytes; the DAO payload is 96 bytes ABI-encoded, so about 455 bytes). `_verifyReveal` returns false on mismatch so batch callers can skip. A revealed commitment is replaced by a sentinel (`bytes32(uint256(1))`) to prevent double reveal.

### 4.3 `SealedDAO.sol`
```solidity
contract SealedDAO is Sealed {
    enum Choice { Abstain, For, Against }        // Abstain = 0 so an all-zero plaintext is a harmless abstain
    enum ActionKind { TransferUSDC, SetMember }
    enum Status { Voting, Revealing, Ready, Passed, Failed, Executed, Expired }  // derived view, not stored

    struct Proposal {
        address proposer; ActionKind kind; address target; uint256 amount; bool flag;   // amount for transfer, flag for SetMember
        string  description;                        // short, ≤ 256 bytes; longer text via descriptionURI
        string  descriptionURI;
        uint64  closeRound; uint64 revealEndRound;
        uint32  memberSnapshot; uint32 sealedCount; uint32 revealedCount; uint32 forCount; uint32 againstCount; uint32 abstainCount;
        bool    finalized; bool passed; bool executed;
    }

    IERC20  public immutable usdc;          // 0x3600…0000
    uint16  public immutable quorumBps;     // 5000 in the demo
    uint256 public immutable revealBounty;  // 10_000 = 0.01 USDC in the demo
    uint32  public memberCount;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public claimable;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) internal _proposals;

    constructor(address usdc_, address[] memory initialMembers, uint16 quorumBps_, uint256 revealBounty_);

    function propose(ActionKind kind, address target, uint256 amount, bool flag, string calldata description, string calldata descriptionURI, uint32 votingSeconds) external returns (uint256 id);  // members only
    function vote(uint256 id, bytes32 commitment, bytes calldata ciphertext) external;   // members at snapshot? see rule below
    function revealBatch(uint256 id, address[] calldata voters, Choice[] calldata choices, bytes32[] calldata salts) external returns (uint32 revealed);  // anyone
    function finalize(uint256 id) external;   // anyone, after reveal window; sets finalized and passed
    function execute(uint256 id) external;    // anyone, Passed and not expired
    function claim() external;                // pulls claimable[msg.sender]
    function status(uint256 id) external view returns (Status);
    function proposal(uint256 id) external view returns (Proposal memory);
    function commitmentOf(uint256 id, address voter) external view returns (bytes32);
    function hashVote(uint256 id, address voter, Choice c, bytes32 salt) external pure returns (bytes32);
}
```
Rules:
- `propose`: caller must be a member. `votingSeconds` in `[600, 7 days]`. `TransferUSDC`: `target != 0`, `amount > 0`. `SetMember`: adding an existing member or removing a non-member reverts at execute (not at propose, because membership may change in between). Snapshot `memberSnapshot = memberCount` at propose.
- Membership eligibility to vote: `isMember[msg.sender]` at the time of `vote`. Since members only change via executed proposals, and D4 uses the snapshot only for the quorum denominator, this is acceptable and documented. (Edge: a member added mid-vote may vote; a removed one cannot. Both are tested.)
- `vote`: sealing open, member, not already sealed. Increments `sealedCount`. Emits `Sealed` with the ciphertext.
- `revealBatch`: reveal window open. For each item: `expected = hashVote(id, voter, choice, salt)`; if `_verifyReveal` is false, skip (emit `RevealSkipped(id, voter)`); else consume, increment the matching counter and `revealedCount`. Bounty: `bounty = revealed * revealBounty`; if `usdc.balanceOf(this) - totalClaimable >= bounty`, `claimable[msg.sender] += bounty`, `totalClaimable += bounty`; else emit `BountySkipped`. Arrays must have equal length; at most 256 items.
- `finalize`: after `revealEndRound` time. Sets `finalized = true`, `passed = quorumMet && forCount > againstCount`. Idempotent revert on second call (`AlreadyFinalized`).
- `execute`: `finalized && passed && !executed && block.timestamp <= roundTime(revealEndRound) + EXECUTION_GRACE`. `TransferUSDC`: requires `usdc.balanceOf(this) - totalClaimable >= amount`, then `claimable[target] += amount; totalClaimable += amount`. `SetMember`: applies change, updates `memberCount`, reverts `NoOp` if nothing changes. Sets `executed`.
- `claim`: `amount = claimable[msg.sender]`; require `> 0`; zero it, `totalClaimable -= amount`, `usdc.transfer(msg.sender, amount)` with return check. A blocklisted claimer's transfer reverts and their balance stays claimable.
- Funding: anyone may `usdc.transfer` to the contract. No `receive` needed (USDC is ERC-20). Native-USDC transfers to the contract (18-decimal view) are the same balance; the contract reads only the ERC-20 view.
- Invariant: `usdc.balanceOf(this) >= totalClaimable`.
- Status view: derives from timestamps and flags in this order: Executed → Expired (finalized, passed, past grace) → Passed/Failed (finalized) → Ready (past reveal end, not finalized) → Revealing (past close) → Voting.

### 4.4 Events and errors
Events: `ProposalCreated(id, proposer, kind, target, amount, flag, closeRound, revealEndRound, memberSnapshot, description, descriptionURI)`, `Sealed(groupId, sealer, commitment, ciphertext)` from the module (the DAO emits no separate VoteSealed event; the SDK reads `Sealed`), `VoteRevealed(id, voter, choice)`, `RevealSkipped(id, voter)`, `BountyCredited(id, revealer, amount)`, `BountySkipped(id)`, `Finalized(id, passed, forCount, againstCount, abstainCount, sealedCount, revealedCount)`, `Executed(id)`, `MemberSet(account, isMember)`, `Claimed(account, amount)`.
Errors: `NotMember`, `BadDuration`, `BadTarget`, `BadAmount`, `SealingClosed`, `AlreadySealed`, `RevealNotOpen`, `RevealClosed`, `LengthMismatch`, `TooManyItems`, `NotReady`, `AlreadyFinalized`, `NotPassed`, `AlreadyExecuted`, `Expired`, `InsufficientTreasury`, `NoOp`, `NothingToClaim`, `TransferFailed`, `BadCiphertextLength`.

### 4.5 Gas targets (to be measured and published in `docs/GAS.md`)
| Call | Target |
|---|---|
| `vote` (455-byte ciphertext) | ≤ 80k gas (≈ 0.0016 USDC) |
| `revealBatch` per item | ≤ 45k gas |
| `finalize` | ≤ 60k |
| `execute` TransferUSDC | ≤ 60k |
| `claim` | ≤ 55k |

---

## 5. SDK specification (`@arcseal/sdk`)

Depends on `@arcseal/tlock` and viem. ESM, Node 22 and browser. All public inputs validated with Zod.

```ts
// round math (mirrors Solidity, tested against it via FFI vectors)
roundAt(unixSeconds): bigint; roundAfter(unixSeconds): bigint; roundTime(round): number

// sealing
type Choice = 'abstain' | 'for' | 'against'   // maps to 0/1/2
sealVote({ proposalId, voter, choice, closeRound, salt? }): Promise<{ commitment: Hex; ciphertext: Hex; salt: Hex; plaintext: Hex }>
  // plaintext = abi.encode(uint8 choice, bytes32 salt) (64 bytes); ciphertext = tlock(closeRound, plaintext) raw (not armored)
hashVote({ proposalId, voter, choice, salt }): Hex           // must equal SealedDAO.hashVote
unsealVote({ ciphertext, closeRound, beacon? }): Promise<{ choice, salt } | null>   // null if it fails to decrypt or decode
unsealProposal({ client, dao, proposalId }): Promise<{ items: RevealItem[]; skipped: Address[] }>
  // reads Sealed logs in ≤ 9,999-block windows with a cursor (Arc's eth_getLogs cap is 10k), fetches the beacon once, decrypts all
buildRevealBatch(items): { voters, choices, salts }  // ≤ 256 items per tx, splits if more

// drand
getBeacon(round): Promise<{ round, signature }>   // tries api.drand.sh, api2.drand.sh, drand.cloudflare.com in order
waitForRound(round, { signal }): Promise<Beacon>

// viem actions (read + write), one per contract function, plus getProposal, getStatus, listProposals(fromBlock cursor)
// ABI: generated from Foundry artifacts into src/abi/SealedDAO.ts; `pnpm sdk:check-abi` fails if stale
// logging: pino child logger with correlation id per unsealProposal call
```
Salt: `crypto.getRandomValues(new Uint8Array(32))`. The SDK refuses salts shorter than 32 bytes. Local persistence of `{proposalId, salt, choice}` is the app's job (see §6), so a voter can reveal their own vote even if drand is unreachable.

### 5.1 `@arcseal/tlock`
Vendored copy of tlock-js 0.9.0 (MIT, credit kept in `LICENSE-tlock-js`). Changes allowed: remove fastnet/testnet clients, pin quicknet chain info as a constant (no network call for chain info), replace Node `Buffer` usage with `Uint8Array` where it breaks the browser build, export `encrypt(round, bytes): Promise<Uint8Array>` and `decrypt(bytes, beacon): Promise<Uint8Array>` that take the beacon explicitly (no hidden HTTP inside decrypt). Keep the age armor helpers only if needed by tests.
Test vectors: 3 fixed `(round, plaintext)` pairs encrypted by Go `tle` v1.2.0 and by the vendored lib; both must decrypt each other's output. Vectors committed under `packages/tlock/test/vectors/`. CI does not call the network: the beacon signatures for the vector rounds are committed too.

---

## 6. Web app (`apps/web`)

Static export, deployed under `https://r4topunk.github.io/arcseal/app/` (or the site root with the project page at `/`; keep the same convention as ArcPull). Config via `NEXT_PUBLIC_*`: chain id, RPC, DAO address, explorer, site URL, repo URL. Supports mainnet (5042) and testnet (5042002) by env.

Pages:
1. `/` project page: what, why Arc, how it works (envelope metaphor, then the technical diagram), the D17 privacy statement, proof links, contract addresses, docs links. Same visual template as ArcDraw/ArcPull pages (white, three sections, English, PT-BR toggle).
2. `/app/proposals`: list with status chips, close/reveal countdowns, counts.
3. `/app/proposals/[id]`: details; action per status: Voting → choice + "Seal vote" (stores `{salt, choice}` in localStorage keyed by chain/dao/proposal/voter, wrapped in try/catch, and offers a download of the receipt JSON); Revealing → "Reveal votes" (decrypt all in browser, show which decrypted, send `revealBatch`), plus "Reveal only mine" using the local receipt; Ready → "Finalize"; Passed → "Execute"; any → event timeline with explorer links.
4. `/app/new`: create proposal form (kind, target, amount or flag, description, duration presets 10 min / 1 h / 24 h / 7 d).
5. `/app/treasury`: balance, claimable for connected wallet, "Claim", members list, "Fund treasury" (plain USDC transfer helper).
6. `/docs/*`: rendered from `content/*.md` (integration, faq, spec summary).

UX rules: show the drand round and the wall-clock time for every deadline; show USDC amounts with 6 decimals and never mix with the 18-decimal native view; show gas estimates in USDC; every write shows the tx hash with an explorer link; errors map contract custom errors to plain sentences.

---

## 7. Security and threat model (`docs/THREATS.md` must cover these)

| Threat | Handling |
|---|---|
| Garbage or malformed ciphertext | Never parsed onchain. Skipped in `revealBatch`. Counts as abstain. Only harms the poster |
| Brute-force of the commitment | 32-byte CSPRNG salt enforced by SDK and by `bytes32` type; 3 choices × 2^256 salts |
| Early decryption | Requires breaking drand's threshold (League of Entropy) or BLS12-381. Out of model |
| drand outage | quicknet is unchained: round `R`'s signature is computable whenever the network returns. Reveal window is 24 h; if drand stays down longer, unrevealed votes become abstentions. Voters keep local receipts and can reveal without drand |
| Nobody reveals | Abstentions; quorum still counts sealed votes. The site button and the bounty are the incentive |
| Reveal front-running | Harmless: whoever includes first gets the bounty; the tally is the same |
| Replay across proposals or voters | Commitment binds `proposalId` and `voter` |
| Double reveal | Sentinel after consume |
| Treasury drain | Only via passed proposals; bounty capped per revealed vote; `totalClaimable` accounting keeps claims solvent |
| Blocklisted recipient | Pull-based claim; nothing else blocks |
| Member removed while voting | Cannot seal after removal; an already-sealed vote still counts (documented) |
| Reentrancy | `claim` follows checks-effects-interactions; USDC has no hooks; still use a nonReentrant guard on `claim` and `execute` |
| Timestamp manipulation | Validators control `block.timestamp` within seconds; windows are minutes to days. Documented |
| Unverified USDC implementation | Only `balanceOf` and `transfer` are used |

Not provided: anonymity, coercion resistance, protection against a majority of members colluding.

---

## 8. Test plan

### 8.1 Contracts (Foundry), target ≥ 60 tests
- Unit: round math against 20 fixed vectors (shared with SDK via `test/vectors/rounds.json`); every revert path; every status transition; snapshot semantics; bounty credited vs skipped; expiry.
- Reveal batch: mixed valid/invalid/duplicate/unknown voters; 256-item cap; gas per item.
- Blocklist: mock USDC with a blocklist, claim reverts and balance remains claimable.
- Fuzz: random member sets, random choices and salts, tally equals oracle; random ciphertext lengths inside and outside bounds.
- Invariants: `balanceOf(this) >= totalClaimable`; `forCount + againstCount + abstainCount == revealedCount <= sealedCount <= memberSnapshot`; a proposal never leaves Executed/Expired.
- FFI: `hashVote` equals the SDK's `hashVote` for 10 vectors.
- Fork (read-only, `ARC_RPC` optional): USDC `decimals() == 6`, `balanceOf` works on the real token.
- Gas snapshot committed; CI fails on > 5% regression.

### 8.2 tlock and SDK (Vitest), target ≥ 50 tests
- Cross-implementation vectors with `tle` (offline, committed).
- Round math vectors shared with Foundry.
- `sealVote`/`unsealVote` round trip with a committed beacon; wrong beacon fails to null; truncated ciphertext fails to null.
- `unsealProposal` against an anvil (`arc-anvil` if available, else `anvil`) with 5 voters including one garbage ciphertext; log cursor windows of 9,999 blocks.
- Browser smoke: Vite build of a page that seals and unseals with a committed beacon (Playwright, headless Chromium).

### 8.3 Web (Vitest + Testing Library), target ≥ 20 tests
Status rendering per state, form validation, amount formatting, localStorage receipt round trip with storage disabled, custom error mapping.

### 8.4 End-to-end on testnet (chain 5042002)
Scripted with three keystores: propose, three sealed votes, wait for round, reveal via SDK, finalize, execute, claim. Script under `scripts/e2e-testnet.ts`, idempotent, prints all tx hashes.

---

## 9. Measured facts the build relies on (from research, 2026-09-17/18)
- tlock-js 0.9.0: `mainnetClient()` is quicknet (`52db9ba7…e971`, `bls-unchained-g1-rfc9380`, period 3 s, genesis 1692803367). Public key 96 B (G2), signatures 48 B (G1).
- Ciphertext overhead is 359 bytes flat: age header 327 B + stanza 128 B (U 96 B, V 16 B, W 16 B) minus shared bytes. 64-byte plaintext → 423 B raw. Use raw bytes, not armored.
- EIP-7623 is active on Arc: effective calldata cost is 40 gas per non-zero byte. Posting a 659-byte ciphertext in calldata plus event costs about 53k gas ≈ 0.001 USDC, cheaper than one SSTORE.
- Arc USDC at `0x3600…0000` is FiatTokenV2_2-like, ERC-20 view has 6 decimals, name "USDC", version "2". Implementation `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6` is not on Sourcify.
- EIP-2537 precompiles `0x0b`–`0x11` are live (not used here).
- `eth_getLogs` is capped at 10,000 blocks per call on the public RPC.
- Block time about 0.5 s. Gas price floor 20 gwei. Chain id 5042 mainnet, 5042002 testnet, RPC `https://rpc.mainnet.arc.io` / `https://rpc.testnet.arc.io`, faucet `https://faucet.circle.com`, explorer `https://explorer.arc.io` (Cloudflare-gated API; verify via Sourcify, which supports 5042).
- Go `tle` v1.2.0 defaults to quicknet: `go install github.com/drand/tlock/cmd/tle@latest`.

---

## 10. Definition of done

### 10.1 Code (agents)
- [ ] `pnpm install && pnpm check` green at the repo root (build, contracts tests, SDK/web tests, typecheck, lint, forge fmt, ABI check).
- [ ] Test counts meet §8 targets; gas snapshot committed; `docs/GAS.md` filled from the snapshot.
- [ ] Browser smoke test passes (seal + unseal in headless Chromium).
- [ ] Testnet e2e script completes and its output (tx hashes) is saved to `deployments/arc-testnet.json`.
- [ ] Docs complete: README (with the tables in the same style as ArcPull: what, why Arc, guarantees, addresses, proof), SPEC, THREATS, GAS, DEPLOY, CHECKLIST, SUBMISSION, AGENTS.md. Site copy EN + PT-BR.
- [ ] `site/index.html` project page and `.github/workflows/pages.yml` present.
- [ ] No secrets in the repo; `.env.example` only. Never read or print `/Users/r4to/Script/arc/.env` contents.

### 10.2 Human steps (CHECKLIST.md, same style as ArcPull's)
1. Fund deployer and three member wallets on mainnet (about 5 USDC total; existing wallets: main = deployer and member 1, WALLET_B, WALLET_C; keys already in `/Users/r4to/Script/arc/.env`, never printed).
2. Deploy `SealedDAO(usdc, [main, B, C], 5000, 10_000)` with CREATE2 salt `keccak256("arcseal.v1")`; record `deployments/arc-mainnet.json`; verify on Sourcify (exact match).
3. Fund the treasury with 2 USDC.
4. Proof 1: proposal "Pay 1 USDC to WALLET_C" with 10-minute voting; three sealed votes (For, For, Against); after close, reveal via the site button from WALLET_B; finalize; execute; claim from WALLET_C.
5. Proof 2: proposal "Add member 0x…" (a fourth address, can be OPS) with 10-minute voting; two sealed votes and one member abstaining by not voting; reveal; finalize; execute. Check `memberCount == 4`.
6. Proof 3 (negative): a proposal that fails quorum (only one member seals) and a `revealBatch` containing one garbage item that gets skipped. Both hashes recorded.
7. Update README proof table, `deployments/arc-mainnet.json` `proofTxs`, `docs/GAS.md` mainnet column, site status line.
8. Push to `github.com/r4topunk/arcseal` public, Pages enabled, page live.
9. Submit the BUIDL on DoraHacks with the text in `SUBMISSION.md` (links: live page, repo, explorer addresses, short Arc-usage paragraph, GitHub/X profiles). Note the form keeps no drafts and dropdowns linger.

---

## 11. Repository layout
```
arcseal/
  AGENTS.md  README.md  LICENSE (MIT)  CHECKLIST.md  DEPLOY.md  SUBMISSION.md  .env.example
  package.json  pnpm-workspace.yaml  .github/workflows/{ci.yml,pages.yml}
  contracts/   foundry.toml remappings.txt src/{Sealed.sol,SealedDAO.sol,interfaces/} test/{unit,fuzz,invariant,ffi,fork} script/{Deploy.s.sol,record-deployment.mjs} test/vectors/
  packages/tlock/   vendored lib, src/, test/vectors/, LICENSE-tlock-js
  packages/sdk/     src/{index.ts,round.ts,seal.ts,drand.ts,actions.ts,abi/,schemas.ts,logger.ts} test/
  apps/web/         Next.js static export, content/{en,pt-BR}/*.md
  scripts/          e2e-testnet.ts, reveal-cli.ts (optional reference relayer, not hosted)
  docs/             SPEC.md THREATS.md GAS.md
  deployments/      arc-testnet.json arc-mainnet.json
  site/index.html   project page (GitHub Pages root)
```
Root scripts mirror ArcPull: `build`, `test`, `check`, `lint`, `typecheck`, `contracts:*`, `sdk:check-abi`, `e2e:testnet`.

---

## 12. Execution plan for the build session (Workflow)

The next session should run this as a Workflow (the user's standing opt-in covers it). Agents on `opus` unless noted. Every agent gets this PRD path, the two reference repo paths, the target directory `/Users/r4to/Script/arc/arc-seal`, and the rule "never read `.env`". Phases are sequential; items inside a phase run in parallel.

| Phase | Agents (parallel) | Output | Gate |
|---|---|---|---|
| 0 Scaffold | 1 agent: monorepo skeleton copied from ArcPull conventions, CI, lint, foundry, empty packages | `pnpm check` green on empty project | reviewer agent confirms layout matches §11 |
| 1 Primitive | A: `packages/tlock` (vendor, browser build, `tle` vectors). B: `Sealed.sol` + round math + Foundry tests + `test/vectors/rounds.json`. C: `@arcseal/sdk` round math + `hashVote` + Zod schemas (stubs for seal/unseal) | tests green per package | A's vectors decrypt in both directions; B and C agree on 20 round vectors |
| 2 DAO | A: `SealedDAO.sol` + unit/fuzz/invariant/blocklist tests + gas snapshot. B: SDK `sealVote`/`unsealVote`/`unsealProposal`/actions + tests on anvil. C (sonnet): `docs/SPEC.md` and `docs/THREATS.md` drafted from this PRD | contracts ≥ 60 tests, SDK ≥ 50 | verifier agent runs `pnpm check`, reads THREATS against §7, checks FFI vectors |
| 3 App | A: `apps/web` pages + tests. B (sonnet): `site/index.html` + content EN/PT-BR + README skeleton. C: `scripts/e2e-testnet.ts` + `Deploy.s.sol` + `DEPLOY.md` | browser smoke green; e2e script dry-runs on anvil | reviewer agent clicks through the static export with Playwright |
| 4 Review | Two independent reviewer agents: one security review of contracts against §7 (adversarial, writes findings with repro tests), one product review of site copy against D17 and §2.3 | findings fixed or explicitly deferred | all CONFIRMED findings fixed; `pnpm check` green |
| 5 Handoff | 1 agent (sonnet): `CHECKLIST.md`, `SUBMISSION.md`, `AGENTS.md`, final README tables with TBD rows for mainnet | human checklist ready | Fable spot-checks sonnet output |

Budget guideline: about 10 agents in total across phases; phases 1 and 2 are the heavy ones. Testnet e2e and everything in §10.2 are human-driven (keys and real USDC) and happen after the workflow.

---

## 13. Metrics
- Cost per sealed vote and per revealed vote in USDC (target ≤ 0.002 and ≤ 0.003).
- Close-to-execute latency in the mainnet demo (target < 5 minutes with manual reveal).
- Votes lost in the proofs: 0.
- Regression: gas snapshot and test counts in CI.

## 14. UNKNOWN
- Whether the vendored tlock-js needs a `Buffer` polyfill in the browser (age header code). Phase 1A must settle it and document the fix.
- Whether `arc-anvil` reproduces EIP-7623 calldata pricing; if not, gas numbers for `vote` come from testnet.
- Whether Sourcify verification of a contract with a CREATE2 salt needs the constructor args encoded manually (ArcPull's DEPLOY.md has the working procedure; reuse it).
- Legal note: the Brazilian analysis is research, not counsel. Design avoids chance, prizes, custody of third-party savings and token sales.
