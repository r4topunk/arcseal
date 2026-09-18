# ArcSeal technical spec

> Implementation spec for the product defined in [`PRD.md`](../PRD.md). All 18 decisions in PRD §3 are final; this
> document explains how they are built, it does not reopen them.
> Onchain source of truth: [`contracts/src/Sealed.sol`](../contracts/src/Sealed.sol) and
> [`contracts/src/SealedDAO.sol`](../contracts/src/SealedDAO.sol). If this file and the contracts disagree, the
> contracts win, unless they break an explicit PRD §3/§4 rule (that would be a contract bug, not a spec change).

## TL;DR

```sh
pnpm install
pnpm build     # forge build + tlock / sdk / web / scripts builds
pnpm test      # forge test (unit, fuzz, invariant, ffi; fork skipped without ARC_RPC) + every vitest suite
pnpm check     # build + test + typecheck + lint + forge fmt --check + ABI drift check + gas snapshot check (5%)
```

- 1 abstract primitive (`Sealed`, never deployed alone) + 1 concrete app (`SealedDAO`, immutable, no owner).
- A vote is a `keccak256` commitment + a raw tlock ciphertext, both posted onchain at `vote()` time. The contract
  never parses the ciphertext and never touches BLS; it only compares hashes once the ciphertext is decrypted
  offchain and revealed.
- Money path is pull-only: `execute()` and `revealBatch()` credit `claimable[account]`; `claim()` alone moves USDC.
- Time is drand quicknet rounds, not blocks: `roundTime(r) = GENESIS + (r-1) * PERIOD`. Sealing closes and the
  reveal window opens at the same instant, `roundTime(closeRound)`.

## 1. Overview

```
                         drand League of Entropy — quicknet (unchained, 3 s)
                                            |
                         HTTP: api.drand.sh / api2 / cloudflare (SDK getBeacon)
                                            |
   Voter ---sealVote()---> ciphertext,commitment ---vote()---> SealedDAO (inherits Sealed)
                                            |                     |  storage: bytes32 commitment, round only
                                            |                     |  event Sealed(ciphertext) — never in storage
                                            v                     |
                         Revealer --unsealProposal()--> decrypt all --revealBatch()--> tally, bounty
                                            |                     |
                                            v                     v
                                     apps/web (site button)   claimable[account] --claim()--> USDC transfer
```

Repo layout (PRD §11):

```
contracts/    Foundry: src/{Sealed.sol,SealedDAO.sol,interfaces/IERC20.sol}, test/{unit,fuzz,invariant,ffi,fork,mocks},
              test/vectors/{rounds.json,hashvote.json}
packages/tlock/   vendored tlock-js 0.9.0, quicknet only, Node + browser
packages/sdk/     @arcseal/sdk: round math, seal/unseal, reveal, drand, viem actions, Zod schemas
apps/web/         Next.js static export, EN/PT-BR
docs/             SPEC.md (this file), THREATS.md, GAS.md
```

Design rule that shapes every section below: **the hash is the authority (D11)**. `Sealed` and `SealedDAO` never
inspect, parse or verify a ciphertext or a drand signature onchain. A ciphertext that is garbage, truncated, or
encrypted to the wrong round only ever fails to decrypt offchain or fails a hash comparison at reveal — it can never
revert a transaction or corrupt state.

There is **no relayer and no singleton (D7, D9)**: `Sealed` is never deployed on its own, and no service watches
the chain on anyone's behalf. The "Reveal votes" button in `apps/web` decrypts every sealed vote in the visitor's own
browser (`unsealProposal`) and submits `revealBatch` from their wallet (one transaction per 256 votes). Anyone could
run the same SDK calls from a script instead; nothing in the protocol requires the site. Invalid items inside a batch
are skipped (`RevealSkipped`), never reverted.

## 2. Constants

```
QUICKNET_GENESIS       = 1_692_803_367   // unix seconds, drand quicknet round 1               (Sealed)
QUICKNET_PERIOD        = 3               // seconds between rounds                              (Sealed)
REVEAL_WINDOW          = 28_800          // rounds = 24 h                                       (Sealed)
MIN_VOTING             = 600             // seconds (10 min)                                    (Sealed)
MAX_VOTING             = 604_800         // seconds (7 days)                                    (Sealed)
MIN_CIPHERTEXT_LENGTH  = 359             // bytes, measured tlock/age overhead for quicknet     (Sealed)
MAX_CIPHERTEXT_LENGTH  = 1_024           // bytes, caps calldata + log cost per seal            (Sealed)
REVEALED               = bytes32(uint256(1))  // sentinel stored after a reveal                 (Sealed)
EXECUTION_GRACE        = 604_800         // seconds (7 days), after the reveal window ends      (SealedDAO)
MAX_BATCH              = 256             // items per revealBatch call                          (SealedDAO)
MAX_DESCRIPTION_LENGTH = 256             // bytes of Proposal.description                       (SealedDAO)
MAX_DESCRIPTION_URI_LENGTH = 2_048       // bytes of Proposal.descriptionURI                    (SealedDAO)
USDC                   = 0x3600000000000000000000000000000000000000   // ERC-20 view, 6 decimals (constructor arg)
```

