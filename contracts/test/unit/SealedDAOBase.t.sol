// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Shared fixture for the SealedDAO suites: a 4-member DAO (quorum 50%, bounty 0.01 USDC) over MockUSDC,
///         with a funded treasury and helpers for every lifecycle step.
abstract contract SealedDAOBaseTest is Test {
    // 2026-10-01T00:00:00Z. QUICKNET_GENESIS is a multiple of 3, so every UTC midnight is a round boundary.
    uint256 internal constant T0 = 1_790_812_800;
    uint32 internal constant TEN_MINUTES = 600;
    uint16 internal constant QUORUM_BPS = 5000;
    uint256 internal constant BOUNTY = 10_000; // 0.01 USDC
    uint256 internal constant TREASURY = 100e6; // 100 USDC
    // PRD 5: abi.encode(uint8 choice, bytes32 salt) = 64 bytes of plaintext + 359 bytes of tlock/age overhead.
    uint256 internal constant VOTE_CT_LENGTH = 423;
    bytes32 internal constant REVEALED = bytes32(uint256(1));

    MockUSDC internal usdc;
    SealedDAO internal dao;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal eve = makeAddr("eve"); // not a member
    address internal outsider = makeAddr("outsider");
    address internal revealer = makeAddr("revealer");
    address internal funder = makeAddr("funder");

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        dao = _deploy(_addrs(alice, bob, carol, dave), QUORUM_BPS, BOUNTY);
        _fund(dao, TREASURY);
    }

    // ------------------------------------------------------------------
    // Deployment and funding
    // ------------------------------------------------------------------

    function _deploy(address[] memory members, uint16 quorumBps, uint256 bounty) internal returns (SealedDAO) {
        return new SealedDAO(address(usdc), members, quorumBps, bounty);
    }

    /// @dev Funding as the PRD describes it: a plain USDC transfer to the DAO.
    function _fund(SealedDAO target, uint256 amount) internal {
        usdc.mint(funder, amount);
        vm.prank(funder);
        assertTrue(usdc.transfer(address(target), amount));
    }

    // ------------------------------------------------------------------
    // Proposals
    // ------------------------------------------------------------------

    function _propose(
        address proposer,
        SealedDAO.ActionKind kind,
        address target,
        uint256 amount,
        bool flag,
        uint32 votingSeconds
    ) internal returns (uint256 id) {
        vm.prank(proposer);
        id = dao.propose(kind, target, amount, flag, "proposal", "ipfs://proposal", votingSeconds);
    }

    function _proposeTransfer(address target, uint256 amount) internal returns (uint256) {
        return _propose(alice, SealedDAO.ActionKind.TransferUSDC, target, amount, false, TEN_MINUTES);
    }

    function _proposeSetMember(address account, bool flag, uint32 votingSeconds) internal returns (uint256) {
        return _propose(alice, SealedDAO.ActionKind.SetMember, account, 0, flag, votingSeconds);
    }

    // ------------------------------------------------------------------
    // Votes
    // ------------------------------------------------------------------

    /// @dev Deterministic 32-byte salt per (proposal, voter), standing in for the SDK's CSPRNG salt.
    function _salt(uint256 id, address voter) internal pure returns (bytes32) {
        return keccak256(abi.encode("arcseal.test.salt", id, voter));
    }

    /// @dev A deterministic, non-zero blob of `length` bytes standing in for a tlock ciphertext.
    function _ciphertext(uint256 length) internal pure returns (bytes memory ct) {
        ct = new bytes(length);
        for (uint256 i; i < length; ++i) {
            ct[i] = keccak256(abi.encode(length, i))[0];
        }
    }

    function _commitment(uint256 id, address voter, SealedDAO.Choice c) internal view returns (bytes32) {
        return dao.hashVote(id, voter, c, _salt(id, voter));
    }

    function _vote(uint256 id, address voter, SealedDAO.Choice c) internal returns (bytes32 commitment) {
        commitment = _commitment(id, voter, c);
        vm.prank(voter);
        dao.vote(id, commitment, _ciphertext(VOTE_CT_LENGTH));
    }

    /// @dev Reveals `voters` with their fixture salts, as `revealer`.
    function _reveal(uint256 id, address[] memory voters, SealedDAO.Choice[] memory choices) internal returns (uint32) {
        bytes32[] memory salts = new bytes32[](voters.length);
        for (uint256 i; i < voters.length; ++i) {
            salts[i] = _salt(id, voters[i]);
        }
        vm.prank(revealer);
        return dao.revealBatch(id, voters, choices, salts);
    }

    /// @dev propose -> votes -> reveal all -> finalize, leaving the proposal Passed or Failed.
    function _runToFinalized(uint256 id, address[] memory voters, SealedDAO.Choice[] memory choices) internal {
        for (uint256 i; i < voters.length; ++i) {
            _vote(id, voters[i], choices[i]);
        }
        _warpToReveal(id);
        _reveal(id, voters, choices);
        _warpToRevealEnd(id);
        dao.finalize(id);
    }

    /// @dev A TransferUSDC proposal that passes 3-0 and is left finalized (not executed).
    function _passedTransfer(address target, uint256 amount) internal returns (uint256 id) {
        id = _proposeTransfer(target, amount);
        _runToFinalized(id, _addrs(alice, bob, carol), _choices(_for(), _for(), _for()));
        assertTrue(dao.proposal(id).passed, "fixture proposal must pass");
    }

    // ------------------------------------------------------------------
    // Time
    // ------------------------------------------------------------------

    function _closeTime(uint256 id) internal view returns (uint256) {
        return dao.roundTime(dao.proposal(id).closeRound);
    }

    function _revealEndTime(uint256 id) internal view returns (uint256) {
        return dao.roundTime(dao.proposal(id).revealEndRound);
    }

    function _graceEndTime(uint256 id) internal view returns (uint256) {
        return _revealEndTime(id) + dao.EXECUTION_GRACE();
    }

    function _warpToReveal(uint256 id) internal {
        vm.warp(_closeTime(id));
    }

    function _warpToRevealEnd(uint256 id) internal {
        vm.warp(_revealEndTime(id));
    }

    // ------------------------------------------------------------------
    // Array builders
    // ------------------------------------------------------------------

    function _for() internal pure returns (SealedDAO.Choice) {
        return SealedDAO.Choice.For;
    }

    function _against() internal pure returns (SealedDAO.Choice) {
        return SealedDAO.Choice.Against;
    }

    function _abstain() internal pure returns (SealedDAO.Choice) {
        return SealedDAO.Choice.Abstain;
    }

    function _addrs(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _addrs(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        (r[0], r[1]) = (a, b);
    }

    function _addrs(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _addrs(address a, address b, address c, address d) internal pure returns (address[] memory r) {
        r = new address[](4);
        (r[0], r[1], r[2], r[3]) = (a, b, c, d);
    }

    function _choices(SealedDAO.Choice a) internal pure returns (SealedDAO.Choice[] memory r) {
        r = new SealedDAO.Choice[](1);
        r[0] = a;
    }

    function _choices(SealedDAO.Choice a, SealedDAO.Choice b) internal pure returns (SealedDAO.Choice[] memory r) {
        r = new SealedDAO.Choice[](2);
        (r[0], r[1]) = (a, b);
    }

    function _choices(SealedDAO.Choice a, SealedDAO.Choice b, SealedDAO.Choice c)
        internal
        pure
        returns (SealedDAO.Choice[] memory r)
    {
        r = new SealedDAO.Choice[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _choices(SealedDAO.Choice a, SealedDAO.Choice b, SealedDAO.Choice c, SealedDAO.Choice d)
        internal
        pure
        returns (SealedDAO.Choice[] memory r)
    {
        r = new SealedDAO.Choice[](4);
        (r[0], r[1], r[2], r[3]) = (a, b, c, d);
    }

    /// @dev `n` distinct non-zero member addresses derived from `seed`.
    function _members(uint256 n, uint256 seed) internal pure returns (address[] memory r) {
        r = new address[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(uint256(keccak256(abi.encode("arcseal.test.member", seed, i)))));
        }
    }

    function _assertStatus(uint256 id, SealedDAO.Status expected) internal view {
        assertEq(uint8(dao.status(id)), uint8(expected), "status");
    }
}
