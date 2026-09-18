# ArcSeal threat model

> Every row of PRD §7, in the same order, then threats found during the build that §7 does not list, then what
> ArcSeal explicitly does **not** provide. "Test" names real test files and functions: Foundry tests as
> `Contract.function` in `contracts/test/...`, Vitest tests by file and test title.

## 1. Garbage or malformed ciphertext

| | |
|---|---|
| **Threat** | A sealer posts a ciphertext that is not valid tlock output, or that decrypts to something other than a clean 64-byte `abi.encode(uint8, bytes32)` plaintext. |
| **Handling** | Never parsed onchain: `Sealed._seal` only checks the length is in `[359, 1024]` bytes (`SPEC.md` §4). At reveal time the commitment is recomputed from the *claimed* `(voter, choice, salt)`, not from the ciphertext, and `revealBatch` skips a mismatch (`RevealSkipped`), never reverts. `@arcseal/sdk`'s `unsealVote` returns `null` (not a throw) for anything that fails to decrypt or to decode, and `unsealProposal` lists such a voter under `skipped` with reason `undecryptable`. |
| **Residual risk** | The poster's own vote is lost: it counts toward quorum via `sealedCount` and toward nothing else (in effect an abstention). Nobody else is affected. |
| **Enforced in** | `Sealed._seal` (length bound), `SealedDAO.revealBatch` / `_revealOne` (skip on mismatch), SDK `unsealVote`, `unsealProposal` |
| **Test** | `contracts/test/unit/Sealed.t.sol`: `SealedTest.test_seal_ciphertextLengthBounds`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_vote_ciphertextLengthBounds`, `test_outcome_unrevealedVotesCountTowardQuorumOnly`; `contracts/test/fuzz/Sealed.fuzz.t.sol`: `SealedFuzzTest.testFuzz_seal_ciphertextLength`; `contracts/test/fuzz/SealedDAO.fuzz.t.sol`: `SealedDAOFuzzTest.testFuzz_voteCiphertextLength`, `testFuzz_revealBatchSkipsGarbageWithoutReverting`; `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_mixedValidInvalidDuplicateUnknown`; `packages/sdk/test/seal.test.ts`: "truncated ciphertext -> null", "garbage and tampered ciphertexts -> null", "a plaintext that is not a vote -> null"; `packages/sdk/test/anvil.test.ts`: "unsealProposal: 4 votes decrypted, the garbage one skipped, logs found across >= 3 windows" |

## 2. Brute-force of the commitment

| | |
|---|---|
| **Threat** | An observer who sees `commitment = keccak256(abi.encode(id, voter, choice, salt))` onchain tries to recover `choice` by brute force before the reveal, defeating secrecy during voting. |
| **Handling** | `salt` is a full 32-byte value from a CSPRNG, so the search space is `3 × 2^256` (three choices, `bytes32` salt). `bytes32` is enforced by the type onchain; the SDK's `saltSchema` refuses any salt that is not exactly 32 bytes, `generateSalt` uses `crypto.getRandomValues`, and `sealVoteInputSchema` refuses an explicit all-zero salt (the first value an attacker would try). |
| **Residual risk** | Only a salt that is not random (a caller that bypasses the SDK and picks a guessable salt) is at risk. keccak256 preimage resistance is assumed. |
| **Enforced in** | Contract (`bytes32` salt in `hashVote`), SDK (`saltSchema`, `sealVoteInputSchema`, `generateSalt`) |
| **Test** | `packages/sdk/test/seal.test.ts`: "refuses salts that are not exactly 32 bytes", "returns 32 lowercase random bytes, different every call", "seal draws a fresh CSPRNG salt when none is given"; `packages/sdk/test/schemas.test.ts`: "salt and bytes32: exactly 32 bytes, lowercased", "input objects: hashVote, sealVote (optional non-zero salt), beacon, unsealVote"; `contracts/test/ffi/HashVote.ffi.t.sol`: `HashVoteFfiTest.test_ffi_contractMatchesCommittedVectors` (the exact preimage format, 10 vectors in `contracts/test/vectors/hashvote.json`) |

## 3. Early decryption

| | |
|---|---|
| **Threat** | Someone decrypts a sealed vote before the close round, recovering the vote while voting is still open. |
| **Handling** | Requires the close round's drand signature before drand publishes it, which means breaking quicknet's threshold BLS scheme (the League of Entropy) or BLS12-381 itself. Out of model: ArcSeal treats drand's threshold security as a trust assumption, the same one every tlock deployment makes. A signature of any *other* round, earlier or later, does not open the ciphertext. |
| **Residual risk** | Compromise of a threshold of League of Entropy nodes, or a break of BLS12-381, would defeat secrecy entirely. Neither is mitigated in this codebase. |
| **Enforced in** | Cryptographic assumption (tlock IBE on drand quicknet), not a code path |
| **Test** | `packages/tlock/test/tlock.test.ts`: "ROUND_MISMATCH for a beacon of another round", "WRONG_BEACON for another round signature presented as the right round"; `packages/sdk/test/seal.test.ts`: "wrong beacon -> null (signature of another round, or a beacon for another round)". These show that only the close round's real signature decrypts; they cannot prove the signature is unavailable early. |

## 4. drand outage

| | |
|---|---|
| **Threat** | drand's public relays are unreachable when a proposal's close round arrives, and nobody can fetch the beacon needed to decrypt votes. |
| **Handling** | quicknet is unchained (`SPEC.md` §9): round `R`'s signature does not depend on any earlier round, so it can be fetched and verified whenever the network returns. `getBeacon` tries three relays in order and `waitForRound` retries until one serves the round. The 24 h reveal window (`REVEAL_WINDOW = 28,800` rounds) gives slack. A voter's local receipt (`{proposalId, salt, choice}`, kept in `localStorage` and offered as a JSON download, PRD §6) lets *that* vote be revealed without drand at all. A drand outage makes the SDK throw `DrandFetchError`, never return `null`, so an outage is never mistaken for a bad vote. |
| **Residual risk** | If drand stays down for the whole 24 h window and voters have no receipts, every unrevealed vote counts toward quorum only. The proposal still finalizes, and fails (`forCount == againstCount == 0`). |
| **Enforced in** | Contract (fixed 24 h window, reveal by anyone with `(choice, salt)`), SDK (`getBeacon` relay fallback, `waitForRound`, `receipt.ts`), app (receipt persistence, Phase 3) |
| **Test** | `packages/sdk/test/drand.test.ts`: "tries api.drand.sh, api2.drand.sh, drand.cloudflare.com in that order", "throws DrandFetchError with every attempt when all relays fail", "flags a round that is not published yet as early", "sleeps until the round time, then retries until a relay serves the beacon"; `packages/sdk/test/seal.test.ts`: "a drand outage throws DrandFetchError instead of returning null"; `packages/sdk/test/receipt.test.ts`: "serializes to JSON with decimal strings and a fixed key order, and parses back", "rejects a receipt whose commitment does not match its fields"; `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_windowBoundaries`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_outcome_unrevealedVotesCountTowardQuorumOnly`; `apps/web/test/receipts.test.ts`: "reports stored: false and never throws when storage is disabled". |