All but `USDC` are `public constant`, so they are ABI getters of a deployed `SealedDAO`; the token address is the
constructor argument behind the `usdc` immutable. The SDK mirrors them:
`round.ts` exports `QUICKNET_GENESIS`, `QUICKNET_PERIOD`, `REVEAL_WINDOW`, `MIN_VOTING`, `MAX_VOTING` and
`EXECUTION_GRACE` (tested against the 20 shared vectors in `contracts/test/vectors/rounds.json`, read by both Foundry
and Vitest); `schemas.ts` exports `CIPHERTEXT_MIN_BYTES` / `CIPHERTEXT_MAX_BYTES`; `reveal.ts` exports
`MAX_REVEAL_BATCH`; `actions.ts` exports `REVEALED_COMMITMENT`; `index.ts` exports `USDC_ADDRESS` and `USDC_DECIMALS`.

## 3. Round math

```
roundAt(t)      = (t - GENESIS) / PERIOD + 1
roundAfter(t)   = roundAt(t)          if (t - GENESIS) % PERIOD == 0
                = roundAt(t) + 1      otherwise
roundTime(r)    = GENESIS + (r - 1) * PERIOD
```

`Sealed.roundAfter` computes the same value branch-free, as `ceil((t - GENESIS) / PERIOD) + 1`
(`(elapsed + PERIOD - 1) / PERIOD + 1`), so `propose` costs the same gas in every second: with a branch it cost 70
gas more off a round boundary, and an exact gas estimate taken one second earlier could run out of gas (audit F4).

`roundAt` and `roundAfter` revert (Solidity: `Panic(0x11)`; SDK: `RangeError`) for `t < GENESIS` — no round exists
before drand's genesis. `roundTime(0)` reverts the same way — round 0 does not exist. Narrowing to `uint64` is
checked in Solidity (`RoundOverflow`, unreachable in practice) and to `Number.MAX_SAFE_INTEGER` in the SDK.

Derived, used by `Sealed._openGroup` and mirrored in `round.ts`:

```
closeRound(t, votingSeconds)      = roundAfter(t + votingSeconds)
revealEndRound(closeRound)        = closeRound + REVEAL_WINDOW
sealingOpen(closeRound, t)        = t < roundTime(closeRound)
revealOpen(closeRound, t)         = roundTime(closeRound) <= t < roundTime(revealEndRound)
executionDeadline(revealEndRound) = roundTime(revealEndRound) + EXECUTION_GRACE
```

### Worked example

`propose()` is called at `t0 = 1_790_812_800` (2026-10-01T00:00:00Z, itself a round boundary) with
`votingSeconds = 600` (the 10-minute demo duration, PRD §10.2 proof 1):

```
end            = t0 + 600                = 1_790_813_400
end - GENESIS  = 1_790_813_400 - 1_692_803_367 = 98_010_033        (divisible by 3: t0 and 600 are both boundaries)
roundAt(end)   = 98_010_033 / 3 + 1      = 32_670_012
roundAfter(end)= roundAt(end)                                       // end is exactly on a boundary
closeRound     = 32_670_012
revealEndRound = closeRound + 28_800     = 32_698_812
roundTime(closeRound)     = GENESIS + 32_670_011 * 3 = 1_790_813_400   // == end, as expected
roundTime(revealEndRound) = GENESIS + 32_698_811 * 3 = 1_790_899_800   // == roundTime(closeRound) + 86_400 (24 h)
```

Sealing is open for `[t0, 1_790_813_400)`. Reveal is open for `[1_790_813_400, 1_790_899_800)` — exactly 24 h.
`finalize` becomes possible at `1_790_899_800`, and a passed proposal can be executed until
`1_790_899_800 + 604_800` inclusive; one second later it is `Expired`.

## 4. Commitment, plaintext and ciphertext formats

**Commitment (D11).** The hash is the sole onchain authority:

```solidity
commitment = keccak256(abi.encode(uint256 proposalId, address voter, uint8 choice, bytes32 salt))
```

`proposalId` and `voter` are domain separators: the same `(choice, salt)` pair hashes differently per proposal and
per voter, so a leaked commitment cannot be replayed elsewhere. `salt` is 32 bytes from a CSPRNG
(`crypto.getRandomValues`); the SDK's `saltSchema` refuses anything but exactly 32 bytes, and `sealVoteInputSchema`
additionally refuses an explicit all-zero salt (a zero salt makes a 3-choice commitment guessable). `SealedDAO`
exposes the same formula as a `pure` function, `hashVote(id, voter, choice, salt)` (the `Choice` enum is ABI-encoded as
a `uint8` word), so a revealer can recompute it without the SDK. The 10 committed vectors in
`contracts/test/vectors/hashvote.json` are checked by the SDK (`packages/sdk/test/seal.test.ts`), by the contract
(`HashVoteFfiTest.test_ffi_contractMatchesCommittedVectors`) and by the built SDK called from Foundry through `vm.ffi`
(`packages/sdk/scripts/ffi-hash-vote.mjs`, `HashVoteFfiTest.test_ffi_sdkMatchesContractOnVectors` and
`test_ffi_sdkMatchesContractOnFreshInputs`). Any vector can also be reproduced with Foundry's `cast`:

```sh
cast keccak $(cast abi-encode "f(uint256,address,uint8,bytes32)" 1 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 1 0x7f03d7f6c28f22eb389f3b2b3f8000e0bd10814b592bcbec14a2bfaedc522b4e)
# 0x0836fa805c79dc993147f1e959ba5b9e3e460cefe9500469b9c92c56950c6b51
```

