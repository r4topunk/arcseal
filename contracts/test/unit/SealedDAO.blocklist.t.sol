// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "./SealedDAOBase.t.sol";

/// @notice The USDC blocklist (PRD 7 "Blocklisted recipient", D13): payouts are pull-based, so a blocklisted account
///         only blocks its own claim, never execute, reveals or anyone else's claim.
contract SealedDAOBlocklistTest is SealedDAOBaseTest {
    string internal constant BLOCKED = "Blacklistable: account is blacklisted";

    function test_blocklist_claimerRevertsKeepsBalanceThenClaimsAfterUnblock() public {
        dao.execute(_passedTransfer(carol, 5e6));
        uint256 reserved = dao.totalClaimable();
        usdc.blacklist(carol, true);

        vm.prank(carol);
        vm.expectRevert(bytes(BLOCKED)); // the token's own revert is bubbled
        dao.claim();
        assertEq(dao.claimable(carol), 5e6, "still claimable");
        assertEq(dao.totalClaimable(), reserved, "still reserved");
        assertEq(usdc.balanceOf(address(dao)), TREASURY);

        usdc.blacklist(carol, false);
        vm.prank(carol);
        dao.claim();
        assertEq(usdc.balanceOf(carol), 5e6);
        assertEq(dao.claimable(carol), 0);
        assertEq(dao.totalClaimable(), reserved - 5e6);
    }

    function test_blocklist_targetNeverBlocksExecuteOrOtherClaims() public {
        uint256 toCarol = _passedTransfer(carol, 5e6);
        uint256 toDave = _passedTransfer(dave, 2e6);
        usdc.blacklist(carol, true);

        dao.execute(toCarol); // credits a blocklisted target without any transfer
        dao.execute(toDave);
        assertEq(dao.claimable(carol), 5e6);
        _assertStatus(toCarol, SealedDAO.Status.Executed);

        vm.prank(dave);
        dao.claim();
        assertEq(usdc.balanceOf(dave), 2e6);
        vm.prank(revealer);
        dao.claim();
        assertEq(usdc.balanceOf(revealer), 6 * BOUNTY);

        // the blocked balance stays reserved and the invariant holds
        assertEq(dao.totalClaimable(), 5e6);
        assertGe(usdc.balanceOf(address(dao)), dao.totalClaimable());
    }

    function test_blocklist_revealerStillRevealsAndBountyWaits() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(id, bob, _for());
        _warpToReveal(id);
        usdc.blacklist(revealer, true);

        assertEq(_reveal(id, _addrs(alice, bob), _choices(_for(), _for())), 2, "reveal does not touch USDC transfers");
        assertEq(dao.claimable(revealer), 2 * BOUNTY);
        vm.prank(revealer);
        vm.expectRevert(bytes(BLOCKED));
        dao.claim();

        _warpToRevealEnd(id);
        dao.finalize(id);
        dao.execute(id);
        vm.prank(carol);
        dao.claim();
        assertEq(usdc.balanceOf(carol), 1e6);
        assertEq(dao.claimable(revealer), 2 * BOUNTY);
    }

    function test_blocklist_blockedMemberStillVotes() public {
        usdc.blacklist(bob, true); // membership and votes never move USDC
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, bob, _for());
        _vote(id, alice, _for());
        _warpToReveal(id);
        assertEq(_reveal(id, _addrs(alice, bob), _choices(_for(), _for())), 2);
    }
}
