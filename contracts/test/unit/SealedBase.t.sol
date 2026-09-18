// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Sealed} from "../../src/Sealed.sol";
import {SealedHarness} from "../mocks/SealedHarness.sol";

/// @notice Shared fixture for the Sealed module suites (unit and fuzz).
abstract contract SealedBaseTest is Test {
    uint256 internal constant GENESIS = 1_692_803_367;
    uint256 internal constant PERIOD = 3;
    uint64 internal constant WINDOW = 28_800;
    // 2026-10-01T00:00:00Z. GENESIS is a multiple of 3, so every UTC midnight is a round boundary.
    uint256 internal constant T0 = 1_790_812_800;
    uint256 internal constant GROUP = 1;
    uint32 internal constant TEN_MINUTES = 600;
    // DAO vote ciphertext from PRD 4.2: 96-byte ABI payload + 359 bytes of tlock/age overhead.
    uint256 internal constant VOTE_CT_LENGTH = 455;
    bytes32 internal constant COMMITMENT = keccak256("arcseal.test.commitment");
    bytes32 internal constant OTHER_COMMITMENT = keccak256("arcseal.test.other");
    bytes32 internal constant REVEALED = bytes32(uint256(1));

    SealedHarness internal harness;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public virtual {
        vm.warp(T0);
        harness = new SealedHarness();
    }

    /// @dev A deterministic, non-zero blob of `length` bytes standing in for a tlock ciphertext.
    function _ciphertext(uint256 length) internal pure returns (bytes memory ct) {
        ct = new bytes(length);
        for (uint256 i; i < length; ++i) {
            ct[i] = keccak256(abi.encode(length, i))[0];
        }
    }

    function _open(uint256 groupId, uint32 votingSeconds) internal returns (uint64) {
        return harness.openGroup(groupId, votingSeconds);
    }

    function _seal(uint256 groupId, address sealer, bytes32 commitment) internal {
        harness.seal(groupId, sealer, commitment, _ciphertext(VOTE_CT_LENGTH));
    }

    /// @dev Unix time of the group's close round: sealing ends and revealing starts here.
    function _closeTime(uint256 groupId) internal view returns (uint256) {
        return harness.roundTime(harness.group(groupId).closeRound);
    }

    /// @dev Unix time of the group's reveal end round: revealing is closed from here on.
    function _revealEndTime(uint256 groupId) internal view returns (uint256) {
        return harness.roundTime(harness.group(groupId).revealEndRound);
    }

    function _group(uint256 groupId) internal view returns (Sealed.SealGroup memory) {
        return harness.group(groupId);
    }
}