**Plaintext.** What gets timelock-encrypted, 64 bytes:

```solidity
plaintext = abi.encode(uint8 choice, bytes32 salt)     // Choice: Abstain = 0, For = 1, Against = 2
```

An all-zero plaintext decodes to `Abstain` with an all-zero salt, a harmless abstention (that is why `Abstain` is enum
value 0, PRD §4.3). `decodeVotePlaintext` returns `null` unless the input is exactly 64 bytes, the first word is a
clean `uint8` (31 zero bytes, as `abi.decode` requires) and the index is `0..2`.

**Ciphertext.** Raw (not age-armored) tlock output, encrypted to the proposal's `closeRound`:

```
ciphertext = tlock.encrypt(closeRound, plaintext)     // @arcseal/tlock, quicknet only
```

Measured overhead is a flat 359 bytes (age header 327 B + stanza 128 B, minus shared bytes — PRD §9) for any 8-digit
round, which covers every round until 2033-02. A 64-byte vote plaintext therefore seals to **423 bytes**. `Sealed._seal`
accepts `[MIN_CIPHERTEXT_LENGTH, MAX_CIPHERTEXT_LENGTH]` = `[359, 1024]` bytes and never looks inside; the upper bound
leaves room for larger arbitrary-payload uses of the primitive without changing the module.

> **Note on PRD §4.2 vs §5.** §4.2's parenthetical ("the DAO payload is 96 bytes ABI-encoded, so about 455 bytes")
> does not match §5's exact plaintext definition (`abi.encode(uint8, bytes32)`, 64 bytes). §5 is the only section that
> gives a full encoding, and `@arcseal/tlock`, `@arcseal/sdk` and the contract tests implement it, so the real vote is
> **64-byte plaintext / 423-byte ciphertext**. Both sizes are inside `Sealed`'s `[359, 1024]` bound. `docs/GAS.md`
> measures `vote` at both sizes: 455 bytes for the PRD §4.5 target row, 423 bytes for what the SDK actually sends.

## 5. The `Sealed` module

Abstract, never deployed alone (D7). Keyed by `(groupId, sealer)`; a `SealedDAO` proposal is one group, with
`groupId = proposalId`.

```solidity
struct SealGroup { uint64 closeRound; uint64 revealEndRound; }
mapping(uint256 groupId => SealGroup) internal _groups;
mapping(uint256 groupId => mapping(address sealer => bytes32)) internal _commitments;

event SealGroupOpened(uint256 indexed groupId, uint64 closeRound, uint64 revealEndRound);
event Sealed(uint256 indexed groupId, address indexed sealer, bytes32 commitment, bytes ciphertext);
event Revealed(uint256 indexed groupId, address indexed sealer, bytes32 commitment);
```

| Function | Visibility | Preconditions | Effects | Reverts |
|---|---|---|---|---|
| `_openGroup(groupId, votingSeconds)` → `closeRound` | internal | group not already open | `closeRound = roundAfter(now + votingSeconds)`, `revealEndRound = closeRound + REVEAL_WINDOW`; emits `SealGroupOpened` | `BadDuration` outside `[MIN_VOTING, MAX_VOTING]`; `GroupAlreadyOpen` for an existing group id |
| `_seal(groupId, sealer, commitment, ciphertext)` | internal | sealing open; sealer has no commitment (live or consumed) | stores `commitment`; emits `Sealed(..., ciphertext)` | `SealingClosed` (closed or unknown group); `AlreadySealed`; `BadCommitment` (0 or the `REVEALED` sentinel); `BadCiphertextLength` (outside `[359, 1024]`) |
| `_verifyReveal(groupId, sealer, expected)` → `bool` | internal view | none, never reverts | pure comparison | — (returns `false` for a mismatch, an empty commitment, or `REVEALED`) |
| `_consumeReveal(groupId, sealer)` | internal | reveal window open; sealer has a live commitment | replaces the commitment with `REVEALED`; emits `Revealed` | `RevealNotOpen`; `RevealClosed`; `NothingSealed` |
| `_reveal(groupId, sealer, expected)` | internal | reveal window open | strict single reveal: `_verifyReveal` then consume (not used by `SealedDAO`) | `RevealNotOpen`; `RevealClosed`; `BadReveal` (mismatch, empty, or already revealed) |
| `_requireRevealOpen(groupId)` | internal view | — | — | `RevealNotOpen` (unknown group or before the close); `RevealClosed` — lets a batch caller fail once, up front |
| `roundAt`, `roundAfter`, `roundTime` | public pure | — | — | see §3 |
| `sealingOpen(groupId)`, `revealOpen(groupId)` | public view | — | — | never reverts; `false` for an unknown group |

`_seal`'s check order is `SealingClosed` → `AlreadySealed` → `BadCommitment` → `BadCiphertextLength`; an unknown
group reports `SealingClosed`. A revealed commitment becomes the sentinel `REVEALED = bytes32(uint256(1))`, so a
second reveal of the same sealer reads as "no live commitment" (`NothingSealed` / a `false` from `_verifyReveal`),
never as a stale match, and a sealer can never seal again in that group (`AlreadySealed`). `_verifyReveal` does not
check the window: batch callers call `_requireRevealOpen` once, then `_verifyReveal` + `_consumeReveal` per item, so an
out-of-window batch reverts even when every item would have been skipped, and `_consumeReveal` enforces the window
again on every consume, whichever path calls it.