## 5. Nobody reveals

| | |
|---|---|
| **Threat** | No one calls `revealBatch` before the reveal window closes, so no vote is counted. |
| **Handling** | Revealing is permissionless and does not depend on the voter: anyone who decrypted the ciphertexts (the site does it for every vote once the round is public) can reveal everyone in one call. The site's "Reveal votes" button and the per-vote bounty (D6) are the incentive; the bounty is paid for proposals that met quorum, the only ones whose outcome a reveal can change (§9). Quorum is measured over `sealedCount`, so seals are never lost even if reveals are, but `passed` still needs `forCount > againstCount` among revealed votes. |
| **Residual risk** | If nobody reveals, the proposal fails by default (`forCount == againstCount == 0`). This is an availability risk, not a fund-safety one: no money moves and no vote is misattributed. |
| **Enforced in** | Contract (`revealBatch` open to anyone, bounty), app ("Reveal votes" button) |
| **Test** | `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_anyoneMayRevealAndIsPaid`, `test_revealBatch_countsEmitsAndCreditsBounty`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_outcome_unrevealedVotesCountTowardQuorumOnly`, `test_finalize_emitsTally`; `contracts/test/invariant/SealedDAO.invariant.t.sol`: `SealedDAOInvariantTest.invariant_I3_tally` |

## 6. Reveal front-running

| | |
|---|---|
| **Threat** | Several parties race to reveal the same votes, hoping to gain an advantage or change the outcome. |
| **Handling** | Harmless by construction: the first inclusion consumes each commitment (`REVEALED` sentinel), and any later item for the same voter reads as already revealed and is skipped. The tally is identical whoever submits and in whatever order; only the bounty differs (it goes to the caller whose items actually revealed, D6). |
| **Residual risk** | A revealer with better transaction ordering captures more of the bounty. Accepted incentive design, not a correctness issue. |
| **Enforced in** | `Sealed._verifyReveal` / `_markRevealed` (sentinel), `SealedDAO._creditBounty` (credits `msg.sender` for the votes that call revealed) |
| **Test** | `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_skippedItemRevealsLaterAndRevealedItemIsSkipped`, `test_revealBatch_mixedValidInvalidDuplicateUnknown`, `test_revealBatch_anyoneMayRevealAndIsPaid`; `contracts/test/fuzz/SealedDAO.fuzz.t.sol`: `SealedDAOFuzzTest.testFuzz_tallyMatchesOracle` |

## 7. Replay across proposals or voters

| | |
|---|---|
| **Threat** | A commitment or a revealed `(choice, salt)` from one proposal or one voter is replayed to forge a vote in another proposal, or under another voter. |
| **Handling** | `commitment = keccak256(abi.encode(proposalId, voter, choice, salt))` binds both `proposalId` and `voter` (D11), and commitments are stored per `(groupId, sealer)`. `revealBatch` recomputes the hash with the caller-supplied `voters[i]`, so a decrypted vote cannot be credited to another address or another proposal: the hash would not match that slot. |
| **Residual risk** | None identified: every value that varies across proposals and voters is inside the hash. |
| **Enforced in** | `SealedDAO.hashVote` / `_hashVote`, `Sealed._seal` / `_verifyReveal` keyed by `(groupId, sealer)`, SDK `hashVote` (same formula) |
| **Test** | `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_replayAcrossProposalsAndVotersIsSkipped`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_hashVote_isAbiEncodeAndDomainSeparated`; `contracts/test/unit/Sealed.t.sol`: `SealedTest.test_seal_sameSealerAcrossGroups`, `test_consumeReveal_isolatedPerGroup`; `contracts/test/fuzz/Sealed.fuzz.t.sol`: `SealedFuzzTest.testFuzz_commitmentsIsolated`; `contracts/test/fuzz/SealedDAO.fuzz.t.sol`: `SealedDAOFuzzTest.testFuzz_hashVoteIsAbiEncode`; `contracts/test/ffi/HashVote.ffi.t.sol`: `HashVoteFfiTest.test_ffi_sdkMatchesContractOnVectors` (vectors include proposalId 0 and 2^256-1); `packages/sdk/test/seal.test.ts`: "domain-separates on proposalId, voter, choice and salt" |

