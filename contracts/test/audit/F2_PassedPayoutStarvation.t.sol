// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F2 regression: a passed TransferUSDC is not reserved at finalize. Before the fix a single member could
///         make a fully funded payout unexecutable (InsufficientTreasury) by revealing their own vote on a throwaway
///         proposal between finalize and execute and taking its reveal bounty (D6) from the same free treasury.
///         With the quorum-gated bounty (audit F1) that reveal pays nothing, so the payout stays executable. A bounty
///         of another proposal that met quorum can still use the same free USDC first (docs/THREATS.md 9 (c)).
/// @dev Run: cd contracts && forge test --match-contract AuditF2 -vv
contract AuditF2PassedPayoutStarvationTest is SealedDAOBaseTest {
    uint256 internal constant PAYOUT = 1e6;

    function setUp() public override {
        vm.warp(T0);
        usdc = new MockUSDC();
        dao = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        // Exactly the payout plus the 3 bounties of its own reveal.
        _fund(dao, PAYOUT + 3 * BOUNTY);
    }

    function test_passedPayoutCannotBeStarvedByALoneMembersBounty() public {
        uint256 payout = _proposeTransfer(carol, PAYOUT);
        _vote(payout, alice, _for());
        _vote(payout, bob, _for());
        _vote(payout, carol, _for());

        // dave, alone, opens a throwaway proposal timed so that its reveal window covers the payout's finalize
        vm.warp(_revealEndTime(payout) - TEN_MINUTES - 3);
        vm.prank(dave);
        uint256 farm = dao.propose(SealedDAO.ActionKind.TransferUSDC, dave, 1, false, "farm", "", TEN_MINUTES);
        _vote(farm, dave, _abstain());

        vm.warp(_closeTime(payout));
        _reveal(payout, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        _warpToRevealEnd(payout);
        dao.finalize(payout);
        assertTrue(dao.proposal(payout).passed, "payout passed 3-0");
        assertEq(usdc.balanceOf(address(dao)) - dao.totalClaimable(), PAYOUT, "free treasury covers the payout");

        // dave reveals his own throwaway vote first: 1 sealed vote of 4 is below quorum, so no bounty is credited
        assertTrue(dao.revealOpen(farm), "farm proposal is in its reveal window");
        bytes32[] memory salts = new bytes32[](1);
        salts[0] = _salt(farm, dave);
        vm.recordLogs();
        vm.prank(dave);
        assertEq(dao.revealBatch(farm, _addrs(dave), _choices(_abstain()), salts), 1, "the reveal still counts");
        assertEq(vm.getRecordedLogs().length, 2, "Revealed + VoteRevealed only: no bounty event below quorum");
        assertEq(dao.claimable(dave), 0);

        // the payout that was fully funded when it passed stays executable
        dao.execute(payout);
        assertEq(dao.claimable(carol), PAYOUT);
        assertEq(usdc.balanceOf(address(dao)), dao.totalClaimable(), "payout and its own reveal bounties reserved");
    }
}