Errors: `SealingClosed`, `RevealNotOpen`, `RevealClosed`, `AlreadySealed`, `NothingSealed`, `BadReveal`,
`BadDuration`, `BadCiphertextLength`, `BadCommitment`, `GroupAlreadyOpen`, `RoundOverflow`. The last three are not in
PRD §4.2's list: without them a zero or sentinel commitment, a re-opened group and a truncated round number would be
silent state corruption instead of a revert.

## 6. `SealedDAO` (PRD §4.3)

```solidity
enum Choice     { Abstain, For, Against }              // 0/1/2, matches the SDK's CHOICES tuple order
enum ActionKind { TransferUSDC, SetMember }
enum Status     { Voting, Revealing, Ready, Passed, Failed, Executed, Expired }   // derived, never stored

struct Proposal {
    address proposer; ActionKind kind; address target; uint256 amount; bool flag;
    string  description; string descriptionURI;
    uint64  closeRound; uint64 revealEndRound;
    uint32  memberSnapshot; uint32 sealedCount; uint32 revealedCount;
    uint32  forCount; uint32 againstCount; uint32 abstainCount;
    bool    finalized; bool passed; bool executed;
}

IERC20  public immutable usdc;           // 0x3600…0000 on Arc
uint16  public immutable quorumBps;      // (0, 10_000]; 5000 in the mainnet demo
uint256 public immutable revealBounty;   // USDC base units per revealed vote; 10_000 (0.01 USDC) in the demo; 0 disables
uint32  public memberCount;
mapping(address account => bool)    public isMember;
mapping(address account => uint256) public claimable;
uint256 public proposalCount;            // ids run 1..proposalCount
mapping(uint256 id => Proposal) internal _proposals;
uint256 public totalClaimable;           // sum of every claimable balance
bool private transient _entered;         // reentrancy lock of revealBatch, execute and claim (EIP-1153)
```

For `TransferUSDC`, `amount` is used and `flag` is stored as given and ignored; for `SetMember`, `flag` (true adds,
false removes) is used and `amount` is stored as given and ignored. `descriptionURI` is bounded to 2,048 bytes
(`DescriptionURITooLong`, audit F8), but its scheme is not checked onchain: anything that renders it must link only
safe schemes (`apps/web` links `https://`, `http://` and `ipfs://` only and shows anything else as inert text).

### 6.1 Functions

Reverts are listed in check order (the first failing check wins).

| Function | Caller | Preconditions / effects | Reverts (in order) |
|---|---|---|---|
| `constructor(usdc_, initialMembers[], quorumBps_, revealBounty_)` | deployer | sets `isMember` for every initial member and emits `MemberSet(member, true)` for each, `memberCount = initialMembers.length`; `usdc`, `quorumBps`, `revealBounty` are immutable (D14) | `BadUSDC` (`usdc_ == 0`); `BadQuorum` (`quorumBps_` 0 or > 10_000); `NoMembers` (empty list); `BadMember` (zero address); `DuplicateMember` |
| `propose(kind, target, amount, flag, description, descriptionURI, votingSeconds)` → `id` | member | `id = ++proposalCount`; `closeRound = _openGroup(id, votingSeconds)`; `memberSnapshot = memberCount`; emits `SealGroupOpened` then `ProposalCreated` | `NotMember`; `BadTarget` (`target` is 0, this DAO or the USDC token, both kinds); `BadAmount` (`TransferUSDC` with `amount == 0`); `DescriptionTooLong` (> 256 bytes); `DescriptionURITooLong` (> 2,048 bytes); `BadDuration` (`votingSeconds` outside `[600, 604_800]`) |
| `vote(id, commitment, ciphertext)` | member | `isMember[msg.sender]` checked live, **not** against `memberSnapshot` (§6.3); `_seal(id, msg.sender, commitment, ciphertext)`; `++sealedCount`; emits `Sealed` (from the module; the DAO emits no separate vote event) | `NotMember`; `SealingClosed` (also an unknown id); `AlreadySealed`; `BadCommitment`; `BadCiphertextLength` |
| `revealBatch(id, voters[], choices[], salts[])` → `revealed` | anyone | `nonReentrant`; `_requireRevealOpen(id)` once; per item: if `hashVote(id, voters[i], choices[i], salts[i])` is not the voter's live commitment (`_verifyReveal` false: wrong choice or salt, a voter who never sealed, one already revealed, a duplicate in this batch), emit `RevealSkipped(id, voter)` and continue; else `_consumeReveal` (emits `Revealed`), count it, emit `VoteRevealed(id, voter, choice)`. Then add the batch tally to `revealedCount` and the matching `for/against/abstainCount`, and apply the bounty (§6.5: only when the proposal met quorum). Returns the number revealed | `Reentrancy`; `LengthMismatch`; `TooManyItems` (> 256); `RevealNotOpen` (also an unknown id); `RevealClosed`. A `choices[i]` value above 2 fails ABI decoding and reverts the whole call with empty data (such a choice can never match a commitment; the SDK never builds one) |
| `finalize(id)` | anyone | from `roundTime(revealEndRound)` on, once; `finalized = true`; `passed = quorumMet && forCount > againstCount`; emits `Finalized`. No deadline | `AlreadyFinalized`; `NotReady` (before the reveal window ends, or an unknown id) |
| `execute(id)` | anyone | `nonReentrant`; `finalized && passed && !executed && now <= executionDeadline(revealEndRound)`; sets `executed`. `TransferUSDC`: requires `max(balance - totalClaimable, 0) >= amount`, then `claimable[target] += amount; totalClaimable += amount` (nothing is transferred). `SetMember`: `isMember[target] = flag`, `memberCount ± 1`, emits `MemberSet`. Then emits `Executed` | `Reentrancy`; `NotReady` (not finalized, or an unknown id); `NotPassed`; `AlreadyExecuted`; `Expired`; then `InsufficientTreasury` (TransferUSDC) or `NoOp` (SetMember: adding a member or removing a non-member) and `LastMember` (SetMember: removing the only member) |
| `claim()` | anyone with a balance | `nonReentrant`, checks-effects-interactions: `amount = claimable[msg.sender]`, zero it, `totalClaimable -= amount`, then `usdc.transfer(msg.sender, amount)` with a return check; emits `Claimed` | `Reentrancy`; `NothingToClaim`; if the token reverts with data (for example `"Blacklistable: account is blacklisted"`), that revert is **bubbled unchanged**; `TransferFailed` only when `transfer` returns `false`, returns fewer than 32 bytes, or reverts with empty data. Any revert rolls back the zeroing, so the balance stays claimable (D13) |
| `status(id)` → `Status` | anyone | view, see §6.2 | `UnknownProposal` (an id outside `1..proposalCount`) |
| `proposal(id)` → `Proposal` | anyone | view; an unknown id returns an all-zero struct (`closeRound == 0`) | — |
| `commitmentOf(id, voter)` → `bytes32` | anyone | view: 0 if never sealed, the commitment while live, `REVEALED` after the reveal | — |
| `hashVote(id, voter, c, salt)` → `bytes32` | anyone | pure, §4 | — |
| `sealingOpen(id)`, `revealOpen(id)`, `roundAt`, `roundAfter`, `roundTime` | anyone | inherited from `Sealed` (§5) | — |