## 8. Double reveal

| | |
|---|---|
| **Threat** | The same sealed vote is revealed and counted twice, inflating `revealedCount` or a choice bucket. |
| **Handling** | `_markRevealed` replaces the live commitment with `REVEALED = bytes32(uint256(1))` in the same call that emits `Revealed`. Any later attempt sees the sentinel: `_verifyReveal` returns `false` (the batch skips it) and `_consumeReveal` / `_reveal` revert (`NothingSealed` / `BadReveal`). `_seal` refuses `REVEALED` (and 0) as a commitment (`BadCommitment`), and a sealer who already revealed cannot seal again (`AlreadySealed`). |
| **Residual risk** | None: the sentinel cannot be stored by a sealer, and `hashVote` would need a keccak256 preimage of `1` to produce it. |
| **Enforced in** | `Sealed._markRevealed`, `Sealed._verifyReveal`, `Sealed._seal` |
| **Test** | `contracts/test/unit/Sealed.t.sol`: `SealedTest.test_consumeReveal_setsSentinelAndEmitsOriginalCommitment`, `test_consumeReveal_doubleConsumeReverts`, `test_verifyReveal_falseForSentinel`, `test_seal_revertsBadCommitment`; `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_mixedValidInvalidDuplicateUnknown` (duplicate in one batch), `test_revealBatch_skippedItemRevealsLaterAndRevealedItemIsSkipped` (second batch); `contracts/test/invariant/SealedDAO.invariant.t.sol`: `SealedDAOInvariantTest.invariant_I3_tally` |

## 9. Treasury drain

