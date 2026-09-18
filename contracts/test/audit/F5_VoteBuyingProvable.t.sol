// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F5 (documentation): pins the property behind "Not provided: coercion resistance" (PRD 7,
///         docs/THREATS.md). While the proposal is still Voting, a seller who hands over their receipt (choice, salt)
///         lets a buyer verify delivery against the onchain commitment with the contract's own `hashVote`, and the
///         seller cannot lie about the choice. The README and the project page used to imply the opposite ("no
///         verifiable vote-buying while voting is open"); that copy now says the chain shows no vote while voting is
///         open, and that a receipt still proves a vote to whoever the voter shows it to.
/// @dev Demonstration of documented behaviour; if this test ever fails, the "Not provided" copy must be revisited.
///      Run: cd contracts && forge test --match-contract AuditF5 -vv
contract AuditF5VoteBuyingProvableTest is SealedDAOBaseTest {
    function test_buyerVerifiesSealedChoiceWhileVoting() public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, bob, _for()); // the seller seals For

        // The receipt the SDK / app keeps for bob: (proposalId, voter, choice, salt).
        bytes32 salt = _salt(id, bob);
        _assertStatus(id, SealedDAO.Status.Voting);
        assertTrue(dao.sealingOpen(id), "voting still open");

        // The buyer checks it with two onchain reads.
        assertEq(dao.hashVote(id, bob, SealedDAO.Choice.For, salt), dao.commitmentOf(id, bob), "delivery verified");
        // ...and a seller claiming another choice is caught.
        assertTrue(dao.hashVote(id, bob, SealedDAO.Choice.Against, salt) != dao.commitmentOf(id, bob));
        assertTrue(dao.hashVote(id, bob, SealedDAO.Choice.Abstain, salt) != dao.commitmentOf(id, bob));
    }
}