`SetMember` at `propose` time does **not** check whether the target is already a member or already a non-member —
membership can change between `propose` and `execute` (another proposal may execute first), so that check is
deferred to `execute` (`NoOp`, and `LastMember` for the same reason), exactly per PRD §4.3. A `target` that is the
zero address, the DAO itself or the USDC token is rejected for both kinds (`BadTarget`): none of them can ever call
`claim` or `vote`, so a passed payout to them would stay reserved in `totalClaimable` forever, and adding one as a
member would inflate the quorum denominator forever (audit F6). Any other address, contracts included, is accepted.

There is no `receive` and no `fallback`: a native-value transfer to the DAO reverts. The treasury is funded with a
plain USDC ERC-20 `transfer` to the contract (the 18-decimal native balance is a view of the same USDC; the contract
reads only the 6-decimal ERC-20 view). Only `balanceOf` and `transfer` of the token are ever called.

### 6.2 Status derivation

`status(id)` is a function of stored flags and `block.timestamp`, evaluated in this order (first match wins):

```
closeRound == 0 (never created)                       -> revert UnknownProposal
executed                                              -> Executed
finalized && passed && now > executionDeadline(...)   -> Expired
finalized && passed                                   -> Passed
finalized && !passed                                  -> Failed
now >= roundTime(revealEndRound)                      -> Ready        (not finalized)
now >= roundTime(closeRound)                          -> Revealing
otherwise                                             -> Voting
```

`Executed`, `Expired` and `Failed` are terminal: no function moves a proposal out of them (`executed` and `finalized`
are never cleared, and time only moves forward). `Ready` has no timeout: a proposal nobody finalizes stays `Ready`
forever, and a late `finalize` of a passing proposal after the execution deadline moves it straight to `Expired`.

### 6.3 Quorum, pass rule and eligibility (D4)

```
quorumMet = sealedCount * 10_000 >= memberSnapshot * quorumBps      // computed in uint256, no overflow
passed    = quorumMet && forCount > againstCount                     // a tie fails; all-abstain fails
```

Quorum is measured over **sealed** votes against the proposal's `memberSnapshot` (frozen at `propose`); the
pass/fail comparison is measured over **revealed** votes only. A member who sealed but was never revealed counts toward
quorum and toward nothing else — the vote is neither `for`, `against` nor `abstain` in the tally, it only raises
`sealedCount`.

Vote eligibility is checked live, `isMember[msg.sender]` at the time of `vote()`, not against `memberSnapshot`. This
is deliberate: membership changes only via an executed `SetMember` proposal, and `memberSnapshot` exists solely as
the quorum denominator, not as an allow-list. Two consequences, both tested
(`SealedDAOTest.test_membership_memberAddedMidVoteMayVote`,
`test_membership_removedMemberCannotSealButSealedVoteCounts`): a member added by another proposal's execution *during*
this proposal's voting phase may vote on it; a member removed mid-vote cannot seal a new vote, but a vote they already
sealed still counts everywhere it would have.

`memberCount` never reaches 0: `execute` reverts `LastMember` for a `SetMember` removal of the only member, because
with no member nobody could ever propose again and, with no admin path (D14), the free treasury would be locked
forever (audit F7). The proposal stays `Passed` and then expires.