| | |
|---|---|
| **Threat** | Someone moves USDC out of the treasury without a passed proposal, or more than a passed proposal authorized. |
| **Handling** | Value leaves only through `claim()` of a `claimable` balance, and `claimable` is credited in exactly two places: `execute()` of a finalized, passed, unexecuted, unexpired `TransferUSDC` proposal (`amount` fixed at propose time), and the `revealBatch` bounty (`revealBounty` per revealed vote, immutable, D6), **paid only for a proposal that met quorum** (see A2: without that condition one member could empty the treasury alone). Both first check `max(balance - totalClaimable, 0)` (`InsufficientTreasury` / `BountySkipped`), so `balanceOf(this) >= totalClaimable` always holds and every claim is solvent. `claim` zeroes the balance before transferring. A proposal can never target the DAO itself or the USDC token (`BadTarget`), so no payout can be credited to an account that could never claim it. |
| **Residual risk** | (a) Members holding quorum and a majority of revealed votes can pass any `TransferUSDC`, the intended trust model ("Not provided" below). (b) A coalition that meets quorum on its own can still collect bounties from throwaway proposals, see A2. (c) A passed `TransferUSDC` is not reserved at finalize, so bounties of other proposals that met quorum can spend the same free USDC first, and `execute` then reverts `InsufficientTreasury` until someone funds the treasury (anyone can, during the 7-day grace), see A4. |
| **Enforced in** | `SealedDAO.execute`, `revealBatch` (quorum gate), `_creditBounty`, `_available`, `claim`, `totalClaimable`, `propose` (`BadTarget`) |
| **Test** | `contracts/test/invariant/SealedDAO.invariant.t.sol`: `SealedDAOInvariantTest.invariant_I1_solvent`, `invariant_I2_claimAccounting`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_execute_revertsInsufficientTreasury`, `test_execute_revertsNotReadyNotPassedAlreadyExecuted`, `test_execute_expiryBoundary`, `test_claim_twiceReverts`, `test_propose_revertsBadTarget`; `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_noBountyBelowQuorum`, `test_revealBatch_bountyFromExactQuorum`, `test_revealBatch_bountySkippedWhenTreasuryShort`, `test_revealBatch_bountyIsAllOrNothingAndIgnoresReservedFunds`, `test_revealBatch_hugeBountyCannotBlockReveals`; `contracts/test/fuzz/SealedDAO.fuzz.t.sol`: `SealedDAOFuzzTest.testFuzz_bountyCreditedIffQuorumMetAndTreasuryCovers`, `testFuzz_tallyMatchesOracle`; `contracts/test/audit/F1_BountyFarming.t.sol`: `AuditF1BountyFarmingTest.test_loneMemberCannotExtractTreasuryWithoutPassedProposal`; `contracts/test/audit/F6_SelfTargetLocksFunds.t.sol`: `AuditF6SelfTargetLocksFundsTest.test_payoutToDaoOrTokenIsRejected` |

## 10. Blocklisted recipient

| | |
|---|---|
| **Threat** | Circle blocklists an address the DAO owes USDC to (a `TransferUSDC` target, a revealer with a bounty), and a push-payment design would let that address stall execution for everyone. |
| **Handling** | All payouts are pull-based (D13): `execute()` and `revealBatch()` only write `claimable[account]`; the `usdc.transfer` happens only inside `claim()`, called by the recipient for themselves. A blocklisted claimer's `claim()` reverts with the token's own message (`"Blacklistable: account is blacklisted"`, bubbled unchanged, not `TransferFailed`); the whole call rolls back, so the balance stays claimable. It never blocks `execute`, `finalize`, `revealBatch` or anyone else's `claim`, and a blocklisted member can still vote. |
| **Residual risk** | The blocklisted account cannot withdraw while it stays blocklisted, and there is no rerouting (no admin path, D14). The reserved amount stays out of the free treasury meanwhile. |
| **Enforced in** | `SealedDAO.claim` / `_transferOut` (bubbles token reverts), pull-only design |
| **Test** | `contracts/test/unit/SealedDAO.blocklist.t.sol`: `SealedDAOBlocklistTest.test_blocklist_claimerRevertsKeepsBalanceThenClaimsAfterUnblock`, `test_blocklist_targetNeverBlocksExecuteOrOtherClaims`, `test_blocklist_revealerStillRevealsAndBountyWaits`, `test_blocklist_blockedMemberStillVotes`; `packages/sdk/test/anvil.test.ts`: "finalize after the reveal window, execute, then claim (blocklist revert decoded, balance kept)" |

## 11. Member removed while voting

| | |
|---|---|
| **Threat** | A member is removed by an executed `SetMember` proposal while another proposal is still sealing, and either keeps voting power or loses a vote already cast. |
| **Handling** | `vote()` checks `isMember[msg.sender]` live, at call time (`SPEC.md` §6.3). A removed member cannot seal after removal (`NotMember`). A commitment sealed before the removal is never re-checked, so it still counts toward `sealedCount` and, once revealed, toward the tally, as PRD §4.3 specifies. Symmetrically, a member added mid-vote may seal, so `sealedCount` can exceed `memberSnapshot` (`SPEC.md` §7, I4). |
| **Residual risk** | Documented, intended behaviour: membership gates sealing only. Removals cannot take `memberCount` to 0: `execute` reverts `LastMember` for a removal of the only member, which would otherwise leave nobody who can propose and lock the free treasury forever (no admin path, D14). The DAO itself and the USDC token cannot be added as members (`BadTarget`): they could never vote and would inflate the quorum denominator forever. |
| **Enforced in** | `SealedDAO.vote` (live `isMember`), no re-validation at reveal or finalize; `memberSnapshot` used only as the quorum denominator; `execute` (`LastMember`); `propose` (`BadTarget`) |
| **Test** | `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_membership_removedMemberCannotSealButSealedVoteCounts`, `test_membership_memberAddedMidVoteMayVote`, `test_membership_snapshotIsTakenAtPropose`, `test_execute_setMemberRevertsLastMember`; `contracts/test/audit/F7_LastMemberRemoval.t.sol`: `AuditF7LastMemberRemovalTest.test_removingTheLastMemberIsRejected`; `contracts/test/audit/F6_SelfTargetLocksFunds.t.sol`: `AuditF6SelfTargetLocksFundsTest.test_daoOrTokenAsMemberIsRejected`; `contracts/test/invariant/SealedDAO.invariant.t.sol`: `SealedDAOInvariantTest.invariant_I4_snapshotBound`, `invariant_I6_memberCount` (the handler interleaves SetMember executions with votes) |

## 12. Reentrancy

| | |
|---|---|
| **Threat** | A hostile or compromised token calls back into the DAO from inside `transfer` (during `claim`) to double-spend a `claimable` balance, or to credit something against a balance that is about to leave. |
| **Handling** | `claim()` follows checks-effects-interactions: it zeroes `claimable[msg.sender]` and lowers `totalClaimable` before calling `usdc.transfer`. That ordering alone is not enough: during the transfer, `totalClaimable` is already lower but `balanceOf(this)` is not yet, so the free treasury reads too high. What matters is which function is **re-entered**, not which one makes the call: `revealBatch` credits a bounty from `balanceOf - totalClaimable`, so a callback into it could credit USDC that is leaving and break `balanceOf(this) >= totalClaimable` (audit F3). `revealBatch`, `execute` and `claim` therefore share one `nonReentrant` lock (EIP-1153 transient storage, error `Reentrancy`); `propose`, `vote` and `finalize` read no balance and credit nothing. Arc's USDC has no transfer hooks, but the constructor accepts any token and `Sealed` is meant for reuse. |
| **Residual risk** | None identified for the functions that credit or move USDC. |
| **Enforced in** | `SealedDAO.nonReentrant` modifier on `revealBatch`, `execute` and `claim`, CEI ordering in `claim` |
| **Test** | `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_reentrancy_claimExecuteAndRevealBatchAreLocked` (a hostile token, `contracts/test/mocks/WeirdUSDC.sol`, re-enters `claim`, `execute` and `revealBatch` from inside `transfer`; each reverts `Reentrancy`, the lock is released afterwards); `contracts/test/audit/F3_RevealBatchReentrancy.t.sol`: `AuditF3RevealBatchReentrancyTest.test_claimHookCannotCreditBountyFromOutgoingFunds` |

## 13. Timestamp manipulation

| | |
|---|---|
| **Threat** | A block producer nudges `block.timestamp` to open or close a window (sealing, reveal, execution) earlier or later than intended. |
| **Handling** | Every window is minutes to days long: `MIN_VOTING` is 10 minutes, the reveal window 24 h, the execution grace 7 days. Validators can move `block.timestamp` only by seconds, negligible against every window. Boundaries are exact and tested to the second. |
| **Residual risk** | Accepted and documented. A vote sent in the last seconds before the close can land on either side of it. Sealing stays open until `roundTime(closeRound)`, the instant drand publishes that round, so there is no gap between the close and the beacon: if Arc block timestamps lagged the wall clock by more than drand's publication latency (or a producer held a timestamp back), a late sealer could fetch the beacon, decrypt every earlier ballot and then seal (a "last look"). Whether Arc timestamps lead or lag the wall clock is **UNKNOWN**; measure `block.timestamp` against the wall clock and the drand latency after the testnet or mainnet deploy and record it here. Closing sealing some rounds before `closeRound` would remove the gap but changes PRD §4.1. |
| **Enforced in** | Window sizes (`Sealed` constants, `EXECUTION_GRACE`); `foundry.toml` disables the `block-timestamp` lint with this rationale |
| **Test** | `contracts/test/unit/SealedRoundMath.t.sol`: `SealedRoundMathTest.test_vectors_roundAt`, `test_vectors_roundAfter`, `test_vectors_roundTime`; `contracts/test/unit/Sealed.t.sol`: `SealedTest.test_windows_exactBoundaries`, `test_consumeReveal_enforcesWindowAtExactTimestamps`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_status_passedLifecycleAtExactBoundaries`, `test_finalize_notReadyUntilRevealEnd`, `test_execute_expiryBoundary`; `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_windowBoundaries` |

