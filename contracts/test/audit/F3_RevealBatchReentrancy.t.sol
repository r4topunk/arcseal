// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {WeirdUSDC} from "../mocks/WeirdUSDC.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F3 regression (PRD 7 "Reentrancy", PRD 4.3 invariant balanceOf(this) >= totalClaimable): `claim`
///         lowers totalClaimable before `usdc.transfer`. Before the fix `revealBatch` was not behind the reentrancy
///         lock, so a token that calls back from inside `transfer` (before moving the balance) could reveal votes
///         there: `_creditBounty` read the stale, pre-transfer balance and credited a bounty out of the USDC about to
///         leave. `revealBatch` now shares the lock of `execute` and `claim`, so the callback reverts `Reentrancy`.
/// @dev Arc's USDC has no transfer hooks, so this needs a different token (the constructor accepts any address;
///      `Sealed` is meant for reuse). The second proposal meets quorum, so without the lock the bounty would be
///      credited: the test isolates the lock from the quorum gate of audit F1.
///      Run: cd contracts && forge test --match-contract AuditF3 -vv
contract AuditF3RevealBatchReentrancyTest is SealedDAOBaseTest {
    uint256 internal constant PAYOUT = 1e6;

    function test_claimHookCannotCreditBountyFromOutgoingFunds() public {
        WeirdUSDC weird = new WeirdUSDC();
        dao = new SealedDAO(address(weird), _addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        weird.mint(address(dao), PAYOUT + 3 * BOUNTY); // the payout plus its own 3 reveal bounties

        uint256 payout = _passedTransfer(carol, PAYOUT);
        dao.execute(payout);
        assertEq(weird.balanceOf(address(dao)), dao.totalClaimable(), "fully reserved, free treasury 0");

        // A second proposal that meets quorum (2 sealed votes of 4), in its reveal window.
        uint256 other = _proposeTransfer(carol, 1);
        _vote(other, alice, _for());
        _vote(other, bob, _for());
        _warpToReveal(other);

        // The token calls revealBatch from inside carol's claim transfer.
        bytes32[] memory salts = new bytes32[](2);
        (salts[0], salts[1]) = (_salt(other, alice), _salt(other, bob));
        weird.setHook(
            address(dao),
            abi.encodeCall(SealedDAO.revealBatch, (other, _addrs(alice, bob), _choices(_for(), _for()), salts))
        );
        vm.prank(carol);
        dao.claim();

        // The callback hit the lock: nothing was revealed or credited against the outgoing payout.
        assertFalse(weird.hookSucceeded(), "reentrant revealBatch must fail");
        assertEq(bytes4(weird.hookResult()), SealedDAO.Reentrancy.selector);
        assertEq(weird.balanceOf(carol), PAYOUT, "carol paid");
        assertEq(dao.proposal(other).revealedCount, 0);
        assertGe(weird.balanceOf(address(dao)), dao.totalClaimable(), "balanceOf(this) >= totalClaimable broken");

        // Outside the callback the same reveal goes through; the free treasury is empty, so the bounty is skipped.
        vm.expectEmit(address(dao));
        emit SealedDAO.BountySkipped(other);
        vm.prank(revealer);
        assertEq(dao.revealBatch(other, _addrs(alice, bob), _choices(_for(), _for()), salts), 2);
        assertGe(weird.balanceOf(address(dao)), dao.totalClaimable());
    }
}