### 6.4 Reveal window and expiry timeline (D5)

```
propose(t0)                 roundTime(closeRound)                    roundTime(revealEndRound)                 executionDeadline
    |                                |                                         |                                       |
    |<------ sealing (Voting) ------>|<------ reveal window (Revealing) ------>|<---- Ready / Passed / Failed -------->|
    |         [10 min .. 7 d]        |            28,800 rounds = 24 h         |    finalize() from here on, then      |
    |                                |                                         |    execute() until the deadline       |
    v                                v                                         v                                       v
 t0                        t0+votingSeconds (>=)                    roundTime(closeRound) + 24h              + EXECUTION_GRACE (7 d)
```

`vote()` only succeeds in the first bracket; `revealBatch()` only in the second; `finalize()` only at or after the
third mark; `execute()` only between the third mark and the fourth (the deadline second itself included). Because
`REVEAL_WINDOW` is fixed at 28,800 rounds = 24 h regardless of how long voting ran, **the shortest possible
close-to-finalize latency is exactly 24 h** — even a 10-minute proposal cannot finalize before its reveal window
closes. PRD §13's "close-to-execute latency < 5 minutes with manual reveal" therefore cannot be met literally under D5;
what can be under 5 minutes is close-to-reveal (the close round's drand beacon is published at the close itself, and one
`revealBatch` follows).

### 6.5 Bounty rule (D6) and pull payments (D13)

```
available = usdc.balanceOf(this) > totalClaimable ? usdc.balanceOf(this) - totalClaimable : 0
quorumMet = sealedCount * 10_000 >= memberSnapshot * quorumBps      // the D4 formula of finalize (§6.3)
if revealed_this_call == 0 or revealBounty == 0 or not quorumMet:
    nothing (no bounty event)
elif revealBounty <= available / revealed_this_call:          // == revealed * revealBounty <= available, overflow-free
    bounty = revealed_this_call * revealBounty
    claimable[msg.sender] += bounty; totalClaimable += bounty; emit BountyCredited(id, msg.sender, bounty)
else:
    emit BountySkipped(id)                                     // the reveals of this call still count
```

**Quorum gate (audit F1).** D6 reads "a fixed bounty per validly revealed vote"; PRD §7 reads "Treasury drain: only
via passed proposals". Paid unconditionally, the bounty broke §7: one member alone could create throwaway proposals,
seal one vote on each and reveal it, and empty the 2 USDC demo treasury inside one 10-minute window at a net profit,
faster than any `SetMember` removal (`contracts/test/audit/F1_BountyFarming.t.sol`). The bounty is therefore paid only
for a proposal that met quorum. A proposal below quorum can never pass, so revealing it changes no outcome, and its
reveals still count in the tally. `sealedCount` is final once sealing closes, so the condition is the same for every
batch of the reveal window. This narrows D6; see `docs/THREATS.md` §9 for what remains.

The bounty is evaluated once per `revealBatch` call (not per item) against the whole bounty for that call, so a call
either pays in full or not at all. The division form means no `revealBounty` value, however large, can overflow and
block reveals. All value leaving the contract goes through `claimable[account] += ...` first; `claim()` is the only
function that moves USDC out, and it is a plain pull (`msg.sender` only, no `claimFor`). A blocklisted target,
revealer or claimer therefore never blocks anyone else's `execute`, `revealBatch` or `claim` — only their own `claim()`
reverts, and their balance stays in `claimable` for later.

### 6.6 Immutability (D14)

No `owner`, no `Ownable`, no proxy, no `pause()`, no `receive`/`fallback`. `usdc`, `quorumBps` and `revealBounty` are
`immutable`; there is no `SetParams` proposal type (out of scope, PRD §2.2) and no code path writes them after deploy.
Membership changes only through executed `SetMember` proposals.

### 6.7 Events

| Event | Fields | Emitted by |
|---|---|---|
| `ProposalCreated` | `id` (indexed), `proposer` (indexed), `kind, target, amount, flag, closeRound, revealEndRound, memberSnapshot, description, descriptionURI` | `propose` |
| `Sealed` | `groupId` (indexed), `sealer` (indexed), `commitment, ciphertext` | `Sealed._seal`, called from `vote` — the ciphertext exists only here, never in storage (D10) |
| `VoteRevealed` | `id` (indexed), `voter` (indexed), `choice` | `revealBatch`, per revealed item, right after the module's `Revealed` |
| `RevealSkipped` | `id` (indexed), `voter` (indexed) | `revealBatch`, per item that does not match a live commitment |
| `BountyCredited` | `id` (indexed), `revealer` (indexed), `amount` | `revealBatch`, once per call, after every item, when the proposal met quorum and the free treasury covers the call's bounty |
| `BountySkipped` | `id` (indexed) | `revealBatch`, once per call, when the proposal met quorum and the free treasury does not cover it (below quorum no bounty event is emitted) |
| `Finalized` | `id` (indexed), `passed, forCount, againstCount, abstainCount, sealedCount, revealedCount` | `finalize` |
| `Executed` | `id` (indexed) | `execute`, last (after `MemberSet` for SetMember) |
| `MemberSet` | `account` (indexed), `isMember` | constructor (once per initial member) and `execute` (SetMember), so the member list can be rebuilt from events alone |
| `Claimed` | `account` (indexed), `amount` | `claim` |
| *(from `Sealed`)* `SealGroupOpened`, `Revealed` | see §5 | `propose` (via `_openGroup`, before `ProposalCreated`), `revealBatch` (via `_consumeReveal`) |