## 14. Unverified USDC implementation

| | |
|---|---|
| **Threat** | Arc's USDC (`0x3600…0000`, implementation `0xC6AD…3cA6`) is not on Sourcify (PRD §9), so its bytecode cannot be checked against known FiatToken source. |
| **Handling** | `SealedDAO` calls only `balanceOf` and `transfer` (`contracts/src/interfaces/IERC20.sol` declares nothing else): no `approve`, `transferFrom` or `permit`. The DAO never assumes what it received; it reads `balanceOf` every time it credits. `transfer` must return exactly `true` (32-byte word equal to 1); a `false`, short or empty return reverts `TransferFailed`. |
| **Residual risk** | The token is an upgradeable proxy controlled by its issuer. If the issuer blocklisted the DAO contract itself, every `claim` would revert until it is lifted. A balance reduction the DAO did not initiate (a seizure) could make `balanceOf(this) < totalClaimable`, so the last claimers would fail. Neither is observed behaviour of FiatToken. `claim` through Arc's real USDC cannot be exercised locally: FiatToken on Arc calls a native-coin precompile at `0x1800…0000` that forge/anvil forks do not implement. |
| **Enforced in** | Minimal interface (`IERC20`: `balanceOf`, `transfer`), `SealedDAO._transferOut` return check, `_available` |
| **Test** | `contracts/test/fork/ArcUSDC.fork.t.sol`: `ArcUsdcForkTest.test_fork_usdcIsSixDecimals`, `test_fork_balanceOfWorks`, `test_fork_daoAccountingWithRealUsdc` (skipped unless `ARC_RPC` is set); `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_claim_bubblesTokenRevertAndChecksReturn` (false return, empty revert, no return data); `packages/sdk/test/usdc.test.ts`: "point at the Arc USDC predeploy in its 6-decimal ERC-20 view" |

