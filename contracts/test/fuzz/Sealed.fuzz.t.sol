// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {stdError} from "forge-std/Test.sol";
import {Sealed} from "../../src/Sealed.sol";
import {SealedBaseTest} from "../unit/SealedBase.t.sol";

/// @notice Property tests for the round math, duration and ciphertext bounds, and window/reveal rules of Sealed.
contract SealedFuzzTest is SealedBaseTest {
    // Far beyond any real timestamp, far below the uint64 round limit (checked separately in the unit suite).
    uint256 internal constant MAX_T = GENESIS + 2 ** 62;

    // ------------------------------------------------------------------
    // Round relations (PRD 4.1)
    // ------------------------------------------------------------------

    /// roundTime(roundAt(t)) <= t < roundTime(roundAt(t)) + PERIOD
    function testFuzz_roundAt_bracketsTimestamp(uint256 t) public view {
        t = bound(t, GENESIS, MAX_T);
        uint64 round = harness.roundAt(t);
        assertGe(round, 1);
        uint256 start = harness.roundTime(round);
        assertLe(start, t);
        assertLt(t, start + PERIOD);
    }

    /// roundAfter(t) is the minimal round with roundTime >= t, and differs from roundAt(t) by at most one.
    function testFuzz_roundAfter_isFirstRoundAtOrAfter(uint256 t) public view {
        t = bound(t, GENESIS, MAX_T);
        uint64 after_ = harness.roundAfter(t);
        assertGe(harness.roundTime(after_), t, "published at or after t");
        if (after_ > 1) assertLt(harness.roundTime(after_ - 1), t, "minimal");

        uint64 at = harness.roundAt(t);
        bool boundary = harness.roundTime(at) == t;
        assertEq(after_, boundary ? at : at + 1, "roundAt relation");
    }

    /// roundAt and roundAfter both invert roundTime on every representable round.
    function testFuzz_roundTime_inverse(uint64 r) public view {
        r = uint64(bound(r, 1, type(uint64).max));
        uint256 t = harness.roundTime(r);
        assertEq(harness.roundAt(t), r);
        assertEq(harness.roundAfter(t), r);
        assertEq(harness.roundAt(t + PERIOD - 1), r);
        if (r < type(uint64).max) {
            assertEq(harness.roundAfter(t + 1), r + 1);
            assertEq(harness.roundTime(r + 1) - t, PERIOD);
        }
    }

    function testFuzz_roundMath_revertsBeforeGenesis(uint256 t) public {
        t = bound(t, 0, GENESIS - 1);
        vm.expectRevert(stdError.arithmeticError);
        harness.roundAt(t);
        vm.expectRevert(stdError.arithmeticError);
        harness.roundAfter(t);
    }

    // ------------------------------------------------------------------
    // Duration bounds and close round placement
    // ------------------------------------------------------------------

    function testFuzz_openGroup_duration(uint32 votingSeconds, uint256 startOffset) public {
        uint256 start = T0 + bound(startOffset, 0, 75 * 365 days);
        vm.warp(start);
        if (votingSeconds < 600 || votingSeconds > 7 days) {
            vm.expectRevert(Sealed.BadDuration.selector);
            harness.openGroup(GROUP, votingSeconds);
            return;
        }
        uint64 closeRound = harness.openGroup(GROUP, votingSeconds);
        uint256 end = start + votingSeconds;
        uint256 closeTime = harness.roundTime(closeRound);
        assertGe(closeTime, end, "never closes early");
        assertLt(closeTime, end + PERIOD, "closes within one period of the requested end");
        assertEq(_group(GROUP).revealEndRound, closeRound + WINDOW);
        assertTrue(harness.sealingOpen(GROUP));
        assertFalse(harness.revealOpen(GROUP));
    }

    // ------------------------------------------------------------------
    // Ciphertext length bounds
    // ------------------------------------------------------------------

    function testFuzz_seal_ciphertextLength(uint256 length) public {
        length = bound(length, 0, 2048);
        _open(GROUP, TEN_MINUTES);
        bytes memory ct = _ciphertext(length);
        if (length < 359 || length > 1024) {
            vm.expectRevert(Sealed.BadCiphertextLength.selector);
            harness.seal(GROUP, alice, COMMITMENT, ct);
            assertEq(harness.commitmentOf(GROUP, alice), bytes32(0));
        } else {
            harness.seal(GROUP, alice, COMMITMENT, ct);
            assertEq(harness.commitmentOf(GROUP, alice), COMMITMENT);
        }
    }

    // ------------------------------------------------------------------
    // Windows and reveal consumption
    // ------------------------------------------------------------------

    /// sealingOpen and revealOpen follow the PRD 4.1 formulas at every instant and are never both true.
    function testFuzz_windows_matchFormulas(uint32 votingSeconds, uint256 elapsed) public {
        votingSeconds = uint32(bound(votingSeconds, 600, 7 days));
        _open(GROUP, votingSeconds);
        uint256 closeTime = _closeTime(GROUP);
        uint256 endTime = _revealEndTime(GROUP);

        uint256 t = T0 + bound(elapsed, 0, uint256(votingSeconds) + 25 hours);
        vm.warp(t);
        bool sealing = harness.sealingOpen(GROUP);
        bool revealing = harness.revealOpen(GROUP);
        assertEq(sealing, t < closeTime, "sealingOpen");
        assertEq(revealing, closeTime <= t && t < endTime, "revealOpen");
        assertFalse(sealing && revealing, "exclusive");
    }

    /// _consumeReveal succeeds exactly when revealOpen is true, and reverts with the matching error otherwise.
    function testFuzz_consumeReveal_followsWindow(uint32 votingSeconds, uint256 elapsed) public {
        votingSeconds = uint32(bound(votingSeconds, 600, 7 days));
        _open(GROUP, votingSeconds);
        _seal(GROUP, alice, COMMITMENT);
        uint256 closeTime = _closeTime(GROUP);
        uint256 endTime = _revealEndTime(GROUP);

        uint256 t = T0 + bound(elapsed, 0, uint256(votingSeconds) + 25 hours);
        vm.warp(t);
        if (t < closeTime) {
            vm.expectRevert(Sealed.RevealNotOpen.selector);
        } else if (t >= endTime) {
            vm.expectRevert(Sealed.RevealClosed.selector);
        }
        harness.consumeReveal(GROUP, alice);
        assertEq(harness.commitmentOf(GROUP, alice), harness.revealOpen(GROUP) ? REVEALED : COMMITMENT);
    }

    /// verify is true iff the live commitment equals `expected`; after consume it is false for every input.
    function testFuzz_verifyReveal(bytes32 commitment, bytes32 expected) public {
        vm.assume(commitment != bytes32(0) && commitment != REVEALED);
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, commitment);
        vm.warp(_closeTime(GROUP));

        assertEq(harness.verifyReveal(GROUP, alice, expected), expected == commitment);
        assertTrue(harness.verifyReveal(GROUP, alice, commitment));
        assertFalse(harness.verifyReveal(GROUP, bob, expected), "never sealed");

        harness.consumeReveal(GROUP, alice);
        assertFalse(harness.verifyReveal(GROUP, alice, expected));
        assertFalse(harness.verifyReveal(GROUP, alice, commitment));
        assertFalse(harness.verifyReveal(GROUP, alice, REVEALED));
    }

    /// Commitments are keyed by (groupId, sealer): sealing or consuming one key never touches another.
    function testFuzz_commitmentsIsolated(uint256 groupA, uint256 groupB, address sealerA, address sealerB) public {
        vm.assume(groupA != groupB && sealerA != sealerB);
        _open(groupA, TEN_MINUTES);
        _open(groupB, TEN_MINUTES);
        _seal(groupA, sealerA, COMMITMENT);

        assertEq(harness.commitmentOf(groupA, sealerA), COMMITMENT);
        assertEq(harness.commitmentOf(groupB, sealerA), bytes32(0));
        assertEq(harness.commitmentOf(groupA, sealerB), bytes32(0));
        _seal(groupB, sealerA, OTHER_COMMITMENT);
        _seal(groupA, sealerB, OTHER_COMMITMENT);

        vm.warp(_closeTime(groupA));
        harness.consumeReveal(groupA, sealerA);
        assertEq(harness.commitmentOf(groupA, sealerA), REVEALED);
        assertTrue(harness.verifyReveal(groupB, sealerA, OTHER_COMMITMENT));
        assertTrue(harness.verifyReveal(groupA, sealerB, OTHER_COMMITMENT));
    }
}