### 6.8 Errors

| Error | Raised by | Meaning |
|---|---|---|
| `BadUSDC` | constructor | `usdc_` is the zero address |
| `BadQuorum` | constructor | `quorumBps_` is 0 or above 10_000 |
| `NoMembers` | constructor | empty initial member list |
| `BadMember` | constructor | an initial member is the zero address |
| `DuplicateMember` | constructor | an initial member is listed twice |
| `NotMember` | `propose`, `vote` | caller is not a current member |
| `BadTarget` | `propose` | `target` is `address(0)`, the DAO itself or the USDC token (both kinds) |
| `BadAmount` | `propose` | `TransferUSDC` with `amount == 0` |
| `DescriptionTooLong` | `propose` | `description` longer than 256 bytes |
| `DescriptionURITooLong` | `propose` | `descriptionURI` longer than 2,048 bytes |
| `BadDuration` | `propose` (via `_openGroup`) | `votingSeconds` outside `[600, 604_800]` |
| `SealingClosed`, `AlreadySealed`, `BadCommitment`, `BadCiphertextLength` | `vote` (via `_seal`) | see §5 |
| `LengthMismatch` | `revealBatch` | `voters` / `choices` / `salts` lengths differ |
| `TooManyItems` | `revealBatch` | more than 256 items in one call |
| `RevealNotOpen`, `RevealClosed` | `revealBatch` (via `_requireRevealOpen`) | before the close (or unknown id) / after the reveal window |
| `AlreadyFinalized` | `finalize` | called a second time |
| `NotReady` | `finalize`, `execute` | `finalize`: before `roundTime(revealEndRound)` or unknown id. `execute`: not finalized (or unknown id) |
| `NotPassed` | `execute` | finalized, did not pass |
| `AlreadyExecuted` | `execute` | called a second time |
| `Expired` | `execute` | after `executionDeadline(revealEndRound)` |
| `InsufficientTreasury` | `execute` (TransferUSDC) | `balance - totalClaimable < amount` |
| `NoOp` | `execute` (SetMember) | the target's membership already equals `flag` |
| `LastMember` | `execute` (SetMember) | the removal would leave the DAO with no member |
| `NothingToClaim` | `claim` | `claimable[msg.sender] == 0` |
| `TransferFailed` | `claim` | `transfer` returned `false`, returned short data, or reverted with empty data. A token revert with data (the USDC blocklist) is bubbled instead |
| `Reentrancy` | `revealBatch`, `execute`, `claim` | nested call while any of them is running |
| `UnknownProposal` | `status` | id never created |
| `NothingSealed`, `BadReveal`, `GroupAlreadyOpen`, `RoundOverflow` | `Sealed` internals | in the ABI; not reachable through `SealedDAO`'s external functions in normal use (see §5) |

Web and SDK error mapping must also handle the bubbled string `"Blacklistable: account is blacklisted"` from `claim`
(decoded by the SDK as `ContractRevertError` with `errorName: 'Error'`).

## 7. Invariants

Each is enforced by the code and exercised by `contracts/test/invariant/SealedDAO.invariant.t.sol` (256 runs × 64
calls, guided handler `SealedDAOHandler.sol`, `fail-on-revert = true`):

- **I1** `usdc.balanceOf(address(this)) >= totalClaimable` — the contract never promises USDC it does not hold
  (PRD §4.3). Every credit checks the free treasury first; only `claim` lowers the balance, by what it removes from
  `totalClaimable`.
- **I2** `totalClaimable == Σ claimable[account]`, and USDC leaves only through `claim`; a failed claim changes no state.
- **I3** `forCount + againstCount + abstainCount == revealedCount <= sealedCount`.
- **I4** `sealedCount <= memberSnapshot + (members added while the proposal was sealing)`. PRD §8.1 states
  `sealedCount <= memberSnapshot`, but PRD §4.3 breaks that on purpose: a member added by another proposal's execution
  during this proposal's voting phase may seal (§6.3), so `sealedCount` can exceed the frozen `memberSnapshot`. The
  literal PRD §8.1 form fails on a 2-call sequence; the invariant tested carries the members added during sealing as a
  ghost counter, and the campaign reaches `sealedCount > memberSnapshot` in most runs.
- **I5** A proposal that reaches `Executed` or `Expired` never leaves it (PRD §8.1).
- **I6** `memberCount` equals the number of accounts with `isMember == true`.
- A commitment is either absent (`bytes32(0)`), live (any other value written by `_seal`), or consumed (`REVEALED`);
  once `REVEALED`, no function restores it (§5; `SealedTest.test_consumeReveal_doubleConsumeReverts`,
  `test_verifyReveal_falseForSentinel`).

## 8. SDK surface (`@arcseal/sdk`, PRD §5)

ESM, Node ≥ 22 and browser, depends on `@arcseal/tlock`, `viem` (peer), `zod` and `pino`. Every public input is
validated with Zod (`schemas.ts`) before any hashing, encryption or network call; a bad input throws
`InvalidInputError` with one message per issue, never a partial side effect.