---

## Additional threats (not in PRD §7)

### A1. Selective disclosure by a sealer

| | |
|---|---|
| **Threat** | The ciphertext is never checked against the commitment (D10, D11). A voter can seal a ciphertext that does not decrypt to their committed `(choice, salt)`, wait until the other votes are decrypted in the reveal window, then either reveal their committed vote from their own receipt or stay silent. |
| **Handling** | The voter can never change the committed choice: the only options are "reveal what was committed" or "stay unrevealed" (counted for quorum only). |
| **Residual risk** | A limited last-mover option: such a voter decides, after seeing the others, whether their vote counts. Closing it needs a zero-knowledge proof that the ciphertext encrypts the committed payload, which is out of scope for v1. |
| **Enforced in** | `SealedDAO.revealBatch` (hash is the authority); nothing enforces ciphertext correctness |
| **Test** | `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_selectiveDisclosureIsOnlyRevealOrAbstain` |

### A2. Bounty farming

| | |
|---|---|
| **Threat** | A member creates throwaway proposals, seals their own vote on each and reveals it to collect `revealBounty`. At Arc's 20 gwei floor, `propose` (about 201k gas), `vote` (about 68k) and a 1-item `revealBatch` cost about 0.0066 USDC per cycle, less than the demo bounty of 0.01 USDC per revealed vote. Audit F1 showed the full attack: in the demo DAO (3 members, 2 USDC treasury, 0.01 USDC bounty) one member alone ran 200 cycles, was credited 2.0 USDC for about 1.33 USDC of gas, and emptied the free treasury **600 seconds** after the first `propose`, because every proposal closes at the same round. A `SetMember` removal takes at least 10 minutes plus the 24 h reveal window, so it could never stop it, and revealing is permissionless, so front-running the reveals does not help either. |
| **Handling** | The bounty is credited only for a proposal that met quorum (`sealedCount * 10_000 >= memberSnapshot * quorumBps`, the D4 formula `finalize` uses). A proposal below quorum can never pass, so its reveals change no outcome: they still count in the tally, but pay nothing and emit no bounty event. This narrows D6 ("a fixed bounty per validly revealed vote") to keep PRD §7 ("Treasury drain: only via passed proposals"). A lone member never meets the demo's 50% quorum, so the F1 attack credits nothing. |
| **Residual risk** | A coalition large enough to meet quorum on its own can still farm: each cycle pays `k × revealBounty` for `k` colluding voters against one `propose`, `k` votes and one reveal. With `quorumBps > 5000` such a coalition is a strict majority, which can already pass any payout to itself ("Not provided" below). At exactly 5000 with an even member count, half the members meet quorum without being a majority: in a 4-member DAO two members can farm about 0.02 USDC of bounty per cycle for about 0.009 USDC of gas. The mainnet demo reaches that shape after Proof 2 adds a fourth member, but all its members are the author's wallets (D16). Deployers who want to rule it out pick `quorumBps > 5000`, or a `revealBounty` close to the measured reveal gas (`docs/GAS.md`). The farm stays bounded by the free treasury (`BountySkipped` once it is empty) and fully visible onchain. |
| **Enforced in** | `SealedDAO.revealBatch` (quorum gate), `_creditBounty` (bounded by `_available`) |
| **Test** | `contracts/test/audit/F1_BountyFarming.t.sol`: `AuditF1BountyFarmingTest.test_loneMemberCannotExtractTreasuryWithoutPassedProposal` (the 200-cycle attack now credits 0 and leaves the treasury intact); `contracts/test/unit/SealedDAO.revealBatch.t.sol`: `SealedDAORevealBatchTest.test_revealBatch_noBountyBelowQuorum`, `test_revealBatch_bountyFromExactQuorum`, `test_revealBatch_bountySkippedWhenTreasuryShort` (the bound); `contracts/test/fuzz/SealedDAO.fuzz.t.sol`: `SealedDAOFuzzTest.testFuzz_bountyCreditedIffQuorumMetAndTreasuryCovers`, `testFuzz_tallyMatchesOracle`; the cost figures come from `contracts/test/unit/SealedDAO.gas.t.sol` and `contracts/script/gas-anvil.sh` |

