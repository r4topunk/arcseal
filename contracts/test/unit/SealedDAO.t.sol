// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "../../src/Sealed.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {WeirdUSDC} from "../mocks/WeirdUSDC.sol";
import {SealedDAOBaseTest} from "./SealedDAOBase.t.sol";

/// @notice SealedDAO (PRD 4.3 / 4.4): constructor, propose, vote, finalize, execute, claim, status and views.
///         revealBatch has its own suite (SealedDAO.revealBatch.t.sol), the USDC blocklist too (SealedDAO.blocklist.t.sol).
contract SealedDAOTest is SealedDAOBaseTest {
    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    function test_constructor_setsParamsMembersAndEmits() public {
        address[] memory members = _addrs(alice, bob, carol);
        for (uint256 i; i < members.length; ++i) {
            vm.expectEmit();
            emit SealedDAO.MemberSet(members[i], true);
        }
        SealedDAO fresh = _deploy(members, 6667, 5);

        assertEq(address(fresh.usdc()), address(usdc));
        assertEq(fresh.quorumBps(), 6667);
        assertEq(fresh.revealBounty(), 5);
        assertEq(fresh.memberCount(), 3);
        assertTrue(fresh.isMember(alice) && fresh.isMember(bob) && fresh.isMember(carol));
        assertFalse(fresh.isMember(dave));
        assertEq(fresh.proposalCount(), 0);
        assertEq(fresh.totalClaimable(), 0);
        assertEq(fresh.EXECUTION_GRACE(), 7 days);
        assertEq(fresh.MAX_BATCH(), 256);
        assertEq(fresh.MAX_DESCRIPTION_LENGTH(), 256);
    }

    function test_constructor_acceptsBounds() public {
        SealedDAO single = _deploy(_addrs(alice), 10_000, 0);
        assertEq(single.memberCount(), 1);
        assertEq(single.quorumBps(), 10_000);
        assertEq(_deploy(_addrs(alice), 1, 0).quorumBps(), 1);
    }

    function test_constructor_reverts() public {
        address[] memory members = _addrs(alice, bob);

        vm.expectRevert(SealedDAO.BadUSDC.selector);
        new SealedDAO(address(0), members, QUORUM_BPS, BOUNTY);

        vm.expectRevert(SealedDAO.BadQuorum.selector);
        _deploy(members, 0, BOUNTY);

        vm.expectRevert(SealedDAO.BadQuorum.selector);
        _deploy(members, 10_001, BOUNTY);

        vm.expectRevert(SealedDAO.NoMembers.selector);
        _deploy(new address[](0), QUORUM_BPS, BOUNTY);

        vm.expectRevert(SealedDAO.BadMember.selector);
        _deploy(_addrs(alice, address(0)), QUORUM_BPS, BOUNTY);

        vm.expectRevert(SealedDAO.DuplicateMember.selector);
        _deploy(_addrs(alice, bob, alice), QUORUM_BPS, BOUNTY);
    }

    // ------------------------------------------------------------------
    // propose
    // ------------------------------------------------------------------

    function test_propose_storesProposalAndEmits() public {
        // T0 + 600 is a round boundary: (1_790_813_400 - 1_692_803_367) / 3 + 1 = 32_670_012
        uint64 close = 32_670_012;
        uint64 revealEnd = close + dao.REVEAL_WINDOW();
        vm.expectEmit(address(dao));
        emit Sealed.SealGroupOpened(1, close, revealEnd);
        vm.expectEmit(address(dao));
        emit SealedDAO.ProposalCreated(
            1, bob, SealedDAO.ActionKind.TransferUSDC, carol, 5e6, false, close, revealEnd, 4, "pay carol", "ipfs://x"
        );
        vm.prank(bob);
        uint256 id = dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 5e6, false, "pay carol", "ipfs://x", 600);

        assertEq(id, 1);
        assertEq(dao.proposalCount(), 1);
        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(p.proposer, bob);
        assertEq(uint8(p.kind), uint8(SealedDAO.ActionKind.TransferUSDC));
        assertEq(p.target, carol);
        assertEq(p.amount, 5e6);
        assertFalse(p.flag);
        assertEq(p.description, "pay carol");
        assertEq(p.descriptionURI, "ipfs://x");
        assertEq(p.closeRound, close);
        assertEq(p.revealEndRound, revealEnd);
        assertEq(p.memberSnapshot, 4);
        assertEq(p.sealedCount + p.revealedCount + p.forCount + p.againstCount + p.abstainCount, 0);
        assertFalse(p.finalized || p.passed || p.executed);
        assertEq(_closeTime(id), T0 + 600);
        assertEq(_revealEndTime(id), T0 + 600 + 24 hours);
        assertTrue(dao.sealingOpen(id));
        _assertStatus(id, SealedDAO.Status.Voting);
    }

    function test_propose_idsIncrementAndSetMemberStoresFlag() public {
        uint256 first = _proposeTransfer(carol, 1);
        uint256 second = _proposeSetMember(eve, true, TEN_MINUTES);
        assertEq(first, 1);
        assertEq(second, 2);
        SealedDAO.Proposal memory p = dao.proposal(second);
        assertEq(uint8(p.kind), uint8(SealedDAO.ActionKind.SetMember));
        assertEq(p.target, eve);
        assertTrue(p.flag);
        assertEq(p.amount, 0);
    }

    function test_propose_revertsNotMember() public {
        vm.prank(eve);
        vm.expectRevert(SealedDAO.NotMember.selector);
        dao.propose(SealedDAO.ActionKind.TransferUSDC, eve, 1, false, "", "", TEN_MINUTES);
    }

    function test_propose_revertsBadTarget() public {
        // zero, this DAO and the USDC token can never claim or vote: refused for both kinds (audit F6)
        address[3] memory bad = [address(0), address(dao), address(usdc)];
        vm.startPrank(alice);
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(SealedDAO.BadTarget.selector);
            dao.propose(SealedDAO.ActionKind.TransferUSDC, bad[i], 1, false, "", "", TEN_MINUTES);
            vm.expectRevert(SealedDAO.BadTarget.selector);
            dao.propose(SealedDAO.ActionKind.SetMember, bad[i], 0, true, "", "", TEN_MINUTES);
        }
        vm.stopPrank();
        assertEq(dao.proposalCount(), 0);
    }

    function test_propose_revertsBadAmountOnlyForTransfer() public {
        vm.startPrank(alice);
        vm.expectRevert(SealedDAO.BadAmount.selector);
        dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 0, false, "", "", TEN_MINUTES);
        // SetMember ignores amount: 0 is fine
        dao.propose(SealedDAO.ActionKind.SetMember, eve, 0, true, "", "", TEN_MINUTES);
        vm.stopPrank();
    }

    function test_propose_durationBounds() public {
        uint32[3] memory bad = [uint32(599), 7 days + 1, 0];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(Sealed.BadDuration.selector);
            dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, "", "", bad[i]);
        }
        assertEq(dao.proposalCount(), 0);

        uint256 shortest = _propose(alice, SealedDAO.ActionKind.TransferUSDC, carol, 1, false, 600);
        uint256 longest = _propose(alice, SealedDAO.ActionKind.TransferUSDC, carol, 1, false, 7 days);
        assertEq(_closeTime(shortest), T0 + 600);
        assertEq(_closeTime(longest), T0 + 7 days);
    }

    function test_propose_descriptionLength() public {
        string memory max = string(new bytes(256));
        string memory tooLong = string(new bytes(257));
        string memory maxURI = string(new bytes(2048));
        string memory tooLongURI = string(new bytes(2049));

        vm.prank(alice);
        vm.expectRevert(SealedDAO.DescriptionTooLong.selector);
        dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, tooLong, "", TEN_MINUTES);

        vm.prank(alice);
        vm.expectRevert(SealedDAO.DescriptionURITooLong.selector);
        dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, max, tooLongURI, TEN_MINUTES);

        vm.prank(alice);
        uint256 id = dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, max, maxURI, TEN_MINUTES);
        assertEq(bytes(dao.proposal(id).description).length, 256);
        assertEq(bytes(dao.proposal(id).descriptionURI).length, 2048);
    }

    // ------------------------------------------------------------------
    // vote
    // ------------------------------------------------------------------

    function test_vote_storesCommitmentAndEmitsSealed() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes32 commitment = _commitment(id, bob, _for());
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);

        vm.expectEmit(address(dao));
        emit Sealed.Sealed(id, bob, commitment, ct);
        vm.prank(bob);
        dao.vote(id, commitment, ct);

        assertEq(dao.commitmentOf(id, bob), commitment);
        assertEq(dao.proposal(id).sealedCount, 1);
        assertEq(dao.proposal(id).revealedCount, 0);
    }

    function test_vote_revertsNotMember() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);
        vm.prank(eve);
        vm.expectRevert(SealedDAO.NotMember.selector);
        dao.vote(id, keccak256("x"), ct);
    }

    function test_vote_revertsSealingClosed() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);

        // unknown proposal
        vm.prank(alice);
        vm.expectRevert(Sealed.SealingClosed.selector);
        dao.vote(99, keccak256("x"), ct);

        // last second of sealing is fine, the close instant is not
        vm.warp(_closeTime(id) - 1);
        _vote(id, alice, _for());
        vm.warp(_closeTime(id));
        vm.prank(bob);
        vm.expectRevert(Sealed.SealingClosed.selector);
        dao.vote(id, keccak256("x"), ct);
        assertEq(dao.proposal(id).sealedCount, 1);
    }

    function test_vote_revertsAlreadySealed() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);
        vm.prank(alice);
        vm.expectRevert(Sealed.AlreadySealed.selector);
        dao.vote(id, keccak256("change my vote"), ct);
        assertEq(dao.proposal(id).sealedCount, 1);
    }

    function test_vote_ciphertextLengthBounds() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes memory tooShort = _ciphertext(358);
        bytes memory tooLong = _ciphertext(1025);
        bytes memory shortest = _ciphertext(359);
        bytes memory longest = _ciphertext(1024);

        vm.prank(alice);
        vm.expectRevert(Sealed.BadCiphertextLength.selector);
        dao.vote(id, keccak256("a"), tooShort);
        vm.prank(alice);
        vm.expectRevert(Sealed.BadCiphertextLength.selector);
        dao.vote(id, keccak256("a"), tooLong);

        vm.prank(alice);
        dao.vote(id, keccak256("a"), shortest);
        vm.prank(bob);
        dao.vote(id, keccak256("b"), longest);
        assertEq(dao.proposal(id).sealedCount, 2);
    }

    function test_vote_revertsBadCommitment() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);
        vm.startPrank(alice);
        vm.expectRevert(Sealed.BadCommitment.selector);
        dao.vote(id, bytes32(0), ct);
        vm.expectRevert(Sealed.BadCommitment.selector);
        dao.vote(id, REVEALED, ct);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Membership changes while a vote is open (PRD 4.3 edge cases, 7 "member removed while voting")
    // ------------------------------------------------------------------

    function test_membership_memberAddedMidVoteMayVote() public {
        // long vote P (7 days) is open while a short proposal Q adds eve and gets executed
        uint256 p = _propose(alice, SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, 7 days);
        uint256 q = _proposeSetMember(eve, true, TEN_MINUTES);
        _runToFinalized(q, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        dao.execute(q);
        assertTrue(dao.sealingOpen(p), "P still sealing");
        assertTrue(dao.isMember(eve));
        assertEq(dao.memberCount(), 5);

        _vote(p, alice, _for());
        _vote(p, bob, _for());
        _vote(p, carol, _for());
        _vote(p, dave, _against());
        _vote(p, eve, _against());
        SealedDAO.Proposal memory prop = dao.proposal(p);
        assertEq(prop.memberSnapshot, 4, "snapshot unchanged");
        assertEq(prop.sealedCount, 5, "sealedCount may exceed memberSnapshot");

        _warpToReveal(p);
        assertEq(
            _reveal(p, _addrs(alice, bob, carol, dave), _choices(_for(), _for(), _for(), _against())), 4, "revealed"
        );
        assertEq(_reveal(p, _addrs(eve), _choices(_against())), 1);
        _warpToRevealEnd(p);
        dao.finalize(p);
        prop = dao.proposal(p);
        assertEq(prop.revealedCount, 5);
        assertTrue(prop.passed);
    }

    function test_membership_removedMemberCannotSealButSealedVoteCounts() public {
        uint256 p = _propose(alice, SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, 7 days);
        _vote(p, dave, _for()); // dave seals before being removed
        uint256 removeDave = _proposeSetMember(dave, false, TEN_MINUTES);
        _runToFinalized(removeDave, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        dao.execute(removeDave);
        assertFalse(dao.isMember(dave));
        assertEq(dao.memberCount(), 3);
        assertTrue(dao.sealingOpen(p));

        // a removed member cannot seal anywhere, including a proposal whose snapshot included them
        uint256 other = _proposeTransfer(carol, 1);
        bytes32 commitment = _commitment(other, dave, _for());
        bytes memory ct = _ciphertext(VOTE_CT_LENGTH);
        vm.prank(dave);
        vm.expectRevert(SealedDAO.NotMember.selector);
        dao.vote(other, commitment, ct);

        // dave's vote sealed before the removal still counts toward quorum and is revealed normally
        _warpToReveal(p);
        assertEq(_reveal(p, _addrs(dave), _choices(_for())), 1);
        _warpToRevealEnd(p);
        dao.finalize(p);
        SealedDAO.Proposal memory prop = dao.proposal(p);
        assertEq(prop.sealedCount, 1);
        assertEq(prop.forCount, 1);
        // 1 sealed out of a snapshot of 4 members at 50%: no quorum
        assertFalse(prop.passed);
    }

    function test_membership_snapshotIsTakenAtPropose() public {
        uint256 before = _proposeSetMember(eve, true, TEN_MINUTES);
        _runToFinalized(before, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        dao.execute(before);
        uint256 afterAdd = _proposeTransfer(carol, 1);
        assertEq(dao.proposal(before).memberSnapshot, 4);
        assertEq(dao.proposal(afterAdd).memberSnapshot, 5);
    }

    // ------------------------------------------------------------------
    // finalize, quorum and outcome (D4)
    // ------------------------------------------------------------------

    function test_finalize_notReadyUntilRevealEnd() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());

        vm.expectRevert(SealedDAO.NotReady.selector);
        dao.finalize(id); // voting
        vm.warp(_revealEndTime(id) - 1);
        vm.expectRevert(SealedDAO.NotReady.selector);
        dao.finalize(id); // last second of the reveal window
        vm.expectRevert(SealedDAO.NotReady.selector);
        dao.finalize(99); // unknown

        vm.warp(_revealEndTime(id));
        dao.finalize(id);
        assertTrue(dao.proposal(id).finalized);
    }

    function test_finalize_revertsAlreadyFinalized() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _warpToRevealEnd(id);
        dao.finalize(id);
        vm.expectRevert(SealedDAO.AlreadyFinalized.selector);
        dao.finalize(id);
    }

    function test_finalize_emitsTally() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(id, bob, _against());
        _vote(id, carol, _abstain());
        _vote(id, dave, _for());
        _warpToReveal(id);
        _reveal(id, _addrs(alice, bob, carol), _choices(_for(), _against(), _abstain())); // dave never revealed
        _warpToRevealEnd(id);

        vm.expectEmit(address(dao));
        emit SealedDAO.Finalized(id, false, 1, 1, 1, 4, 3);
        dao.finalize(id);
        _assertStatus(id, SealedDAO.Status.Failed);
    }

    function test_quorum_exactQuorumPasses() public {
        // 4 members at 50%: 2 sealed votes is exactly quorum (2 * 10_000 >= 4 * 5_000)
        uint256 id = _proposeTransfer(carol, 1e6);
        _runToFinalized(id, _addrs(alice, bob), _choices(_for(), _for()));
        assertTrue(dao.proposal(id).passed);
        _assertStatus(id, SealedDAO.Status.Passed);
    }

    function test_quorum_oneShortFails() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _runToFinalized(id, _addrs(alice), _choices(_for()));
        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(p.forCount, 1);
        assertFalse(p.passed, "1 of 4 sealed is below 50%");
        _assertStatus(id, SealedDAO.Status.Failed);
    }

    function test_quorum_roundsUpForOddMemberCounts() public {
        // 3 members at 50%: quorum needs sealed * 10_000 >= 15_000, so 2 votes
        SealedDAO three = _deploy(_addrs(alice, bob, carol), QUORUM_BPS, BOUNTY);
        dao = three;
        uint256 one = _proposeTransfer(carol, 1);
        _runToFinalized(one, _addrs(alice), _choices(_for()));
        assertFalse(dao.proposal(one).passed);
        uint256 two = _proposeTransfer(carol, 1);
        _runToFinalized(two, _addrs(alice, bob), _choices(_for(), _abstain()));
        assertTrue(dao.proposal(two).passed);
    }

    function test_outcome_tieFails() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _runToFinalized(id, _addrs(alice, bob, carol, dave), _choices(_for(), _for(), _against(), _against()));
        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(p.forCount, p.againstCount);
        assertFalse(p.passed);
    }

    function test_outcome_allAbstainFails() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _runToFinalized(id, _addrs(alice, bob, carol), _choices(_abstain(), _abstain(), _abstain()));
        assertEq(dao.proposal(id).abstainCount, 3);
        assertFalse(dao.proposal(id).passed);
    }

    function test_outcome_unrevealedVotesCountTowardQuorumOnly() public {
        // 3 sealed, only alice's For is revealed: quorum (3 of 4) is met and 1 For > 0 Against, so it passes even
        // though the two unrevealed votes were Against
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(id, bob, _against());
        _vote(id, carol, _against());
        _warpToReveal(id);
        _reveal(id, _addrs(alice), _choices(_for()));
        _warpToRevealEnd(id);
        dao.finalize(id);
        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(p.sealedCount, 3);
        assertEq(p.revealedCount, 1);
        assertEq(p.againstCount, 0);
        assertTrue(p.passed);

        // and unrevealed votes alone never pass anything
        uint256 silent = _proposeTransfer(carol, 1e6);
        _vote(silent, alice, _for());
        _vote(silent, bob, _for());
        _warpToRevealEnd(silent);
        dao.finalize(silent);
        assertFalse(dao.proposal(silent).passed);
    }

    // ------------------------------------------------------------------
    // execute
    // ------------------------------------------------------------------

    function test_execute_transferCreditsClaimable() public {
        uint256 id = _passedTransfer(carol, 5e6);
        uint256 reserved = dao.totalClaimable(); // bounty of the reveal
        uint256 balance = usdc.balanceOf(address(dao));

        vm.expectEmit(address(dao));
        emit SealedDAO.Executed(id);
        vm.prank(outsider); // anyone may execute
        dao.execute(id);

        assertEq(dao.claimable(carol), 5e6);
        assertEq(dao.totalClaimable(), reserved + 5e6);
        assertEq(usdc.balanceOf(address(dao)), balance, "nothing is pushed");
        assertTrue(dao.proposal(id).executed);
        _assertStatus(id, SealedDAO.Status.Executed);
    }

    function test_execute_revertsNotReadyNotPassedAlreadyExecuted() public {
        vm.expectRevert(SealedDAO.NotReady.selector);
        dao.execute(99); // unknown

        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(id, bob, _for());
        _warpToReveal(id);
        _reveal(id, _addrs(alice, bob), _choices(_for(), _for()));
        _warpToRevealEnd(id);
        vm.expectRevert(SealedDAO.NotReady.selector);
        dao.execute(id); // Ready, not finalized
        dao.finalize(id);
        dao.execute(id);
        vm.expectRevert(SealedDAO.AlreadyExecuted.selector);
        dao.execute(id);

        uint256 failed = _proposeTransfer(carol, 1e6);
        _runToFinalized(failed, _addrs(alice, bob), _choices(_against(), _against()));
        vm.expectRevert(SealedDAO.NotPassed.selector);
        dao.execute(failed);
    }

    function test_execute_expiryBoundary() public {
        uint256 id = _passedTransfer(carol, 1e6);
        uint256 graceEnd = _graceEndTime(id);

        vm.warp(graceEnd);
        _assertStatus(id, SealedDAO.Status.Passed);
        uint256 snap = vm.snapshotState();
        dao.execute(id); // the last second of the grace period is still in time
        _assertStatus(id, SealedDAO.Status.Executed);
        vm.revertToState(snap);

        vm.warp(graceEnd + 1);
        _assertStatus(id, SealedDAO.Status.Expired);
        vm.expectRevert(SealedDAO.Expired.selector);
        dao.execute(id);
        vm.warp(graceEnd + 365 days);
        _assertStatus(id, SealedDAO.Status.Expired);
    }

    function test_execute_revertsInsufficientTreasury() public {
        uint256 id = _passedTransfer(carol, TREASURY); // the reveal bounty already reserved part of the treasury
        assertEq(dao.totalClaimable(), 3 * BOUNTY);
        vm.expectRevert(SealedDAO.InsufficientTreasury.selector);
        dao.execute(id);

        // topping up the free balance by a plain transfer makes it executable
        _fund(dao, 3 * BOUNTY);
        dao.execute(id);
        assertEq(dao.totalClaimable(), usdc.balanceOf(address(dao)));
    }

    function test_execute_setMemberAddAndRemove() public {
        uint256 add = _proposeSetMember(eve, true, TEN_MINUTES);
        _runToFinalized(add, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        vm.expectEmit(address(dao));
        emit SealedDAO.MemberSet(eve, true);
        vm.expectEmit(address(dao));
        emit SealedDAO.Executed(add);
        dao.execute(add);
        assertTrue(dao.isMember(eve));
        assertEq(dao.memberCount(), 5);

        uint256 remove = _proposeSetMember(bob, false, TEN_MINUTES);
        _runToFinalized(remove, _addrs(alice, carol, eve), _choices(_for(), _for(), _for()));
        vm.expectEmit(address(dao));
        emit SealedDAO.MemberSet(bob, false);
        dao.execute(remove);
        assertFalse(dao.isMember(bob));
        assertEq(dao.memberCount(), 4);
        assertEq(dao.totalClaimable(), 6 * BOUNTY, "SetMember moves no USDC");
    }

    function test_execute_setMemberNoOp() public {
        // both are valid at propose time; the no-op is only detected at execute
        uint256 addExisting = _proposeSetMember(bob, true, TEN_MINUTES);
        uint256 removeOutsider = _proposeSetMember(eve, false, TEN_MINUTES);
        address[] memory voters = _addrs(alice, bob, carol);
        SealedDAO.Choice[] memory choices = _choices(_for(), _for(), _for());
        for (uint256 i; i < voters.length; ++i) {
            _vote(addExisting, voters[i], choices[i]);
            _vote(removeOutsider, voters[i], choices[i]);
        }
        _warpToReveal(addExisting); // both proposals share the close round
        _reveal(addExisting, voters, choices);
        _reveal(removeOutsider, voters, choices);
        _warpToRevealEnd(addExisting);
        dao.finalize(addExisting);
        dao.finalize(removeOutsider);

        vm.expectRevert(SealedDAO.NoOp.selector);
        dao.execute(addExisting);
        vm.expectRevert(SealedDAO.NoOp.selector);
        dao.execute(removeOutsider);
        assertEq(dao.memberCount(), 4);
        assertFalse(dao.proposal(addExisting).executed);
        _assertStatus(addExisting, SealedDAO.Status.Passed);
    }

    function test_execute_setMemberRevertsLastMember() public {
        // two members vote to remove each other; the second removal would leave nobody who can propose (audit F7)
        dao = _deploy(_addrs(alice, bob), QUORUM_BPS, BOUNTY);
        _fund(dao, TREASURY);
        uint256 removeBob = _proposeSetMember(bob, false, TEN_MINUTES);
        uint256 removeAlice = _proposeSetMember(alice, false, TEN_MINUTES);
        address[] memory voters = _addrs(alice, bob);
        SealedDAO.Choice[] memory choices = _choices(_for(), _for());
        for (uint256 i; i < voters.length; ++i) {
            _vote(removeBob, voters[i], choices[i]);
            _vote(removeAlice, voters[i], choices[i]);
        }
        _warpToReveal(removeBob); // both proposals share the close round
        _reveal(removeBob, voters, choices);
        _reveal(removeAlice, voters, choices);
        _warpToRevealEnd(removeBob);
        dao.finalize(removeBob);
        dao.finalize(removeAlice);

        dao.execute(removeBob);
        assertEq(dao.memberCount(), 1);
        vm.expectRevert(SealedDAO.LastMember.selector);
        dao.execute(removeAlice);
        assertTrue(dao.isMember(alice));
        assertEq(dao.memberCount(), 1);
        _assertStatus(removeAlice, SealedDAO.Status.Passed);
        vm.warp(_graceEndTime(removeAlice) + 1);
        _assertStatus(removeAlice, SealedDAO.Status.Expired);
    }

    // ------------------------------------------------------------------
    // claim and funding
    // ------------------------------------------------------------------

    function test_claim_transfersAndZeroes() public {
        uint256 id = _passedTransfer(carol, 5e6);
        dao.execute(id);
        uint256 reservedBefore = dao.totalClaimable();

        vm.expectEmit(address(dao));
        emit SealedDAO.Claimed(carol, 5e6);
        vm.prank(carol);
        dao.claim();

        assertEq(usdc.balanceOf(carol), 5e6);
        assertEq(dao.claimable(carol), 0);
        assertEq(dao.totalClaimable(), reservedBefore - 5e6);
        assertEq(usdc.balanceOf(address(dao)), TREASURY - 5e6);

        // the revealer claims the bounty the same way
        vm.prank(revealer);
        dao.claim();
        assertEq(usdc.balanceOf(revealer), 3 * BOUNTY);
        assertEq(dao.totalClaimable(), 0);
    }

    function test_claim_twiceReverts() public {
        uint256 id = _passedTransfer(carol, 5e6);
        dao.execute(id);
        vm.startPrank(carol);
        dao.claim();
        vm.expectRevert(SealedDAO.NothingToClaim.selector);
        dao.claim();
        vm.stopPrank();

        vm.prank(outsider);
        vm.expectRevert(SealedDAO.NothingToClaim.selector);
        dao.claim();
    }

    function test_funding_plainTransferIsTheTreasury() public {
        SealedDAO empty = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, 0);
        dao = empty;
        uint256 id = _passedTransfer(carol, 7e6);
        vm.expectRevert(SealedDAO.InsufficientTreasury.selector);
        dao.execute(id);

        _fund(dao, 7e6); // anyone may fund with a plain ERC-20 transfer; no receive / deposit function
        dao.execute(id);
        assertEq(dao.totalClaimable(), usdc.balanceOf(address(dao)));
        vm.prank(carol);
        dao.claim();
        assertEq(usdc.balanceOf(address(dao)), 0);
        assertEq(dao.totalClaimable(), 0);
    }

    function test_funding_nativeValueTransferReverts() public {
        vm.deal(funder, 1 ether);
        vm.prank(funder);
        (bool ok,) = address(dao).call{value: 1}("");
        assertFalse(ok, "no receive: fund with usdc.transfer");
    }

    function test_claim_bubblesTokenRevertAndChecksReturn() public {
        WeirdUSDC weird = new WeirdUSDC();
        SealedDAO wdao = new SealedDAO(address(weird), _addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        weird.mint(address(wdao), TREASURY);
        dao = wdao;
        dao.execute(_passedTransfer(carol, 5e6));

        weird.setMode(WeirdUSDC.Mode.ReturnFalse);
        vm.prank(carol);
        vm.expectRevert(SealedDAO.TransferFailed.selector);
        dao.claim();

        weird.setMode(WeirdUSDC.Mode.RevertEmpty);
        vm.prank(carol);
        vm.expectRevert(SealedDAO.TransferFailed.selector);
        dao.claim();

        weird.setMode(WeirdUSDC.Mode.ReturnNothing);
        vm.prank(carol);
        vm.expectRevert(SealedDAO.TransferFailed.selector);
        dao.claim();
        assertEq(dao.claimable(carol), 5e6, "still claimable after every failure");

        weird.setMode(WeirdUSDC.Mode.Normal);
        vm.prank(carol);
        dao.claim();
        assertEq(weird.balanceOf(carol), 5e6);
    }

    function test_reentrancy_claimExecuteAndRevealBatchAreLocked() public {
        WeirdUSDC weird = new WeirdUSDC();
        SealedDAO wdao = new SealedDAO(address(weird), _addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        weird.mint(address(wdao), TREASURY);
        dao = wdao;
        uint256 paid = _passedTransfer(carol, 5e6);
        dao.execute(paid);
        uint256 pending = _passedTransfer(carol, 1e6);

        // a hostile token re-enters claim() from inside the transfer of claim()
        weird.setHook(address(dao), abi.encodeCall(SealedDAO.claim, ()));
        vm.prank(carol);
        dao.claim();
        assertFalse(weird.hookSucceeded());
        assertEq(bytes4(weird.hookResult()), SealedDAO.Reentrancy.selector);
        assertEq(weird.balanceOf(carol), 5e6, "paid once");

        // and execute() from inside the transfer of claim()
        weird.setHook(address(dao), abi.encodeCall(SealedDAO.execute, (pending)));
        vm.prank(revealer);
        dao.claim();
        assertFalse(weird.hookSucceeded());
        assertEq(bytes4(weird.hookResult()), SealedDAO.Reentrancy.selector);
        assertFalse(dao.proposal(pending).executed);

        // the lock is released after each call
        dao.execute(pending);
        assertTrue(dao.proposal(pending).executed);

        // and revealBatch() from inside the transfer of claim() (audit F3): it would read the pre-transfer balance
        uint256 open = _proposeTransfer(carol, 1);
        _vote(open, alice, _for());
        _vote(open, bob, _for());
        _warpToReveal(open);
        bytes32[] memory salts = new bytes32[](2);
        (salts[0], salts[1]) = (_salt(open, alice), _salt(open, bob));
        weird.setHook(
            address(dao),
            abi.encodeCall(SealedDAO.revealBatch, (open, _addrs(alice, bob), _choices(_for(), _for()), salts))
        );
        vm.prank(carol);
        dao.claim();
        assertFalse(weird.hookSucceeded());
        assertEq(bytes4(weird.hookResult()), SealedDAO.Reentrancy.selector);
        assertEq(dao.proposal(open).revealedCount, 0);
        assertEq(weird.balanceOf(carol), 6e6, "both payouts claimed once");

        // released again: the same reveal goes through outside the callback
        assertEq(_reveal(open, _addrs(alice, bob), _choices(_for(), _for())), 2);
    }

    // ------------------------------------------------------------------
    // status transitions
    // ------------------------------------------------------------------

    function test_status_passedLifecycleAtExactBoundaries() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _assertStatus(id, SealedDAO.Status.Voting);
        _vote(id, alice, _for());
        _vote(id, bob, _for());

        vm.warp(_closeTime(id) - 1);
        _assertStatus(id, SealedDAO.Status.Voting);
        vm.warp(_closeTime(id));
        _assertStatus(id, SealedDAO.Status.Revealing);
        _reveal(id, _addrs(alice, bob), _choices(_for(), _for()));
        vm.warp(_revealEndTime(id) - 1);
        _assertStatus(id, SealedDAO.Status.Revealing);
        vm.warp(_revealEndTime(id));
        _assertStatus(id, SealedDAO.Status.Ready);
        dao.finalize(id);
        _assertStatus(id, SealedDAO.Status.Passed);
        dao.execute(id);
        _assertStatus(id, SealedDAO.Status.Executed);
        vm.warp(_graceEndTime(id) + 1);
        _assertStatus(id, SealedDAO.Status.Executed); // Executed wins over Expired
    }

    function test_status_failedIsTerminal() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _runToFinalized(id, _addrs(alice), _choices(_for()));
        _assertStatus(id, SealedDAO.Status.Failed);
        vm.warp(_graceEndTime(id) + 1);
        _assertStatus(id, SealedDAO.Status.Failed);
    }

    function test_status_readyUntilFinalizedThenLateFinalizeExpires() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(id, bob, _for());
        _warpToReveal(id);
        _reveal(id, _addrs(alice, bob), _choices(_for(), _for()));
        vm.warp(_graceEndTime(id) + 1);
        _assertStatus(id, SealedDAO.Status.Ready); // never finalized: stays Ready
        dao.finalize(id); // finalize has no deadline
        _assertStatus(id, SealedDAO.Status.Expired);
        vm.expectRevert(SealedDAO.Expired.selector);
        dao.execute(id);
    }

    function test_status_revertsUnknownProposal() public {
        vm.expectRevert(SealedDAO.UnknownProposal.selector);
        dao.status(0);
        vm.expectRevert(SealedDAO.UnknownProposal.selector);
        dao.status(1);
    }

    // ------------------------------------------------------------------
    // views
    // ------------------------------------------------------------------

    function test_hashVote_isAbiEncodeAndDomainSeparated() public view {
        bytes32 salt = keccak256("salt");
        bytes32 h = dao.hashVote(1, alice, SealedDAO.Choice.For, salt);
        assertEq(h, keccak256(abi.encode(uint256(1), alice, uint8(1), salt)));
        assertTrue(h != dao.hashVote(2, alice, SealedDAO.Choice.For, salt), "proposal id");
        assertTrue(h != dao.hashVote(1, bob, SealedDAO.Choice.For, salt), "voter");
        assertTrue(h != dao.hashVote(1, alice, SealedDAO.Choice.Against, salt), "choice");
        assertTrue(h != dao.hashVote(1, alice, SealedDAO.Choice.For, keccak256("other")), "salt");
    }

    function test_views_unknownProposalAndCommitment() public view {
        SealedDAO.Proposal memory p = dao.proposal(42);
        assertEq(p.proposer, address(0));
        assertEq(p.closeRound, 0);
        assertEq(dao.commitmentOf(42, alice), bytes32(0));
        assertFalse(dao.sealingOpen(42));
        assertFalse(dao.revealOpen(42));
    }
}
