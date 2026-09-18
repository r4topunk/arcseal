// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "../../src/Sealed.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Property tests for SealedDAO (PRD 8.1 "Fuzz"): the onchain tally equals an in-test oracle for random member
///         sets, participation, choices, salts and reveal batches; ciphertext bounds; skip-not-revert; bounty coverage.
contract SealedDAOFuzzTest is SealedDAOBaseTest {
    /// @dev One random electorate: who seals, what they chose, whose vote gets revealed.
    struct Electorate {
        address[] members;
        bool[] sealedVote;
        bool[] revealIt;
        SealedDAO.Choice[] choices;
        bytes32[] salts;
        uint256 sealedCount;
    }

    /// @dev The oracle's expected tally.
    struct Tally {
        uint32 forCount;
        uint32 againstCount;
        uint32 abstainCount;
    }

    function _electorate(uint256 seed, uint256 n) internal pure returns (Electorate memory e) {
        e.members = _members(n, seed);
        e.sealedVote = new bool[](n);
        e.revealIt = new bool[](n);
        e.choices = new SealedDAO.Choice[](n);
        e.salts = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            e.sealedVote[i] = r % 4 != 0; // about 75% participation
            e.revealIt[i] = (r >> 8) % 5 != 0; // about 80% of sealed votes are revealed
            e.choices[i] = SealedDAO.Choice((r >> 16) % 3);
            e.salts[i] = keccak256(abi.encode("arcseal.fuzz.salt", seed, i));
            if (e.sealedVote[i]) ++e.sealedCount;
        }
    }

    /// @dev Reveal items: every revealed vote, plus for each sealed voter a wrong-salt item, a duplicate of revealed
    ///      votes and an unknown voter, interleaved. Returns the oracle tally of what must be counted.
    function _batch(Electorate memory e, uint256 seed)
        internal
        pure
        returns (address[] memory voters, SealedDAO.Choice[] memory choices, bytes32[] memory salts, Tally memory t)
    {
        uint256 n = e.members.length;
        voters = new address[](4 * n);
        choices = new SealedDAO.Choice[](4 * n);
        salts = new bytes32[](4 * n);
        uint256 k;
        for (uint256 i; i < n; ++i) {
            if (!e.sealedVote[i]) {
                // a member who never sealed: skipped
                (voters[k], choices[k], salts[k]) = (e.members[i], e.choices[i], e.salts[i]);
                ++k;
                continue;
            }
            // wrong salt first: skipped, and it must not consume the commitment
            (voters[k], choices[k], salts[k]) = (e.members[i], e.choices[i], keccak256(abi.encode(e.salts[i])));
            ++k;
            if (!e.revealIt[i]) continue;
            (voters[k], choices[k], salts[k]) = (e.members[i], e.choices[i], e.salts[i]);
            ++k;
            // duplicate in the same batch: skipped
            (voters[k], choices[k], salts[k]) = (e.members[i], e.choices[i], e.salts[i]);
            ++k;
            if (e.choices[i] == SealedDAO.Choice.For) ++t.forCount;
            else if (e.choices[i] == SealedDAO.Choice.Against) ++t.againstCount;
            else ++t.abstainCount;
        }
        // an unknown voter at the end
        voters[k] = address(uint160(uint256(keccak256(abi.encode("arcseal.fuzz.unknown", seed)))));
        ++k;
        assembly ("memory-safe") {
            mstore(voters, k)
            mstore(choices, k)
            mstore(salts, k)
        }
    }

    function testFuzz_tallyMatchesOracle(uint256 seed, uint8 memberCount, uint16 quorumBps) public {
        uint256 n = bound(memberCount, 1, 24);
        uint16 bps = uint16(bound(quorumBps, 1, 10_000));
        Electorate memory e = _electorate(seed, n);
        dao = _deploy(e.members, bps, BOUNTY);
        _fund(dao, TREASURY);
        uint256 id = _propose(e.members[0], SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, TEN_MINUTES);

        for (uint256 i; i < n; ++i) {
            if (!e.sealedVote[i]) continue;
            bytes32 commitment = dao.hashVote(id, e.members[i], e.choices[i], e.salts[i]);
            vm.prank(e.members[i]);
            dao.vote(id, commitment, _ciphertext(VOTE_CT_LENGTH));
        }

        (address[] memory voters, SealedDAO.Choice[] memory choices, bytes32[] memory salts, Tally memory t) =
            _batch(e, seed);
        _warpToReveal(id);
        vm.prank(revealer);
        uint32 revealed = dao.revealBatch(id, voters, choices, salts);
        _warpToRevealEnd(id);
        dao.finalize(id);

        SealedDAO.Proposal memory p = dao.proposal(id);
        assertEq(revealed, t.forCount + t.againstCount + t.abstainCount, "revealed");
        assertEq(p.forCount, t.forCount, "for");
        assertEq(p.againstCount, t.againstCount, "against");
        assertEq(p.abstainCount, t.abstainCount, "abstain");
        assertEq(p.revealedCount, revealed, "revealedCount");
        assertEq(p.sealedCount, e.sealedCount, "sealedCount");
        assertEq(p.memberSnapshot, n, "snapshot");
        bool quorumMet = e.sealedCount * 10_000 >= n * bps;
        assertEq(p.passed, quorumMet && t.forCount > t.againstCount, "passed");
        // the treasury (100 USDC) covers every bounty here, so only quorum decides (audit F1)
        assertEq(dao.claimable(revealer), quorumMet ? revealed * BOUNTY : 0, "bounty iff quorum met");
    }

    function testFuzz_voteCiphertextLength(uint256 length) public {
        length = bound(length, 0, 2048);
        uint256 id = _proposeTransfer(carol, 1e6);
        bytes32 commitment = _commitment(id, alice, _for());
        bytes memory ct = _ciphertext(length);
        bool inBounds = length >= 359 && length <= 1024;
        if (!inBounds) vm.expectRevert(Sealed.BadCiphertextLength.selector);
        vm.prank(alice);
        dao.vote(id, commitment, ct);
        assertEq(dao.proposal(id).sealedCount, inBounds ? 1 : 0);
        assertEq(dao.commitmentOf(id, alice), inBounds ? commitment : bytes32(0));
    }

    function testFuzz_revealBatchSkipsGarbageWithoutReverting(
        address[6] memory voters,
        uint8[6] memory rawChoices,
        bytes32[6] memory salts,
        uint256 offset
    ) public {
        uint256 id = _proposeTransfer(carol, 1e6);
        _vote(id, alice, _for());
        _vote(id, bob, _against());
        vm.warp(_closeTime(id) + bound(offset, 0, 24 hours - 1)); // anywhere inside the reveal window

        address[] memory v = new address[](6);
        SealedDAO.Choice[] memory c = new SealedDAO.Choice[](6);
        bytes32[] memory s = new bytes32[](6);
        for (uint256 i; i < 6; ++i) {
            (v[i], c[i], s[i]) = (voters[i], SealedDAO.Choice(rawChoices[i] % 3), salts[i]);
        }
        vm.prank(revealer);
        assertEq(dao.revealBatch(id, v, c, s), 0);
        assertEq(dao.proposal(id).revealedCount, 0);
        assertTrue(dao.commitmentOf(id, alice) != REVEALED && dao.commitmentOf(id, bob) != REVEALED);
        // the real votes still reveal afterwards
        assertEq(_reveal(id, _addrs(alice, bob), _choices(_for(), _against())), 2);
    }

    function testFuzz_bountyCreditedIffQuorumMetAndTreasuryCovers(uint256 treasury, uint256 bounty, uint8 voteCount)
        public
    {
        treasury = bound(treasury, 0, 1e15);
        uint256 k = bound(voteCount, 1, 4);
        // around the coverage boundary, so both branches are hit (the overflow branch has a unit test)
        bounty = bound(bounty, 0, 2 * (treasury / k) + 1);
        dao = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, bounty);
        if (treasury != 0) _fund(dao, treasury);
        uint256 id = _proposeTransfer(carol, 1e6);
        address[] memory all = _addrs(alice, bob, carol, dave);
        address[] memory voters = new address[](k);
        SealedDAO.Choice[] memory choices = new SealedDAO.Choice[](k);
        for (uint256 i; i < k; ++i) {
            voters[i] = all[i];
            choices[i] = _for();
            _vote(id, voters[i], choices[i]);
        }
        _warpToReveal(id);
        assertEq(_reveal(id, voters, choices), k, "reveals never depend on the bounty");

        // 4 members at 50%: quorum needs 2 sealed votes (audit F1)
        bool covered = k >= 2 && bounty != 0 && bounty * k <= treasury;
        assertEq(dao.claimable(revealer), covered ? bounty * k : 0);
        assertEq(dao.totalClaimable(), dao.claimable(revealer));
        assertGe(usdc.balanceOf(address(dao)), dao.totalClaimable());
    }

    function testFuzz_hashVoteIsAbiEncode(uint256 id, address voter, uint8 rawChoice, bytes32 salt) public view {
        uint8 c = rawChoice % 3;
        assertEq(dao.hashVote(id, voter, SealedDAO.Choice(c), salt), keccak256(abi.encode(id, voter, c, salt)));
    }
}
