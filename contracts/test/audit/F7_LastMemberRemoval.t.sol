// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F7 regression (robustness, PRD 7 "Member removed while voting"): a passed SetMember could remove the
///         last member. memberCount became 0, nobody could ever propose again, and the free treasury was locked forever
///         (D14: no admin path). `execute` now reverts LastMember for that removal: the proposal stays Passed (then
///         Expired), the member stays, and the treasury can still move through later proposals.
/// @dev Run: cd contracts && forge test --match-contract AuditF7 -vv
contract AuditF7LastMemberRemovalTest is SealedDAOBaseTest {
    function test_removingTheLastMemberIsRejected() public {
        SealedDAO solo = _deploy(_addrs(alice), QUORUM_BPS, BOUNTY);
        dao = solo;
        _fund(dao, 3e6);

        uint256 id = _proposeSetMember(alice, false, TEN_MINUTES);
        _runToFinalized(id, _addrs(alice), _choices(_for()));
        vm.expectRevert(SealedDAO.LastMember.selector);
        dao.execute(id);
        assertEq(dao.memberCount(), 1);
        assertTrue(dao.isMember(alice));
        _assertStatus(id, SealedDAO.Status.Passed);

        // the DAO keeps working: the last member can still propose, and the treasury can still move
        uint256 pay = _proposeTransfer(carol, 1e6);
        _runToFinalized(pay, _addrs(alice), _choices(_for()));
        dao.execute(pay);
        assertEq(dao.claimable(carol), 1e6);
    }

    /// Removing a member when others remain still works, down to one member.
    function test_removalsDownToOneMemberStillExecute() public {
        dao = _deploy(_addrs(alice, bob), QUORUM_BPS, BOUNTY);
        _fund(dao, 3e6);
        uint256 id = _proposeSetMember(bob, false, TEN_MINUTES);
        _runToFinalized(id, _addrs(alice, bob), _choices(_for(), _for()));
        dao.execute(id);
        assertEq(dao.memberCount(), 1);
        assertFalse(dao.isMember(bob));
    }
}