### A3. Hostile ciphertext or forged beacon against the SDK

| | |
|---|---|
| **Threat** | A sealed ciphertext names an arbitrary round to make every revealer fetch an unrelated beacon, or a relay (or a caller-supplied `beaconSource`) returns a forged signature so every vote is silently marked undecryptable. |
| **Handling** | `unsealVote` reads the round inside the ciphertext and returns `null` unless it equals the proposal's `closeRound`, before any fetch. Every relay response and every supplied beacon is BLS-verified against the pinned quicknet public key: `getBeacon` moves to the next relay on a bad one, and `unsealProposal` throws `InvalidBeaconError` instead of marking votes undecryptable. |
| **Residual risk** | If all three relays are down or serve invalid data, the SDK throws `DrandFetchError` (row 4). |
| **Enforced in** | SDK `seal.ts` (`unsealVote` round check), `drand.ts` (`getBeacon` verification), `reveal.ts` (`unsealProposal` beacon check) |
| **Test** | `packages/sdk/test/seal.test.ts`: "round mismatch between the ciphertext and closeRound -> null, and nothing is fetched"; `packages/sdk/test/drand.test.ts`: "falls back on malformed bodies, the wrong round and a signature that does not verify"; `packages/sdk/test/actions.test.ts`: "refuses a beacon for another round or with a bad signature before decrypting anything"; `packages/tlock/test/tlock.test.ts`: "rejects a signature for another round, a flipped bit and malformed input without throwing" |

### A4. A passed payout competing for the free treasury

| | |
|---|---|
| **Threat** | `execute` checks `balance - totalClaimable >= amount` only when it runs; nothing is reserved at finalize. Any credit taken from the free treasury between finalize and execute can make a fully funded, passed `TransferUSDC` revert `InsufficientTreasury`. Audit F2 showed a lone member doing it on purpose: a throwaway proposal timed so its reveal window overlaps the payout's, and a reveal of their own vote that took the bounty the payout needed. |
| **Handling** | The quorum-gated bounty (A2) closes the lone-member version: a throwaway proposal below quorum pays nothing. A payout that is short stays `Passed` for the 7-day grace, and anyone can top up the treasury with a plain USDC transfer and execute it. Reserving passed payouts at finalize (a `totalReserved` counter) would change PRD §4.3 and was not adopted. |
| **Residual risk** | Bounties of *other* proposals that met quorum, and other passed payouts executed first, still draw on the same free USDC. Fund the treasury with the payout plus the reveal payments of the proposals in flight. |
| **Enforced in** | `SealedDAO.execute` (`InsufficientTreasury`), `revealBatch` (quorum gate) |
| **Test** | `contracts/test/audit/F2_PassedPayoutStarvation.t.sol`: `AuditF2PassedPayoutStarvationTest.test_passedPayoutCannotBeStarvedByALoneMembersBounty`; `contracts/test/audit/A0_EdgeProbes.t.sol`: `AuditA0EdgeProbesTest.test_executeAtExactTreasuryBoundary` |

### A5. Untrusted proposal text and links

| | |
|---|---|
| **Threat** | `description` and `descriptionURI` are written by any member and read by every client. An unbounded URI makes every `proposal(id)` read and `ProposalCreated` log carry kilobytes, and a `javascript:` or look-alike URI rendered as a link is a phishing vector. Proposals can be created without the web form, so form validation alone protects nothing. |
| **Handling** | `description` is capped at 256 bytes (`DescriptionTooLong`) and `descriptionURI` at 2,048 bytes (`DescriptionURITooLong`, audit F8). The scheme is not checked onchain; `apps/web` renders a URI as a link only for `https://`, `http://` and `ipfs://` and shows anything else as inert text. The SDK's `proposeInputSchema` mirrors both caps. |
| **Residual risk** | An `https://` link can still point anywhere; the app shows it as "Full description" and opens it in a new tab with `noopener`. |
| **Enforced in** | `SealedDAO.propose`, `apps/web` (`isLinkableUri`, `DescriptionLink`), SDK `proposeInputSchema` |
| **Test** | `contracts/test/audit/F8_DescriptionURIUnbounded.t.sol`: `AuditF8DescriptionURIUnboundedTest.test_uriLongerThanTheCapIsRejected`, `test_uriAtTheCapIsStored`; `contracts/test/unit/SealedDAO.t.sol`: `SealedDAOTest.test_propose_descriptionLength`; `apps/web/test/proposal-form.test.ts`: "links only https://, http:// and ipfs:// URIs read from the chain"; `apps/web/test/proposal-copy.test.tsx`: "shows any other scheme as inert text, never as a link"; `packages/sdk/test/actions.test.ts`: "propose params mirror the contract checks" |

