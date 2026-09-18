// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Test.sol";
import {Sealed} from "../../src/Sealed.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "./SealedDAOBase.t.sol";

/// @notice SealedDAO.revealBatch (PRD 4.3, D6, D9): window, array checks, skip-not-revert, tally and bounty.
contract SealedDAORevealBatchTest is SealedDAOBaseTest {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _proposeTransfer(carol, 1e6);
    }

    function _salts(uint256 proposalId, address[] memory voters) internal pure returns (bytes32[] memory salts) {
        salts = new bytes32[](voters.length);
        for (uint256 i; i < voters.length; ++i) {
            salts[i] = _salt(proposalId, voters[i]);
        }
    }

    function test_revealBatch_countsEmitsAndCreditsBounty() public {
        bytes32 ca = _vote(id, alice, _for());
        bytes32 cb = _vote(id, bob, _against());
        bytes32 cc = _vote(id, carol, _abstain());
        _warpToReveal(id);

        address[] memory voters = _addrs(alice, bob, carol);
        SealedDAO.Choice[] memory choices = _choices(_for(), _against(), _abstain());
        bytes32[] memory salts = _salts(id, voters);
        vm.expectEmit(address(dao));
        emit Sealed.Revealed(id, alice, ca);
        vm.expectEmit(address(dao));
        emit SealedDAO.VoteRevealed(id, alice, SealedDAO.Choice.For);
        vm.expectEmit(address(dao));
        emit Sealed.Revealed(id, bob, cb);
        vm.expectEmit(address(dao));
        emit SealedDAO.VoteRevealed(id, bob, SealedDAO.Choice.Against);
        vm.expectEmit(address(dao));
        emit Sealed.Revealed(id, carol, cc);
        vm.expectEmit(address(dao));
        emit SealedDAO.VoteRevealed(id, carol, SealedDAO.Choice.Abstain);
        vm.expectEmit(address(dao));
        emit SealedDAO.BountyCredited(id, revealer, 3 * BOUNTY);
        vm.prank(revealer);
        uint32 revealed = dao.revealBatch(id, voters, choices, salts);

        assertEq(revealed, 3);
        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(p.revealedCount, 3);
        assertEq(p.forCount, 1);
        assertEq(p.againstCount, 1);
        assertEq(p.abstainCount, 1);
        assertEq(p.sealedCount, 3);
        assertEq(dao.commitmentOf(id, alice), REVEALED);
        assertEq(dao.commitmentOf(id, bob), REVEALED);
        assertEq(dao.claimable(revealer), 3 * BOUNTY);
        assertEq(dao.totalClaimable(), 3 * BOUNTY);
    }

    function test_revealBatch_mixedValidInvalidDuplicateUnknown() public {
        _vote(id, alice, _for());
        _vote(id, bob, _for());
        _vote(id, carol, _against());
        _vote(id, dave, _against());
        _warpToReveal(id);

        // 0 alice valid | 1 bob wrong salt | 2 alice duplicate | 3 eve never sealed (not a member)
        // 4 carol wrong choice | 5 dave valid | 6 zero address
        address[] memory voters = new address[](7);
        (voters[0], voters[1], voters[2], voters[3], voters[4], voters[5], voters[6]) =
        (alice, bob, alice, eve, carol, dave, address(0));
        SealedDAO.Choice[] memory choices = new SealedDAO.Choice[](7);
        (choices[0], choices[1], choices[2], choices[3], choices[4], choices[5], choices[6]) =
        (_for(), _for(), _for(), _for(), _for(), _against(), _abstain());
        bytes32[] memory salts = _salts(id, voters);
        salts[1] = keccak256("wrong salt");

        vm.recordLogs();
        vm.prank(revealer);
        uint32 revealed = dao.revealBatch(id, voters, choices, salts);
        assertEq(revealed, 2);

        uint256 skipped;
        uint256 counted;
        bytes32 skippedSig = SealedDAO.RevealSkipped.selector;
        bytes32 revealedSig = SealedDAO.VoteRevealed.selector;
        address[5] memory expectedSkips = [bob, alice, eve, carol, address(0)];
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == skippedSig) {
                assertEq(address(uint160(uint256(logs[i].topics[2]))), expectedSkips[skipped], "skip order");
                ++skipped;
            } else if (logs[i].topics[0] == revealedSig) {
                ++counted;
            }
        }
        assertEq(skipped, 5);
        assertEq(counted, 2);

        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(p.forCount, 1);
        assertEq(p.againstCount, 1);
        assertEq(p.revealedCount, 2);
        assertEq(dao.claimable(revealer), 2 * BOUNTY, "bounty only for counted votes");
        assertEq(dao.commitmentOf(id, dave), REVEALED);
        assertTrue(dao.commitmentOf(id, bob) != REVEALED, "a skipped item consumes nothing");
    }

    function test_revealBatch_skippedItemRevealsLaterAndRevealedItemIsSkipped() public {
        _vote(id, alice, _for());
        _vote(id, bob, _against());
        _warpToReveal(id);

        bytes32[] memory wrong = new bytes32[](1);
        wrong[0] = keccak256("wrong");
        vm.prank(revealer);
        assertEq(dao.revealBatch(id, _addrs(bob), _choices(_against()), wrong), 0);

        // the correct item for bob now reveals; alice is revealed first, then submitted again and skipped
        assertEq(_reveal(id, _addrs(alice, bob), _choices(_for(), _against())), 2);
        vm.expectEmit(address(dao));
        emit SealedDAO.RevealSkipped(id, alice);
        assertEq(_reveal(id, _addrs(alice), _choices(_for())), 0);
        assertEq(dao.proposal(id).revealedCount, 2);
        assertEq(dao.claimable(revealer), 2 * BOUNTY);
    }

    function test_revealBatch_replayAcrossProposalsAndVotersIsSkipped() public {
        uint256 other = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(other, alice, _against());
        _vote(id, bob, _against());
        _warpToReveal(id);

        // alice's (choice, salt) of `id` replayed on `other`, and alice's item replayed for bob
        bytes32[] memory aliceSalt = new bytes32[](1);
        aliceSalt[0] = _salt(id, alice);
        vm.startPrank(revealer);
        assertEq(dao.revealBatch(other, _addrs(alice), _choices(_for()), aliceSalt), 0, "cross-proposal");
        assertEq(dao.revealBatch(id, _addrs(bob), _choices(_for()), aliceSalt), 0, "cross-voter");
        vm.stopPrank();
        assertEq(dao.proposal(id).revealedCount + dao.proposal(other).revealedCount, 0);
    }

    function test_revealBatch_windowBoundaries() public {
        _vote(id, alice, _for());
        address[] memory none = new address[](0);
        SealedDAO.Choice[] memory noChoices = new SealedDAO.Choice[](0);
        bytes32[] memory noSalts = new bytes32[](0);

        // an out-of-window batch reverts even if every item would be skipped
        vm.warp(_closeTime(id) - 1);
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        dao.revealBatch(id, none, noChoices, noSalts);
        vm.expectRevert(Sealed.RevealNotOpen.selector);
        dao.revealBatch(99, none, noChoices, noSalts);

        vm.warp(_revealEndTime(id));
        vm.expectRevert(Sealed.RevealClosed.selector);
        dao.revealBatch(id, none, noChoices, noSalts);

        vm.warp(_revealEndTime(id) - 1); // last second of the window
        assertEq(_reveal(id, _addrs(alice), _choices(_for())), 1);

        uint256 second = _proposeTransfer(carol, 1e6);
        _vote(second, bob, _for());
        vm.warp(_closeTime(second)); // first second of the window
        assertEq(_reveal(second, _addrs(bob), _choices(_for())), 1);
    }

    function test_revealBatch_revertsLengthMismatch() public {
        _warpToReveal(id);
        vm.expectRevert(SealedDAO.LengthMismatch.selector);
        dao.revealBatch(id, _addrs(alice, bob), _choices(_for()), new bytes32[](2));
        vm.expectRevert(SealedDAO.LengthMismatch.selector);
        dao.revealBatch(id, _addrs(alice, bob), _choices(_for(), _for()), new bytes32[](3));
    }

    function test_revealBatch_maxItems() public {
        _vote(id, alice, _for());
        _warpToReveal(id);

        // 256 items (one valid, 255 unknown voters) are accepted and never revert
        address[] memory voters = _members(256, 7);
        voters[128] = alice;
        SealedDAO.Choice[] memory choices = new SealedDAO.Choice[](256);
        choices[128] = _for();
        bytes32[] memory salts = new bytes32[](256);
        salts[128] = _salt(id, alice);
        vm.prank(revealer);
        assertEq(dao.revealBatch(id, voters, choices, salts), 1);

        vm.expectRevert(SealedDAO.TooManyItems.selector);
        dao.revealBatch(id, new address[](257), new SealedDAO.Choice[](257), new bytes32[](257));
    }

    function test_revealBatch_invalidChoiceRevertsWholeCall() public {
        _vote(id, alice, _for());
        _warpToReveal(id);

        // Choice has 3 members: an out-of-range value fails ABI decoding and reverts the whole call, valid items too
        uint8[] memory rawChoices = new uint8[](2);
        rawChoices[0] = 1; // alice's valid For
        rawChoices[1] = 3;
        bytes memory data = abi.encodeWithSelector(
            SealedDAO.revealBatch.selector, id, _addrs(alice, bob), rawChoices, _salts(id, _addrs(alice, bob))
        );
        vm.prank(revealer);
        (bool ok, bytes memory ret) = address(dao).call(data);
        assertFalse(ok);
        assertEq(ret.length, 0, "decoder revert carries no data");
        assertTrue(dao.commitmentOf(id, alice) != REVEALED);

        // the same batch with a valid second choice goes through
        rawChoices[1] = 2;
        data = abi.encodeWithSelector(
            SealedDAO.revealBatch.selector, id, _addrs(alice, bob), rawChoices, _salts(id, _addrs(alice, bob))
        );
        vm.prank(revealer);
        (ok, ret) = address(dao).call(data);
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint32)), 1);
    }

    function test_revealBatch_emptyAndAllSkippedChangeNothing() public {
        _vote(id, alice, _for());
        _warpToReveal(id);
        vm.recordLogs();
        vm.prank(revealer);
        assertEq(dao.revealBatch(id, new address[](0), new SealedDAO.Choice[](0), new bytes32[](0)), 0);
        assertEq(vm.getRecordedLogs().length, 0);

        bytes32[] memory wrong = new bytes32[](1);
        wrong[0] = keccak256("wrong");
        vm.prank(revealer);
        assertEq(dao.revealBatch(id, _addrs(alice), _choices(_for()), wrong), 0);
        assertEq(dao.proposal(id).revealedCount, 0);
        assertEq(dao.claimable(revealer), 0, "no bounty without a revealed vote");
    }

    function test_revealBatch_anyoneMayRevealAndIsPaid() public {
        _vote(id, alice, _for());
        _vote(id, bob, _for()); // 2 of 4: quorum met
        _warpToReveal(id);
        bytes32[] memory salts = _salts(id, _addrs(alice));
        vm.prank(eve); // not a member
        assertEq(dao.revealBatch(id, _addrs(alice), _choices(_for()), salts), 1);
        assertEq(dao.claimable(eve), BOUNTY);
    }

    /// Audit F1: a proposal below quorum can never pass, so revealing it changes no outcome and pays no bounty. Without
    /// this, one member could farm the bounty with throwaway proposals (test/audit/F1_BountyFarming.t.sol).
    function test_revealBatch_noBountyBelowQuorum() public {
        _vote(id, alice, _for()); // 1 of 4 sealed: quorum (50%) not met
        _warpToReveal(id);
        vm.recordLogs();
        assertEq(_reveal(id, _addrs(alice), _choices(_for())), 1, "the reveal still counts");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2, "Revealed + VoteRevealed only: neither BountyCredited nor BountySkipped");
        assertEq(dao.proposal(id).forCount, 1);
        assertEq(dao.claimable(revealer), 0);
        assertEq(dao.totalClaimable(), 0);
    }

    /// The quorum condition is exactly finalize's: at the boundary (2 of 4 at 50%) the bounty is credited.
    function test_revealBatch_bountyFromExactQuorum() public {
        uint256 below = _proposeTransfer(carol, 1e6); // same close round as `id`
        _vote(id, alice, _for());
        _vote(id, bob, _against());
        _vote(below, alice, _for());
        _warpToReveal(id);

        vm.expectEmit(address(dao));
        emit SealedDAO.BountyCredited(id, revealer, BOUNTY);
        assertEq(_reveal(id, _addrs(alice), _choices(_for())), 1);
        assertEq(_reveal(below, _addrs(alice), _choices(_for())), 1);
        assertEq(dao.claimable(revealer), BOUNTY, "only the proposal at quorum pays");

        // a later batch of the same proposal is paid too: sealedCount is final once sealing closed
        vm.expectEmit(address(dao));
        emit SealedDAO.BountyCredited(id, revealer, BOUNTY);
        assertEq(_reveal(id, _addrs(bob), _choices(_against())), 1);
        assertEq(dao.claimable(revealer), 2 * BOUNTY);
    }

    function test_revealBatch_bountySkippedWhenTreasuryShort() public {
        SealedDAO unfunded = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        dao = unfunded;
        uint256 pid = _proposeTransfer(carol, 1e6);
        _vote(pid, alice, _for());
        _vote(pid, bob, _for());
        _warpToReveal(pid);

        vm.expectEmit(address(dao));
        emit SealedDAO.BountySkipped(pid);
        assertEq(_reveal(pid, _addrs(alice, bob), _choices(_for(), _for())), 2, "reveals still count");
        assertEq(dao.proposal(pid).forCount, 2);
        assertEq(dao.claimable(revealer), 0);
        assertEq(dao.totalClaimable(), 0);
    }

    function test_revealBatch_bountyIsAllOrNothingAndIgnoresReservedFunds() public {
        SealedDAO small = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        dao = small;
        _fund(dao, 2 * BOUNTY + 1); // covers 2 bounties, not 3
        uint256 pid = _proposeTransfer(carol, 1e6);
        _vote(pid, alice, _for());
        _vote(pid, bob, _for());
        _vote(pid, carol, _for());
        _vote(pid, dave, _for());
        _warpToReveal(pid);

        vm.expectEmit(address(dao));
        emit SealedDAO.BountySkipped(pid);
        assertEq(_reveal(pid, _addrs(alice, bob, carol), _choices(_for(), _for(), _for())), 3);
        assertEq(dao.claimable(revealer), 0, "3 bounties are not covered: none is paid");

        vm.expectEmit(address(dao));
        emit SealedDAO.BountyCredited(pid, revealer, BOUNTY);
        assertEq(_reveal(pid, _addrs(dave), _choices(_for())), 1);
        assertEq(dao.totalClaimable(), BOUNTY);

        // the reserved bounty is not free treasury: a later batch that would need it is skipped
        uint256 next = _proposeTransfer(carol, 1e6);
        _vote(next, alice, _for());
        _vote(next, bob, _for());
        _warpToReveal(next);
        vm.expectEmit(address(dao));
        emit SealedDAO.BountySkipped(next);
        _reveal(next, _addrs(alice, bob), _choices(_for(), _for()));
        assertLe(dao.totalClaimable(), usdc.balanceOf(address(dao)));
    }

    function test_revealBatch_zeroBountyEmitsNoBountyEvent() public {
        SealedDAO free = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, 0);
        dao = free;
        _fund(dao, TREASURY);
        uint256 pid = _proposeTransfer(carol, 1e6);
        _vote(pid, alice, _for());
        _vote(pid, bob, _for()); // quorum met, so only the zero bounty explains the missing event
        _warpToReveal(pid);
        vm.recordLogs();
        assertEq(_reveal(pid, _addrs(alice), _choices(_for())), 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2, "Revealed + VoteRevealed only");
        assertEq(dao.totalClaimable(), 0);
    }

    /// @dev Documents a limit of D10 / D11 (docs/THREATS.md): the ciphertext is never checked against the commitment.
    ///      A voter who seals a ciphertext of something else keeps the option to reveal their committed vote from
    ///      their own receipt, or to stay silent (counted for quorum only), after seeing the others' decrypted votes.
    ///      The committed choice itself can never change.
    function test_revealBatch_selectiveDisclosureIsOnlyRevealOrAbstain() public {
        _vote(id, alice, _for());
        _vote(id, bob, _against()); // bob's ciphertext would decrypt to garbage; only his receipt opens the commitment
        _warpToReveal(id);
        assertEq(_reveal(id, _addrs(alice), _choices(_for())), 1);

        // bob cannot switch sides with his own salt: a different choice never matches his commitment
        assertEq(_reveal(id, _addrs(bob), _choices(_for())), 0);
        // he can only reveal what he committed to (or never reveal it)
        assertEq(_reveal(id, _addrs(bob), _choices(_against())), 1);
        assertEq(dao.proposal(id).againstCount, 1);
    }

    function test_revealBatch_hugeBountyCannotBlockReveals() public {
        SealedDAO greedy = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, type(uint256).max);
        dao = greedy;
        _fund(dao, TREASURY);
        uint256 pid = _proposeTransfer(carol, 1e6);
        _vote(pid, alice, _for());
        _vote(pid, bob, _for());
        _warpToReveal(pid);
        vm.expectEmit(address(dao));
        emit SealedDAO.BountySkipped(pid);
        assertEq(_reveal(pid, _addrs(alice, bob), _choices(_for(), _for())), 2, "no overflow panic");
    }
}
