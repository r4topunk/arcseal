// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Test.sol";
import {Sealed} from "../../src/Sealed.sol";
import {SealedBaseTest} from "./SealedBase.t.sol";

/// @notice Sealed module (PRD 4.2): groups, seals, windows, reveal verification and consumption.
contract SealedTest is SealedBaseTest {
    // ------------------------------------------------------------------
    // _openGroup
    // ------------------------------------------------------------------

    function test_openGroup_storesRoundsAndEmits() public {
        // T0 + 600 is a round boundary, so the close round is exactly the round published at T0 + 600:
        // (1_790_813_400 - 1_692_803_367) / 3 + 1 = 32_670_012
        uint64 expectedClose = 32_670_012;
        assertEq(expectedClose, (T0 + TEN_MINUTES - GENESIS) / PERIOD + 1);
        vm.expectEmit(address(harness));
        emit Sealed.SealGroupOpened(GROUP, expectedClose, expectedClose + WINDOW);
        uint64 closeRound = _open(GROUP, TEN_MINUTES);

        assertEq(closeRound, expectedClose);
        Sealed.SealGroup memory g = _group(GROUP);
        assertEq(g.closeRound, expectedClose);
        assertEq(g.revealEndRound, expectedClose + WINDOW);
        assertEq(_closeTime(GROUP), T0 + TEN_MINUTES);
        assertEq(_revealEndTime(GROUP), T0 + TEN_MINUTES + 24 hours);
    }

    function test_openGroup_closeRoundIsFirstRoundAtOrAfterEnd() public {
        // requested end T0 + 601 and T0 + 602 fall inside a round: close moves up to the next one (T0 + 603)
        vm.warp(T0 + 1);
        uint64 first = _open(1, TEN_MINUTES);
        vm.warp(T0 + 2);
        uint64 second = _open(2, TEN_MINUTES);
        assertEq(first, second);
        assertEq(harness.roundTime(first), T0 + 603);
        assertEq(first, harness.roundAfter(T0 + 601));
        // never earlier than requested: sealing lasts at least votingSeconds
        assertGe(_closeTime(1), T0 + 1 + TEN_MINUTES);
    }

    function test_openGroup_acceptsDurationBounds() public {
        uint64 shortest = _open(1, harness.MIN_VOTING());
        uint64 longest = _open(2, harness.MAX_VOTING());
        assertEq(harness.roundTime(shortest), T0 + 600);
        assertEq(harness.roundTime(longest), T0 + 7 days);
        assertTrue(harness.sealingOpen(1));
        assertTrue(harness.sealingOpen(2));
    }

    function test_openGroup_revertsBadDuration() public {
        uint32[4] memory bad = [uint32(0), 599, 7 days + 1, type(uint32).max];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(Sealed.BadDuration.selector);
            harness.openGroup(GROUP, bad[i]);
        }
        assertEq(_group(GROUP).closeRound, 0);
    }

    function test_openGroup_revertsGroupAlreadyOpen() public {
        uint64 closeRound = _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.expectRevert(Sealed.GroupAlreadyOpen.selector);
        harness.openGroup(GROUP, 7 days);
        // still rejected once every window has passed: rounds are never rewritten under commitments
        vm.warp(_revealEndTime(GROUP) + 1 days);
        vm.expectRevert(Sealed.GroupAlreadyOpen.selector);
        harness.openGroup(GROUP, TEN_MINUTES);
        assertEq(_group(GROUP).closeRound, closeRound);
    }

    // ------------------------------------------------------------------
    // sealingOpen / revealOpen at exact timestamps
    // ------------------------------------------------------------------

    function test_windows_unknownGroupIsClosed() public view {
        assertFalse(harness.sealingOpen(99));
        assertFalse(harness.revealOpen(99));
    }

    function test_windows_exactBoundaries() public {
        vm.warp(T0 + 1); // start mid-round so closeTime is not simply start + duration
        _open(GROUP, TEN_MINUTES);
        uint256 closeTime = _closeTime(GROUP);
        uint256 endTime = _revealEndTime(GROUP);
        assertEq(endTime - closeTime, 24 hours);

        assertTrue(harness.sealingOpen(GROUP), "opened");
        assertFalse(harness.revealOpen(GROUP), "opened");

        vm.warp(closeTime - 1);
        assertTrue(harness.sealingOpen(GROUP), "close - 1");
        assertFalse(harness.revealOpen(GROUP), "close - 1");

        vm.warp(closeTime);
        assertFalse(harness.sealingOpen(GROUP), "close");
        assertTrue(harness.revealOpen(GROUP), "close");

        vm.warp(endTime - 1);
        assertFalse(harness.sealingOpen(GROUP), "end - 1");
        assertTrue(harness.revealOpen(GROUP), "end - 1");

        vm.warp(endTime);
        assertFalse(harness.sealingOpen(GROUP), "end");
        assertFalse(harness.revealOpen(GROUP), "end");
    }

    function test_requireRevealOpen_boundaries() public {
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        harness.requireRevealOpen(99);

        _open(GROUP, TEN_MINUTES);
        uint256 closeTime = _closeTime(GROUP);
        uint256 endTime = _revealEndTime(GROUP);

        vm.warp(closeTime - 1);
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        harness.requireRevealOpen(GROUP);

        vm.warp(closeTime);
        harness.requireRevealOpen(GROUP);
        vm.warp(endTime - 1);
        harness.requireRevealOpen(GROUP);

        vm.warp(endTime);
        vm.expectRevert(Sealed.RevealClosed.selector);
        harness.requireRevealOpen(GROUP);
    }

    // ------------------------------------------------------------------
    // _seal
    // ------------------------------------------------------------------

    function test_seal_storesCommitmentAndEmitsCiphertext() public {
        _open(GROUP, TEN_MINUTES);
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);
        vm.expectEmit(address(harness));
        emit Sealed.Sealed(GROUP, alice, COMMITMENT, ct);
        harness.seal(GROUP, alice, COMMITMENT, ct);
        assertEq(harness.commitmentOf(GROUP, alice), COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, bob), bytes32(0));
    }

    /// D10: state stores only the commitment; the ciphertext lives in the log.
    function test_seal_writesOnlyTheCommitmentSlot() public {
        _open(GROUP, TEN_MINUTES);
        bytes memory ct = _ciphertext(harness.MAX_CIPHERTEXT_LENGTH());
        vm.record();
        vm.recordLogs();
        harness.seal(GROUP, alice, COMMITMENT, ct);
        (, bytes32[] memory writes) = vm.accesses(address(harness));
        assertEq(writes.length, 1, "one storage write");
        assertEq(vm.load(address(harness), writes[0]), COMMITMENT);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        (bytes32 commitment, bytes memory logged) = abi.decode(logs[0].data, (bytes32, bytes));
        assertEq(commitment, COMMITMENT);
        assertEq(keccak256(logged), keccak256(ct));
    }

    function test_seal_revertsUnknownGroup() public {
        vm.expectRevert(Sealed.SealingClosed.selector);
        _seal(99, alice, COMMITMENT);
    }

    function test_seal_sealingClosesAtCloseRoundTime() public {
        _open(GROUP, TEN_MINUTES);
        uint256 closeTime = _closeTime(GROUP);

        vm.warp(closeTime - 1);
        _seal(GROUP, alice, COMMITMENT);

        vm.warp(closeTime);
        vm.expectRevert(Sealed.SealingClosed.selector);
        _seal(GROUP, bob, COMMITMENT);

        vm.warp(_revealEndTime(GROUP));
        vm.expectRevert(Sealed.SealingClosed.selector);
        _seal(GROUP, bob, COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, bob), bytes32(0));
    }

    function test_seal_revertsAlreadySealed() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.expectRevert(Sealed.AlreadySealed.selector);
        _seal(GROUP, alice, OTHER_COMMITMENT);
        vm.expectRevert(Sealed.AlreadySealed.selector);
        _seal(GROUP, alice, COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, alice), COMMITMENT);
        // other sealers are unaffected
        _seal(GROUP, bob, OTHER_COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, bob), OTHER_COMMITMENT);
    }

    /// A zero commitment would read as "not sealed" and allow sealing again; REVEALED would read as consumed.
    function test_seal_revertsBadCommitment() public {
        _open(GROUP, TEN_MINUTES);
        vm.expectRevert(Sealed.BadCommitment.selector);
        _seal(GROUP, alice, bytes32(0));
        vm.expectRevert(Sealed.BadCommitment.selector);
        _seal(GROUP, alice, REVEALED);
        assertEq(harness.commitmentOf(GROUP, alice), bytes32(0));
        _seal(GROUP, alice, bytes32(uint256(2)));
    }

    function test_seal_ciphertextLengthBounds() public {
        _open(GROUP, TEN_MINUTES);
        uint256[4] memory bad = [uint256(0), 358, 1025, 4096];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(Sealed.BadCiphertextLength.selector);
            harness.seal(GROUP, alice, COMMITMENT, _ciphertext(bad[i]));
        }
        harness.seal(GROUP, alice, COMMITMENT, _ciphertext(359));
        harness.seal(GROUP, bob, COMMITMENT, _ciphertext(1024));
        assertEq(harness.commitmentOf(GROUP, alice), COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, bob), COMMITMENT);
    }

    function test_seal_sameSealerAcrossGroups() public {
        _open(1, TEN_MINUTES);
        _open(2, 1 hours);
        _seal(1, alice, COMMITMENT);
        _seal(2, alice, OTHER_COMMITMENT);
        assertEq(harness.commitmentOf(1, alice), COMMITMENT);
        assertEq(harness.commitmentOf(2, alice), OTHER_COMMITMENT);
    }

    // ------------------------------------------------------------------
    // _verifyReveal
    // ------------------------------------------------------------------

    function test_verifyReveal_trueForLiveMatchInAnyWindow() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        // pure comparison: no window check
        assertTrue(harness.verifyReveal(GROUP, alice, COMMITMENT));
        vm.warp(_closeTime(GROUP));
        assertTrue(harness.verifyReveal(GROUP, alice, COMMITMENT));
        vm.warp(_revealEndTime(GROUP) + 1 days);
        assertTrue(harness.verifyReveal(GROUP, alice, COMMITMENT));
    }

    function test_verifyReveal_falseOnMismatch() public {
        _open(1, TEN_MINUTES);
        _open(2, TEN_MINUTES);
        _seal(1, alice, COMMITMENT);
        _seal(1, bob, OTHER_COMMITMENT);
        vm.warp(_closeTime(1));
        assertFalse(harness.verifyReveal(1, alice, OTHER_COMMITMENT), "wrong hash");
        assertFalse(harness.verifyReveal(1, bob, COMMITMENT), "other sealer's hash");
        assertFalse(harness.verifyReveal(2, alice, COMMITMENT), "other group");
        assertFalse(harness.verifyReveal(1, alice, bytes32(0)), "zero");
    }

    function test_verifyReveal_falseForEmptyCommitment() public {
        _open(GROUP, TEN_MINUTES);
        vm.warp(_closeTime(GROUP));
        assertFalse(harness.verifyReveal(GROUP, carol, bytes32(0)), "empty vs zero");
        assertFalse(harness.verifyReveal(GROUP, carol, COMMITMENT), "empty vs hash");
        assertFalse(harness.verifyReveal(99, carol, bytes32(0)), "unknown group");
    }

    function test_verifyReveal_falseForSentinel() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.warp(_closeTime(GROUP));
        harness.consumeReveal(GROUP, alice);
        assertEq(harness.commitmentOf(GROUP, alice), REVEALED);
        assertFalse(harness.verifyReveal(GROUP, alice, COMMITMENT), "original after consume");
        assertFalse(harness.verifyReveal(GROUP, alice, REVEALED), "sentinel itself");
    }

    // ------------------------------------------------------------------
    // _consumeReveal
    // ------------------------------------------------------------------

    function test_consumeReveal_setsSentinelAndEmitsOriginalCommitment() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.warp(_closeTime(GROUP));
        vm.expectEmit(address(harness));
        emit Sealed.Revealed(GROUP, alice, COMMITMENT);
        harness.consumeReveal(GROUP, alice);
        assertEq(harness.commitmentOf(GROUP, alice), REVEALED);
    }

    function test_consumeReveal_revertsNothingSealed() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.warp(_closeTime(GROUP));
        vm.expectRevert(Sealed.NothingSealed.selector);
        harness.consumeReveal(GROUP, carol);
    }

    function test_consumeReveal_doubleConsumeReverts() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.warp(_closeTime(GROUP));
        harness.consumeReveal(GROUP, alice);
        vm.expectRevert(Sealed.NothingSealed.selector);
        harness.consumeReveal(GROUP, alice);
        assertEq(harness.commitmentOf(GROUP, alice), REVEALED);
    }

    function test_consumeReveal_enforcesWindowAtExactTimestamps() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        _seal(GROUP, bob, COMMITMENT);
        _seal(GROUP, carol, COMMITMENT);
        uint256 closeTime = _closeTime(GROUP);
        uint256 endTime = _revealEndTime(GROUP);

        vm.warp(closeTime - 1);
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        harness.consumeReveal(GROUP, alice);

        vm.warp(closeTime);
        harness.consumeReveal(GROUP, alice);

        vm.warp(endTime - 1);
        harness.consumeReveal(GROUP, bob);

        vm.warp(endTime);
        vm.expectRevert(Sealed.RevealClosed.selector);
        harness.consumeReveal(GROUP, carol);
        assertEq(harness.commitmentOf(GROUP, carol), COMMITMENT);
    }

    function test_consumeReveal_revertsUnknownGroup() public {
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        harness.consumeReveal(99, alice);
    }

    function test_consumeReveal_isolatedPerGroup() public {
        _open(1, TEN_MINUTES);
        _open(2, TEN_MINUTES);
        _seal(1, alice, COMMITMENT);
        _seal(2, alice, COMMITMENT);
        vm.warp(_closeTime(1));
        harness.consumeReveal(1, alice);
        assertEq(harness.commitmentOf(1, alice), REVEALED);
        assertEq(harness.commitmentOf(2, alice), COMMITMENT);
        assertTrue(harness.verifyReveal(2, alice, COMMITMENT));
    }

    // ------------------------------------------------------------------
    // _reveal (strict single reveal)
    // ------------------------------------------------------------------

    function test_reveal_consumesOnMatch() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.warp(_closeTime(GROUP));
        vm.expectEmit(address(harness));
        emit Sealed.Revealed(GROUP, alice, COMMITMENT);
        harness.reveal(GROUP, alice, COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, alice), REVEALED);
    }

    function test_reveal_revertsBadReveal() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.warp(_closeTime(GROUP));
        vm.expectRevert(Sealed.BadReveal.selector);
        harness.reveal(GROUP, alice, OTHER_COMMITMENT);
        vm.expectRevert(Sealed.BadReveal.selector);
        harness.reveal(GROUP, carol, bytes32(0));

        harness.reveal(GROUP, alice, COMMITMENT);
        vm.expectRevert(Sealed.BadReveal.selector);
        harness.reveal(GROUP, alice, COMMITMENT);
        vm.expectRevert(Sealed.BadReveal.selector);
        harness.reveal(GROUP, alice, REVEALED);
    }

    function test_reveal_checksWindowBeforeHash() public {
        _open(GROUP, TEN_MINUTES);
        _seal(GROUP, alice, COMMITMENT);
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        harness.reveal(GROUP, alice, OTHER_COMMITMENT);
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        harness.reveal(GROUP, alice, COMMITMENT);

        vm.warp(_revealEndTime(GROUP));
        vm.expectRevert(Sealed.RevealClosed.selector);
        harness.reveal(GROUP, alice, COMMITMENT);
        assertEq(harness.commitmentOf(GROUP, alice), COMMITMENT);
    }
}