### A6. Integrator mistakes in the SDK write path

| | |
|---|---|
| **Threat** | (a) A transaction signed by a local account (a key or keystore in the process) is sent with the node's exact gas estimate; if gas depends on state that moves before inclusion, it runs out of gas after the simulation passed (audit F4: `propose` cost 70 gas more off a round boundary). (b) `sealAndVote` accepted a caller-supplied `closeRound` without checking it: an earlier round makes the vote readable before voting closes, a later one makes it undecryptable during the reveal window (audit F10). |
| **Handling** | (a) `write()` sends local-account transactions with the estimate plus a 20% margin (`GAS_MARGIN_PERCENT`, `withGasMargin`), like `scripts/` and browser wallets; JSON-RPC accounts keep their wallet's own estimate. `Sealed.roundAfter` is branch-free, so `propose` costs the same in every second. (b) `sealAndVote` always reads the proposal and throws `InvalidInputError`, before sealing or sending, when a supplied `closeRound` differs. |
| **Residual risk** | A transaction can still revert onchain if a window closes between simulation and inclusion; `waitForSuccess` reports it as `TransactionRevertedError`. |
| **Enforced in** | SDK `actions.ts` (`write`, `sealAndVote`), `Sealed.roundAfter` |
| **Test** | `contracts/test/audit/F4_ProposeGasTimestampDependent.t.sol`: `AuditF4ProposeGasTimestampDependentTest.test_proposeGasEstimateFromPreviousSecondStillSuffices`; `contracts/test/unit/SealedRoundMath.t.sol` (the 20 shared round vectors); `packages/sdk/test/anvil.test.ts`: "finalize after the reveal window, execute, then claim (blocklist revert decoded, balance kept)" (a local account's gas limit is the estimate plus 20%), "five sealed votes over > 20,000 blocks, one with a garbage ciphertext" (a mismatched `closeRound` is refused before anything is sealed); `packages/sdk/test/actions.test.ts`: "local accounts get a 20% gas margin over the estimate, rounded up" |

---

## Not provided

PRD §2.2 and §7 put these out of scope for v1. Each is a deliberate, documented non-goal.

- **Anonymity.** Sealing hides *which choice* a member made, not *who* voted: `vote()` is a normal transaction from the
  voter's own address, and the reveal publishes the `(voter, choice)` pair in a `VoteRevealed` event forever. There is
  no mixing, no ring signature, no zero-knowledge membership proof. Anonymity would need a different design (ZK or
  MACI-style tallying), listed as future scope in PRD §2.2.
- **Coercion resistance.** A voter can prove their vote to a third party before the close by handing over their
  `(choice, salt)` (the receipt): anyone can check it against the onchain commitment with `hashVote`. So a willing
  seller can prove delivery privately. What ArcSeal prevents is that the *chain* shows any vote or running tally while
  voting is open.
- **Protection against a majority of members colluding.** Members whose sealed votes meet `quorumBps` of
  `memberSnapshot`, and who hold a majority of the revealed votes, can pass and execute any `TransferUSDC` or
  `SetMember` proposal, including paying the whole treasury to themselves or removing every other member. There is no
  veto and no supermajority rule. This is the accepted trust model of a small member-voted treasury (the mainnet demo
  uses three wallets the author controls).

**D17, stated plainly:** secrecy holds **during** voting: nobody, including the contract, can read a sealed vote's
choice before drand publishes the close round. From that round on, anyone can decrypt every sealed vote from the
`Sealed` log, whether or not it is ever revealed onchain, so staying unrevealed is not a way to keep a vote private.
After the reveal, **each vote is public per address**, permanently, in the `VoteRevealed` event log. This is not
anonymity, and the site and README say so.

**Timing.** The reveal window is a fixed 24 h (`REVEAL_WINDOW = 28,800` rounds) from the close round, whatever the
voting duration, so **the fastest any proposal can go from close to finalize is 24 hours** (`SPEC.md` §6.4). This
floor is not configurable per proposal (D14).
