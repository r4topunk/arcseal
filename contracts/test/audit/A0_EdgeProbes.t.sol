// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "../../src/Sealed.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Phase 4 security review: adversarial edge probes that found no defect. They back the coverage table of the
///         review (PRD 7, 4.3) where the existing suites had no direct test.
/// @dev All tests PASS on the current code. Run: cd contracts && forge test --match-contract AuditA0 -vv
contract AuditA0EdgeProbesTest is SealedDAOBaseTest {
    /// Ids 0 and proposalCount + 1 on every entry point: nothing opens, counts or pays for a proposal that does not exist.
    function test_nonexistentIdsOnEveryFunction() public {
        uint256 live = _proposeTransfer(carol, 1e6);
        uint256[2] memory ghosts = [uint256(0), live + 1];
        for (uint256 i; i < ghosts.length; ++i) {
            uint256 ghost = ghosts[i];
            vm.prank(alice);
            vm.expectRevert(Sealed.SealingClosed.selector);
            dao.vote(ghost, keccak256("c"), _ciphertext(VOTE_CT_LENGTH));

            bytes32[] memory salts = new bytes32[](1);
            vm.expectRevert(Sealed.RevealNotOpen.selector);
            dao.revealBatch(ghost, _addrs(alice), _choices(_for()), salts);

            vm.expectRevert(SealedDAO.NotReady.selector);
            dao.finalize(ghost);
            vm.expectRevert(SealedDAO.NotReady.selector);
            dao.execute(ghost);
            vm.expectRevert(SealedDAO.UnknownProposal.selector);
            dao.status(ghost);

            assertEq(dao.proposal(ghost).closeRound, 0);
            assertEq(dao.commitmentOf(ghost, alice), bytes32(0));
            assertFalse(dao.sealingOpen(ghost));
            assertFalse(dao.revealOpen(ghost));
        }
        // even far in the future
        vm.warp(block.timestamp + 400 days);
        vm.expectRevert(SealedDAO.NotReady.selector);
        dao.finalize(live + 1);
        assertEq(dao.proposalCount(), live);
    }

    /// execute(TransferUSDC) at the exact free-treasury boundary: equal passes, one unit short reverts.
    function test_executeAtExactTreasuryBoundary() public {
        uint256 amount = TREASURY - 6 * BOUNTY; // what is left after the two proposals' reveal bounties
        uint256 exact = _passedTransfer(carol, amount);
        uint256 short = _passedTransfer(dave, 1);
        assertEq(usdc.balanceOf(address(dao)) - dao.totalClaimable(), amount);
        dao.execute(exact);
        assertEq(usdc.balanceOf(address(dao)), dao.totalClaimable(), "fully reserved");
        vm.expectRevert(SealedDAO.InsufficientTreasury.selector);
        dao.execute(short);
    }

    /// A proposal made by a member who is removed before it closes stays valid, is counted and executes.
    function test_proposalOfRemovedProposerStillExecutes() public {
        uint256 removal = _proposeSetMember(dave, false, TEN_MINUTES);
        vm.prank(dave);
        uint256 byDave = dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, "d", "", 2 days);
        _runToFinalized(removal, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        dao.execute(removal);
        assertFalse(dao.isMember(dave));

        _vote(byDave, alice, _for());
        _vote(byDave, bob, _for());
        vm.prank(dave);
        vm.expectRevert(SealedDAO.NotMember.selector);
        dao.vote(byDave, keccak256("late"), _ciphertext(VOTE_CT_LENGTH));
        _warpToReveal(byDave);
        _reveal(byDave, _addrs(alice, bob), _choices(_for(), _for()));
        _warpToRevealEnd(byDave);
        dao.finalize(byDave);
        dao.execute(byDave);
        assertEq(dao.claimable(carol), 1e6);
    }

    /// A 1,024-byte ciphertext costs its sealer more, but the reveal of that vote costs exactly the same as the reveal
    /// of a 359-byte one: revealBatch never touches ciphertexts, so a sealer cannot grief revealers by ciphertext size.
    function test_maxCiphertextDoesNotChangeRevealGas() public {
        uint256 small = _revealGasAfterSealing(359);
        uint256 large = _revealGasAfterSealing(1024);
        assertEq(large, small);
    }

    function _revealGasAfterSealing(uint256 ctLength) internal returns (uint256) {
        dao = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        _fund(dao, TREASURY);
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes32 commitment = _commitment(id, alice, _for());
        vm.prank(alice);
        dao.vote(id, commitment, _ciphertext(ctLength));
        _warpToReveal(id);
        bytes32[] memory salts = new bytes32[](1);
        salts[0] = _salt(id, alice);
        vm.cool(address(dao));
        vm.cool(address(usdc));
        vm.prank(revealer);
        dao.revealBatch(id, _addrs(alice), _choices(_for()), salts);
        vm.warp(T0);
        return vm.lastCallGas().gasTotalUsed;
    }
}
