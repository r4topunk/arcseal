# Integration guide

> ArcSeal is **experimental and unaudited**. Read the [privacy statement](/docs/faq/#what-is-hidden-and-until-when)
> and the [full spec](/docs/spec/) before relying on it for anything real.

ArcSeal has two integration surfaces: an abstract Solidity module, `Sealed.sol`, that any contract can inherit to
get timelock-sealed commitments; and a TypeScript SDK, `@arcseal/sdk`, that seals votes, decrypts them once the
round is public, and calls the reference app, `SealedDAO`. Both are built on
[drand quicknet](https://drand.love) as the clock and [tlock](https://github.com/drand/tlock) as the cipher — no
relayer, no oracle, no onchain BLS check (D7, D9, D12).

| Item | Value |
|---|---|
| Network | Arc mainnet, chain id `5042`, RPC `https://rpc.mainnet.arc.io` |
| `SealedDAO` (this repo's reference app) | `deployments/arc-mainnet.json` (also shown in the [app](/app/)) |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Beacon | drand quicknet, BLS12-381 G1, unchained, 3 s period |

## 1. Inherit `Sealed.sol`

`Sealed` only does three things: it opens a "group" with a close round and a 24 h reveal window, it stores one
`bytes32` commitment per `(group, sealer)`, and it lets a caller check a reveal by hash. It never inspects a
ciphertext, never touches BLS, and is never deployed on its own (D7) — your contract decides what a group means and
what "revealed" should do.

```sh
forge install r4topunk/arcseal
```

```text
# remappings.txt
arcseal/=lib/arcseal/contracts/src/
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "arcseal/Sealed.sol";

/// @notice A sealed-bid pattern built on the same primitive SealedDAO uses for votes.
contract SealedBid is Sealed {
    uint256 public auctionCount;
    mapping(uint256 auctionId => mapping(address bidder => bool)) public hasBid;

    /// @dev Ids come from a counter, like SealedDAO.propose: never let the caller pick one (see the note below).
    function openAuction(uint32 biddingSeconds) external returns (uint256 auctionId, uint64 closeRound) {
        auctionId = ++auctionCount;
        closeRound = _openGroup(auctionId, biddingSeconds); // the group id is yours to define; SealedDAO uses proposalId
    }

    function bid(uint256 auctionId, bytes32 commitment, bytes calldata ciphertext) external {
        _seal(auctionId, msg.sender, commitment, ciphertext); // reverts SealingClosed / AlreadySealed / BadCommitment / BadCiphertextLength
        hasBid[auctionId][msg.sender] = true;
    }

    /// @dev Anyone can call this once they have decrypted a bid offchain, exactly like SealedDAO.revealBatch.
    function revealBid(uint256 auctionId, address bidder, uint256 amount, bytes32 salt) external returns (bool ok) {
        bytes32 expected = keccak256(abi.encode(auctionId, bidder, amount, salt)); // your own hash, domain-separated
        ok = _verifyReveal(auctionId, bidder, expected); // pure comparison, never reverts on mismatch
        if (ok) _consumeReveal(auctionId, bidder); // marks it REVEALED, emits Revealed
    }
}
```

This is illustrative, not a deployed contract. `contracts/src/SealedDAO.sol` in this repo is the complete reference
implementation of the same pattern, with a full test suite, and is the one deployment ArcSeal ships (D1).

Group ids come from a counter on purpose. With an id chosen by the caller, anyone could open the id you meant to use
first, with their own duration, and `GroupAlreadyOpen` would then block your real opening. If ids must be
predictable, bind them to the opener instead, for example `uint256(keccak256(abi.encode(msg.sender, nonce)))`.

### Rules for your own `Sealed`-based contract

1. **Choose your own commitment formula and hash it yourself.** `Sealed` never computes a hash; domain-separate it
   on whatever varies across your groups and sealers (`SealedDAO.hashVote` binds `proposalId` and `voter`, D11).
2. **The ciphertext is calldata plus an event, never storage** (D10). Read it back from the `Sealed` event, not from
   a getter — there isn't one.
3. **`_verifyReveal` never reverts on a mismatch.** Build your reveal function (or batch) to skip a `false` result,
   the way `SealedDAO.revealBatch` does, so one bad item never blocks the rest.
4. **Call `_requireRevealOpen` once per batch, not per item**, if you accept several reveals in one transaction —
   that is what makes an out-of-window batch fail fast instead of silently skipping everything.
5. **Ciphertext length is bounded but not otherwise checked**: `[359, 1024]` bytes fits any tlock-encrypted payload
   up to a few hundred bytes of plaintext. Garbage inside that range is your problem to detect at reveal time, by
   hash, never onchain.

## 2. Use `@arcseal/sdk` against `SealedDAO`

```sh
pnpm add @arcseal/sdk viem
```

The SDK never invents contract behaviour: every exported action is a thin, typed wrapper over one `SealedDAO`
function or view, generated and checked against the Foundry ABI (`pnpm sdk:check-abi`).

### Seal a vote

```ts
import { sealAndVote, serializeVoteReceipt } from '@arcseal/sdk';
import { createWalletClient, custom } from 'viem';
import { arc } from 'viem/chains';

const wallet = createWalletClient({ account, chain: arc, transport: custom(window.ethereum) });

const ballot = await sealAndVote(wallet, {
  dao,
  proposalId: 1n,
  choice: 'for', // 'abstain' | 'for' | 'against'
  // Runs after sealing, before the transaction exists: this is where the app persists the local receipt.
  onSealed: (b) =>
    localStorage.setItem(
      `arcseal:${arc.id}:${dao}:${b.proposalId}:${b.voter}`,
      serializeVoteReceipt({ version: 1, chainId: arc.id, dao, ...b, createdAt: new Date().toISOString() }),
    ),
});
```

`sealAndVote` reads the proposal's `closeRound`, draws a 32-byte CSPRNG salt, encrypts the choice to that round with
`@arcseal/tlock`, and sends `vote(id, commitment, ciphertext)`. Nothing about the choice leaves the browser in the
clear.

### Unseal a single vote

```ts
import { unsealVote } from '@arcseal/sdk';

// Only works from roundTime(closeRound) on. Without `beacon`, one is fetched from drand.
const vote = await unsealVote({ ciphertext, closeRound });
// { choice: 'for', salt: '0x…' }, or null for garbage, a truncated payload, another round, or a wrong beacon
```

### Reveal every vote of a proposal

```ts
import { buildRevealBatch, revealBatch, unsealProposal, waitForSuccess } from '@arcseal/sdk';
import { createPublicClient, http } from 'viem';

const client = createPublicClient({ chain: arc, transport: http() });

const { items, skipped, skipReasons } = await unsealProposal({
  client,
  dao,
  proposalId: 1n,
  fromBlock: DAO_DEPLOY_BLOCK, // reads Sealed logs in 9,999-block windows (Arc caps eth_getLogs at 10,000)
});
// items: votes whose hash matches the live onchain commitment. skipped: garbage, mismatched, already revealed.

for (const batch of buildRevealBatch(items)) {
  // at most 256 items per transaction
  await waitForSuccess(client, await revealBatch(wallet, { dao, proposalId: 1n, ...batch }), 'revealBatch');
}
```

This is exactly what the site's "Reveal votes" button does (D9): decrypt everything in the visitor's own browser,
then send one transaction per 256 votes. There is no relayer and nothing requires the site — any script with the
SDK can reveal a proposal. For a proposal that met quorum, whoever's transaction reveals the votes is credited the
same small fixed payment per revealed vote that the treasury pays to cover the caller's own gas; below quorum a
proposal cannot pass, and its reveals are not paid.

To reveal only your own vote from a downloaded receipt: `buildRevealBatch([receipt])` then `revealBatch(...)`.

### Read proposals and status

```ts
import { getProposal, getStatus, listProposals } from '@arcseal/sdk';

const { proposals, nextFromBlock } = await listProposals(client, { dao, fromBlock: DAO_DEPLOY_BLOCK });
const status = await getStatus(client, { dao, proposalId: 1n }); // 'Voting' | 'Revealing' | 'Ready' | 'Passed' | 'Failed' | 'Executed' | 'Expired'
const proposal = await getProposal(client, { dao, proposalId: 1n });
```

## 3. Timing

Every window is measured in drand rounds, not blocks. `closeRoundFor`, `roundTime`, `votingOpen` and `revealOpen`
mirror `Sealed.sol`'s round math exactly (tested against the same 20 shared vectors as the contract):

```ts
import { closeRoundFor, roundTime, votingOpen } from '@arcseal/sdk';

const now = Math.floor(Date.now() / 1000);
const closeRound = closeRoundFor(now, 600); // what propose(..., 600) stores onchain
const closesAt = roundTime(closeRound);     // unix seconds, show next to the round number
votingOpen(closeRound, now);                // true until closesAt
```

The reveal window is a fixed 24 h from the close round regardless of how long voting ran, so the earliest any
proposal can be finalized is 24 h after it closes. See [the spec](/docs/spec/#timing) for the full timeline.

## 4. Errors

Writes are simulated before they are sent, so most reverts throw `ContractRevertError` before anything is sent. A
transaction can still revert onchain if the state changes between the simulation and inclusion (for example the
voting window closing); `waitForSuccess` then throws `TransactionRevertedError`. Transactions signed by a local
account (a key or keystore in the same process) get a 20% gas margin over the node's estimate:

```ts
import { ContractRevertError } from '@arcseal/sdk';

try {
  await revealBatch(wallet, { dao, proposalId, voters, choices, salts });
} catch (err) {
  if (err instanceof ContractRevertError) {
    // err.errorName: 'NotMember' | 'SealingClosed' | 'RevealNotOpen' | 'NotPassed' | 'AlreadyExecuted' | ... | 'Error' | 'Panic' | 'Unknown'
    // 'Error' carries the token's own revert string, e.g. USDC's "Blacklistable: account is blacklisted"
  }
}
```

Other SDK errors (`DrandFetchError`, `InvalidBeaconError`, `InvalidInputError`, `WalletRequiredError`,
`ProposalNotFoundError`) all extend `ArcSealError` and are switched on `.code`, never on the message. The full list
is in the [SDK README](https://github.com/r4topunk/arcseal/blob/main/packages/sdk/README.md#errors).

## 5. Further reading

- [FAQ](/docs/faq/) — what stays hidden, what happens if nobody reveals or drand is down, and why there is no token.
- [Spec summary](/docs/spec/) — the full technical spec is
  [`docs/SPEC.md`](https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md) on GitHub.
- [`packages/sdk/README.md`](https://github.com/r4topunk/arcseal/blob/main/packages/sdk/README.md) — the complete
  SDK API reference.
