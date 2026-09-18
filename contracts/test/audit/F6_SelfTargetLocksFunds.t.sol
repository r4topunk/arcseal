// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F6 regression (robustness): `propose` used to reject only target == address(0). A passed TransferUSDC
///         to the DAO itself or to the USDC contract credited `claimable` to an account that can never call `claim`,
///         so the amount stayed reserved in totalClaimable forever; a passed SetMember(DAO, true) added a member that
///         can never vote and permanently raised the quorum denominator. `propose` now reverts BadTarget for the DAO
///         and the USDC token, for both kinds.
/// @dev Run: cd contracts && forge test --match-contract AuditF6 -vv
contract AuditF6SelfTargetLocksFundsTest is SealedDAOBaseTest {
    function test_payoutToDaoOrTokenIsRejected() public {
        address[2] memory stuck = [address(dao), address(usdc)];
        for (uint256 i; i < stuck.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(SealedDAO.BadTarget.selector);
            dao.propose(SealedDAO.ActionKind.TransferUSDC, stuck[i], 5e6, false, "stuck", "", TEN_MINUTES);
        }
        assertEq(dao.proposalCount(), 0);
        assertEq(dao.totalClaimable(), 0);
        assertEq(usdc.balanceOf(address(dao)), TREASURY, "the whole treasury stays free");
    }

    function test_daoOrTokenAsMemberIsRejected() public {
        address[2] memory mute = [address(dao), address(usdc)];
        for (uint256 i; i < mute.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(SealedDAO.BadTarget.selector);
            dao.propose(SealedDAO.ActionKind.SetMember, mute[i], 0, true, "mute member", "", TEN_MINUTES);
        }
        assertEq(dao.memberCount(), 4);

        // Quorum keeps its meaning: 2 sealed votes of 4 still pass.
        uint256 later = _proposeTransfer(carol, 1e6);
        _runToFinalized(later, _addrs(alice, bob), _choices(_for(), _for()));
        assertTrue(dao.proposal(later).passed, "2 of 4 meets the 50% quorum");
    }

    /// Any other address stays a valid target, contracts included: only the two that can never act are refused.
    function test_otherTargetsStillAccepted() public {
        vm.prank(alice);
        uint256 id = dao.propose(SealedDAO.ActionKind.TransferUSDC, address(this), 1, false, "a contract", "", 600);
        assertEq(dao.proposal(id).target, address(this));
    }
}
