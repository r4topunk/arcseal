# FAQ

## What is hidden, and until when?

Only the **choice** — For, Against or Abstain — is hidden, and only **during voting**. Sealing a vote is a normal
transaction from your own wallet: the fact that you voted, when, and your address are all public the moment it
lands. What nobody can read, not even the contract, is which choice you sealed, until drand publishes the vote's
close round.

Once that round is public, anyone can decrypt every sealed vote and submit it onchain. From that moment, **each
vote is public per address, permanently** — this is not anonymity, and it never was. See what the design does not
provide in the [spec summary](/docs/spec/#guarantees-this-design-does-not-provide).

## What if nobody reveals a vote?

An unrevealed vote still counts toward quorum (it was sealed), but toward nothing else — not for, not against, not
abstain. If literally nobody reveals a proposal, it finalizes with zero votes on both sides, and a tie fails: the
proposal simply fails.

In practice this is unlikely to matter: revealing is permissionless, decrypting and submitting every vote is one
click on the site ("Reveal votes") or one SDK call, and, for a proposal that met quorum, whoever's transaction
reveals the votes is credited a small fixed payment per revealed vote, which covers the gas of that call when the
treasury can pay it. Anyone who wants to see the outcome can reveal everyone in a single transaction.

## What if drand is down when a vote's round closes?

drand quicknet is **unchained**: a round's signature does not depend on any earlier round, so it can be fetched and
verified whenever the network comes back. An outage only delays the reveal if drand returns within the fixed
24-hour reveal window. If it stays down longer, every vote nobody revealed counts toward quorum and nothing else.
The SDK also tries three independent relays in order before giving up.

Separately, the app stores your own vote's `{choice, salt}` in your browser the moment you seal it (and offers it
as a downloadable file). You already know your own vote's contents, so you — or anyone you hand the file to — can
reveal it without drand at all.

## What happens if a member joins or leaves while a vote is open?

Membership is checked **live**, at the moment you seal a vote — not against a snapshot taken when the proposal was
created. Two consequences, both deliberate:

- A member **removed** after a proposal opens can no longer seal a new vote on it, but a vote they already sealed
  before removal is never erased: it still counts everywhere it would have.
- A member **added** while a proposal is still open may seal a vote on it too, even though they were not a member
  yet when it was created.

The quorum threshold itself is always measured against the member count frozen at the moment the proposal was
created, so this never changes what "enough votes" means for a given proposal.

## What does it cost?

Everything is paid in USDC, the same asset the treasury holds — there is no separate gas token. Measured figures
are in [`docs/GAS.md`](https://github.com/r4topunk/arcseal/blob/main/docs/GAS.md); roughly:

| Action | Cost |
|---|---:|
| Seal a vote | ≈ 0.0014 USDC |
| Reveal a vote | ≈ 0.0003 – 0.002 USDC, depending on batch size (0.002 alone, 0.001 in a batch of 3) |
| Finalize | ≈ 0.0007 USDC |
| Execute a passed proposal | ≈ 0.0014 USDC |
| Claim a payout | ≈ 0.001 USDC |

## Why is there a payment for revealing votes?

Revealing is work someone has to do onchain after voting closes: decrypt every ciphertext and submit a transaction.
The treasury pays a small, fixed amount per validly revealed vote to whoever's `revealBatch` call reveals it, set at
deploy to cover that call's gas at any batch size. It is paid only for a proposal that met quorum: below quorum a
proposal cannot pass, so revealing it changes no outcome, and paying for it would let a single member empty the
treasury with throwaway proposals. If the treasury cannot cover it for a given call, the reveal still succeeds and
the payment is simply skipped for that call. It is not compensation tied to how the vote turns out: it exists purely
so nobody has to reveal votes at a loss.

## Why is there no token?

There is no token, no sale, no yield, no prize and no chance anywhere in ArcSeal. It is a voting and treasury
primitive: member wallets seal votes, a passed proposal moves USDC or changes membership, and the only other
movement of funds is the small fixed payment per revealed vote, credited from the treasury. This is a deliberate
design constraint, not an oversight: it keeps ArcSeal squarely a governance tool, with none of the legal and trust
questions that a token, a prize, a game of chance or holding other people's savings would raise.

## Is ArcSeal audited? Can I trust it with real funds?

ArcSeal has not been audited, and it has no track record of live usage to point to. Treat it as experimental and
keep amounts small, the same way you would with any new, unaudited contract.

## Can I reveal only my own vote?

Yes. Use the receipt the app saved (or that you downloaded) when you sealed your vote:
`buildRevealBatch([yourReceipt])`, then `revealBatch(...)` with the result. It reveals just that one vote, and the
same small fixed payment per revealed vote applies if the proposal met quorum and the treasury can cover it.

## What happens to a proposal that never reaches quorum?

It finalizes as **failed**. Quorum is measured over sealed votes against the member count at the time the proposal
was created; if too few members sealed a vote, the proposal cannot pass no matter how the revealed votes split.
Its votes can still be revealed, but the treasury credits no reveal payment for them. Nothing moves and nothing
else happens — the treasury and membership stay exactly as they were.

## Does this website track me?

No analytics, trackers or cookies. The app talks only to the Arc RPC, the drand HTTP API and your wallet, and
serves its own fonts. The project page loads its font from Google Fonts.
