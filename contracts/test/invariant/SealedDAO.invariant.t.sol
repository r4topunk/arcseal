// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {SealedDAOHandler} from "./SealedDAOHandler.sol";

/// Handler calls catch every expected failure, so any revert (in particular from a revealBatch inside its window)
/// fails the campaign.
/// forge-config: default.invariant.fail-on-revert = true
contract SealedDAOInvariantTest is Test {
    uint256 internal constant T0 = 1_790_812_800; // 2026-10-01T00:00:00Z
    uint256 internal constant FUNDING = 50e6;

    MockUSDC internal usdc;
    SealedDAO internal dao;
    SealedDAOHandler internal handler;

    function setUp() public {
        vm.warp(T0);
        usdc = new MockUSDC();
        address[] memory actors = new address[](6);
        for (uint256 i; i < actors.length; ++i) {
            actors[i] = makeAddr(string.concat("inv-actor-", vm.toString(i)));
        }
        address[] memory members = new address[](3);
        (members[0], members[1], members[2]) = (actors[0], actors[1], actors[2]);
        dao = new SealedDAO(address(usdc), members, 5000, 10_000);
        usdc.mint(address(dao), FUNDING);
        handler = new SealedDAOHandler(dao, usdc, actors, FUNDING);
        targetContract(address(handler));
    }

    /// I1 (PRD 4.3): every claim is solvent.
    function invariant_I1_solvent() public view {
        assertGe(usdc.balanceOf(address(dao)), dao.totalClaimable());
    }

    /// I2: totalClaimable is exactly the sum of claimable balances, and USDC only leaves through claims.
    function invariant_I2_claimAccounting() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += dao.claimable(handler.actors(i));
        }
        assertEq(sum, dao.totalClaimable());
        assertEq(usdc.balanceOf(address(dao)), handler.ghostFunded() - handler.ghostClaimed());
        assertFalse(handler.ghostFailedClaimChangedState(), "a failed claim changed state");
    }

    /// I3 (PRD 8.1): forCount + againstCount + abstainCount == revealedCount <= sealedCount, and both counters match
    /// what the handler observed.
    function invariant_I3_tally() public view {
        assertFalse(handler.ghostRevealMismatch(), "revealBatch returned an unexpected count");
        uint256 n = dao.proposalCount();
        for (uint256 id = 1; id <= n; ++id) {
            SealedDAO.Proposal memory p = dao.proposal(id);
            assertEq(uint256(p.forCount) + p.againstCount + p.abstainCount, p.revealedCount);
            assertLe(p.revealedCount, p.sealedCount);
            assertEq(p.sealedCount, handler.ghostSealed(id));
            assertEq(p.revealedCount, handler.ghostRevealed(id));
        }
    }

    /// I4: sealedCount <= memberSnapshot + members added while the proposal was sealing. PRD 8.1 states
    /// sealedCount <= memberSnapshot, which PRD 4.3 itself breaks on purpose (a member added mid-vote may vote), so the
    /// bound carries the members added during sealing (ghost counter).
    function invariant_I4_snapshotBound() public view {
        uint256 n = dao.proposalCount();
        for (uint256 id = 1; id <= n; ++id) {
            SealedDAO.Proposal memory p = dao.proposal(id);
            assertLe(p.sealedCount, uint256(p.memberSnapshot) + handler.ghostAddedWhileSealing(id));
        }
    }

    /// I5 (PRD 8.1): Executed and Expired are absorbing.
    function invariant_I5_terminalAbsorbing() public view {
        assertFalse(handler.ghostLeftTerminal());
        uint256 n = dao.proposalCount();
        for (uint256 id = 1; id <= n; ++id) {
            if (handler.ghostTerminalSeen(id)) assertEq(uint8(dao.status(id)), uint8(handler.ghostTerminal(id)));
        }
    }

    /// I6: memberCount equals the members in the actor pool (the only accounts SetMember can target).
    function invariant_I6_memberCount() public view {
        uint256 members;
        for (uint256 i; i < handler.actorCount(); ++i) {
            if (dao.isMember(handler.actors(i))) ++members;
        }
        assertEq(members, dao.memberCount());
    }
}
