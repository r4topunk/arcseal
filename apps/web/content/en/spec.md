# Spec summary

> This is a readable summary. The normative document is
> [`docs/SPEC.md`](https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md) on GitHub, which the contracts must
> match exactly — read it for exact preconditions, effects, reverts and the full error and event tables.

## The primitive: `Sealed`

An abstract contract, never deployed on its own. It knows only about "groups": a group has a close round and a
24-hour reveal window, and each address may seal exactly one `bytes32` hash commitment per group before the close.
It never looks inside a ciphertext and never checks a drand signature — it only compares hashes once something is
decrypted offchain and revealed. Time is measured in drand quicknet rounds:

```
roundTime(r) = QUICKNET_GENESIS + (r - 1) × QUICKNET_PERIOD    (genesis 2023-08-23T15:09:27Z, 3 s period)
```

## The app: `SealedDAO`

A member-list DAO (1 address = 1 vote) with a USDC treasury and two kinds of proposal: **transfer USDC** to an
address, or **add/remove a member**. Every proposal opens its own sealing group. The full lifecycle:

```
propose            close round                reveal window ends              execution deadline
   |     sealing        |      revealing              |     ready/passed/failed        |
   |  (10 min – 7 d)     |    (fixed 24 h)             |         (7 d grace)            |
   v                     v                             v                                v
 vote()              revealBatch()                finalize()                       execute()
```

- **Sealing.** A member calls `vote(id, commitment, ciphertext)` once per proposal. The commitment is
  `keccak256(abi.encode(proposalId, voter, choice, salt))` — a 32-byte CSPRNG salt makes it unguessable, and binding
  `proposalId` and `voter` stops any replay across proposals or voters. The ciphertext (raw tlock output, 423 bytes
  for a vote) goes into calldata and an event only, never into contract storage.
- **Revealing.** After the close round, anyone decrypts every ciphertext offchain and calls
  `revealBatch(id, voters, choices, salts)`. Each item is accepted only if its hash matches the live commitment;
  anything else is skipped, never reverted. The treasury pays the caller a small fixed amount per validly revealed
  vote, set at deploy to cover the call's gas, whenever the proposal met quorum and the treasury can cover it. Below
  quorum a proposal cannot pass, so its reveals pay nothing: a lone member cannot drain the treasury with throwaway
  proposals.
- **Quorum and outcome.** Quorum is measured over **sealed** votes against the member count frozen when the
  proposal was created. Whether it passes is measured over **revealed** votes only: `forCount > againstCount`, a
  tie fails. A vote that is sealed but never revealed counts toward quorum and nothing else.
- **Finalize, execute, claim.** `finalize()` (anyone, after the 24 h reveal window) fixes pass/fail. `execute()`
  (anyone, within 7 days of the reveal window ending) applies a passed proposal. Every payout — an executed
  transfer or a reveal payment — only credits an internal balance; **`claim()` is the only function that moves
  USDC**, and it always pays the caller themselves. This means a blocked or unresponsive recipient can never stop
  anyone else's transfer, reveal or claim.

## Timing

The reveal window is a **fixed 24 hours** from the close round, whatever the voting duration was — even a
10-minute proposal cannot be finalized before its reveal window closes. So the fastest any proposal can go from
close to finalize is exactly 24 hours; what can be fast is close-to-**reveal** (the close round's drand beacon
is published at the close itself, and a single `revealBatch` can follow right away). A passed proposal then has
7 more days to be executed before it expires unexecuted.

## Immutability

No owner, no upgrade, no pause, no admin function of any kind. The treasury token, quorum and reveal payment amount
are fixed forever at deployment. Membership changes only through a passed, executed proposal — nothing else can
add or remove a member, and the last member can never be removed. A proposal can never pay or add the DAO itself or
the USDC token, which could never claim or vote.

## Guarantees this design does **not** provide

- **Anonymity.** Voting is a transaction from your own address; sealing hides the choice, not the voter.
- **Coercion resistance.** A voter can always prove their own vote to a third party by handing over their receipt.
- **Protection against a majority of members colluding.** Members holding quorum and a majority of the revealed
  votes can pass and execute any proposal, including one that pays the whole treasury to themselves.

None of these are bugs to be fixed later — they are the accepted trust model of a small, member-voted treasury.
See the [full threat model](https://github.com/r4topunk/arcseal/blob/main/docs/THREATS.md) for every threat
considered and how each is handled.

## Where the numbers come from

Timelock encryption uses [drand](https://drand.love) quicknet as the clock and a vendored, quicknet-only build of
[tlock](https://github.com/drand/tlock) as the cipher — no onchain BLS verification, no relayer, no singleton
contract. Every constant, every function's exact preconditions and effects, every event and error, and the full
gas measurements live in:

- [`docs/SPEC.md`](https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md) — the normative technical spec
- [`docs/THREATS.md`](https://github.com/r4topunk/arcseal/blob/main/docs/THREATS.md) — the full threat model
- [`docs/GAS.md`](https://github.com/r4topunk/arcseal/blob/main/docs/GAS.md) — measured gas and USDC cost per call