```ts
// round math (round.ts): mirrors Sealed.sol, tested against the same 20 vectors
roundAt(unixSeconds): bigint; roundAfter(unixSeconds): bigint; roundTime(round): number
closeRoundFor(now, votingSeconds): bigint; revealEndRoundFor(closeRound): bigint
votingOpen(closeRound, now): boolean; revealOpen(closeRound, now): boolean; pastRevealEnd(closeRound, now): boolean
executionDeadline(revealEndRound): number

// sealing (seal.ts): Choice = 'abstain' | 'for' | 'against', index 0/1/2
generateSalt(): Hex                                                     // crypto.getRandomValues, 32 bytes
hashVote({ proposalId, voter, choice, salt }): Hex                      // == SealedDAO.hashVote
encodeVotePlaintext(choice, salt): Hex; decodeVotePlaintext(bytes): { choice, salt } | null
sealVote({ proposalId, voter, choice, closeRound, salt? }): Promise<{ commitment, ciphertext, salt, plaintext }>
unsealVote({ ciphertext, closeRound, beacon? }, drandOptions?): Promise<{ choice, salt } | null>
  // null: round mismatch, bad decrypt, bad decode, wrong beacon. A drand outage throws DrandFetchError instead.

// reveal (reveal.ts)
unsealProposal({ client, dao, proposalId, fromBlock?, toBlock?, beaconSource?, logger?, windowSize?, onWindow? })
  : Promise<{ items, skipped, skipReasons, closeRound, correlationId }>
  // skip reasons: 'undecryptable' | 'commitment-mismatch' | 'already-revealed'. Pass fromBlock = the DAO deploy block.
buildRevealBatch(items, { size? }): { voters, choices, salts }[]      // chunks of <= 256, refuses a voter twice

// drand (drand.ts)
getBeacon(round, opts?): Promise<{ round, signature }>   // api.drand.sh -> api2.drand.sh -> drand.cloudflare.com
waitForRound(round, { signal }): Promise<Beacon>

// receipts (receipt.ts): local persistence is the app's job; the SDK only (de)serializes and validates
parseVoteReceipt(json): VoteReceipt; serializeVoteReceipt(receipt): string

// viem actions (actions.ts), client first. Reads: readProposal, readStatus, readCommitmentOf, readHashVote,
// readIsMember, readMemberCount, readClaimable, readTotalClaimable, readProposalCount, readUsdc, readQuorumBps,
// readRevealBounty, readSealingOpen, readRevealOpen. Writes (simulated before sending; a local account sends the
// node's estimate plus GAS_MARGIN_PERCENT = 20, withGasMargin): propose, vote, revealBatch, finalize, execute, claim.
// Helpers: getProposal, getStatus, listProposals (nextFromBlock cursor), getSealedLogs, sealAndVote (onSealed
// callback before sending; a caller-supplied closeRound must equal the proposal's), waitForSuccess,
// toContractRevertError.
// ABI: generated into src/abi/SealedDAO.ts from Foundry output; `pnpm sdk:check-abi` fails on drift
// logging: pino child logger, one correlation id per unsealProposal call (logger.ts)
```

`unsealVote` reads the round inside the ciphertext (`@arcseal/tlock`'s `roundOf`) and requires it to equal
`closeRound` **before** fetching or using any beacon: a hostile ciphertext can name any round, so it must never choose
which beacon gets fetched. `unsealProposal` gets the close-round beacon once, BLS-verifies it against the pinned
quicknet key (`InvalidBeaconError` otherwise), decrypts every vote, and keeps a vote only if its `hashVote` equals the
live `commitmentOf`, so `revealBatch` never pays for items it would skip. No beacon is fetched when nobody sealed.

## 9. drand and `eth_getLogs` operational notes

- **quicknet is unchained** (PRD §9): round `r`'s signature depends only on `r`, not on round `r-1`'s signature. A
  round can be fetched and verified independently of drand's history, so an outage only delays a reveal if drand
  returns within the fixed 24 h reveal window; if it stays down longer, every vote nobody revealed counts toward quorum
  only. A voter's local receipt lets their vote be revealed without drand at all (they already know their own
  `choice`/`salt`; anyone can then submit it with `revealBatch`).
- `getBeacon` calls the v1 path `/<chainHash>/public/<round>` on `api.drand.sh`, then `api2.drand.sh`, then
  `drand.cloudflare.com`, with a 5 s timeout each. A response is accepted only if it passes Zod validation, is for the
  requested round and BLS-verifies against the pinned quicknet public key; otherwise the next relay is tried. If none
  succeeds it throws `DrandFetchError` listing every attempt (`early: true` when the round is still in the future).
- Arc's public RPC caps `eth_getLogs` at 10,000 blocks per call (PRD §9). `unsealProposal`, `getSealedLogs` and
  `listProposals` read logs in **≤ 9,999-block windows** with a cursor (`logs.ts`, `LOG_WINDOW_BLOCKS = 9_999n`). At
  Arc's ~0.5 s block time one window is about 83 minutes of history; scanning from block 0 would take thousands of
  calls, so callers pass the DAO deploy block as `fromBlock`.
- Beacon signatures for every round used in tests are committed (`packages/tlock/test/vectors/beacons.json`, next to
  `chain-info.json`, `tle-to-lib.json` and `lib-to-tle.json`), so CI never calls drand.
