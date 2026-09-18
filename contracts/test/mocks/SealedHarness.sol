// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "../../src/Sealed.sol";

/// @title SealedHarness
/// @notice Test-only concrete `Sealed` that exposes the internal API one to one. Never deployed.
/// @dev `sealer` is an explicit argument (SealedDAO passes msg.sender) so tests can seal for any address.
contract SealedHarness is Sealed {
    /// @notice Exposes `_openGroup`.
    function openGroup(uint256 groupId, uint32 votingSeconds) external returns (uint64 closeRound) {
        return _openGroup(groupId, votingSeconds);
    }

    /// @notice Exposes `_seal`.
    function seal(uint256 groupId, address sealer, bytes32 commitment, bytes calldata ciphertext) external {
        _seal(groupId, sealer, commitment, ciphertext);
    }

    /// @notice Exposes `_verifyReveal`.
    function verifyReveal(uint256 groupId, address sealer, bytes32 expected) external view returns (bool) {
        return _verifyReveal(groupId, sealer, expected);
    }

    /// @notice Exposes `_consumeReveal`.
    function consumeReveal(uint256 groupId, address sealer) external {
        _consumeReveal(groupId, sealer);
    }

    /// @notice Exposes `_reveal`.
    function reveal(uint256 groupId, address sealer, bytes32 expected) external {
        _reveal(groupId, sealer, expected);
    }

    /// @notice Exposes `_requireRevealOpen`.
    function requireRevealOpen(uint256 groupId) external view {
        _requireRevealOpen(groupId);
    }

    /// @notice Reads `_groups[groupId]`.
    function group(uint256 groupId) external view returns (SealGroup memory) {
        return _groups[groupId];
    }

    /// @notice Reads `_commitments[groupId][sealer]`.
    function commitmentOf(uint256 groupId, address sealer) external view returns (bytes32) {
        return _commitments[groupId][sealer];
    }
}
