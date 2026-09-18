// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {stdError} from "forge-std/Test.sol";
import {Sealed} from "../../src/Sealed.sol";
import {SealedBaseTest} from "./SealedBase.t.sol";

/// @notice drand quicknet round math (PRD 4.1) against the 20 vectors shared with the SDK.
contract SealedRoundMathTest is SealedBaseTest {
    /// @dev Fields in alphabetical order: vm.parseJson decodes JSON objects with their keys sorted.
    struct RoundVector {
        uint256 roundAfter;
        uint256 roundAt;
        uint256 roundTime;
        uint256 timestamp;
    }

    string internal constant VECTORS = "/test/vectors/rounds.json";
    uint256 internal constant VECTOR_COUNT = 20;
    uint256 internal constant MAX_ROUND = type(uint64).max;

    function _json() internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), VECTORS));
    }

    function _vectors() internal view returns (RoundVector[] memory) {
        return abi.decode(vm.parseJson(_json(), ".vectors"), (RoundVector[]));
    }

    function _label(uint256 i) internal pure returns (string memory) {
        return string.concat("vector ", vm.toString(i));
    }

    function test_constants() public view {
        assertEq(harness.QUICKNET_GENESIS(), GENESIS);
        assertEq(harness.QUICKNET_PERIOD(), PERIOD);
        assertEq(harness.REVEAL_WINDOW(), WINDOW);
        assertEq(uint256(harness.REVEAL_WINDOW()) * harness.QUICKNET_PERIOD(), 24 hours);
        assertEq(harness.MIN_VOTING(), 600);
        assertEq(harness.MAX_VOTING(), 7 days);
        assertEq(harness.MIN_CIPHERTEXT_LENGTH(), 359);
        assertEq(harness.MAX_CIPHERTEXT_LENGTH(), 1024);
        assertEq(harness.REVEALED(), REVEALED);
    }

    // ------------------------------------------------------------------
    // Shared vectors (test/vectors/rounds.json, also read by @arcseal/sdk)
    // ------------------------------------------------------------------

    function test_vectors_headerAndCount() public view {
        string memory json = _json();
        assertEq(vm.parseJsonUint(json, ".genesis"), GENESIS, "genesis");
        assertEq(vm.parseJsonUint(json, ".period"), PERIOD, "period");
        assertEq(_vectors().length, VECTOR_COUNT, "vector count");
    }

    function test_vectors_roundAt() public view {
        RoundVector[] memory v = _vectors();
        for (uint256 i; i < v.length; ++i) {
            assertEq(harness.roundAt(v[i].timestamp), v[i].roundAt, _label(i));
        }
    }

    function test_vectors_roundAfter() public view {
        RoundVector[] memory v = _vectors();
        for (uint256 i; i < v.length; ++i) {
            assertEq(harness.roundAfter(v[i].timestamp), v[i].roundAfter, _label(i));
        }
    }

    function test_vectors_roundTime() public view {
        RoundVector[] memory v = _vectors();
        for (uint256 i; i < v.length; ++i) {
            uint64 round = harness.roundAt(v[i].timestamp);
            assertEq(harness.roundTime(round), v[i].roundTime, _label(i));
            // the vector's roundTime brackets its timestamp: roundTime <= t < roundTime + PERIOD
            assertLe(v[i].roundTime, v[i].timestamp, _label(i));
            assertLt(v[i].timestamp, v[i].roundTime + PERIOD, _label(i));
        }
    }

    /// @dev Independent of the JSON file: the first rounds computed by hand from the PRD formulas.
    function test_roundMath_handComputedNearGenesis() public view {
        assertEq(harness.roundAt(GENESIS), 1);
        assertEq(harness.roundAfter(GENESIS), 1);
        assertEq(harness.roundAt(GENESIS + 1), 1);
        assertEq(harness.roundAfter(GENESIS + 1), 2);
        assertEq(harness.roundAt(GENESIS + 2), 1);
        assertEq(harness.roundAfter(GENESIS + 2), 2);
        assertEq(harness.roundAt(GENESIS + 3), 2);
        assertEq(harness.roundAfter(GENESIS + 3), 2);
        assertEq(harness.roundAt(GENESIS + 4), 2);
        assertEq(harness.roundAfter(GENESIS + 4), 3);
        assertEq(harness.roundTime(1), GENESIS);
        assertEq(harness.roundTime(2), GENESIS + 3);
        assertEq(harness.roundTime(3), GENESIS + 6);
    }

    // ------------------------------------------------------------------
    // Domain edges: before genesis, round 0, uint64 limits
    // ------------------------------------------------------------------

    function test_roundAt_revertsBeforeGenesis() public {
        vm.expectRevert(stdError.arithmeticError);
        harness.roundAt(GENESIS - 1);
        vm.expectRevert(stdError.arithmeticError);
        harness.roundAt(0);
    }

    function test_roundAfter_revertsBeforeGenesis() public {
        vm.expectRevert(stdError.arithmeticError);
        harness.roundAfter(GENESIS - 1);
        vm.expectRevert(stdError.arithmeticError);
        harness.roundAfter(0);
    }

    function test_roundTime_revertsForRoundZero() public {
        vm.expectRevert(stdError.arithmeticError);
        harness.roundTime(0);
    }

    function test_roundTime_maxRoundDoesNotOverflow() public view {
        assertEq(harness.roundTime(type(uint64).max), GENESIS + (MAX_ROUND - 1) * PERIOD);
    }

    function test_roundAt_revertsPastUint64InsteadOfTruncating() public {
        uint256 lastRoundStart = GENESIS + (MAX_ROUND - 1) * PERIOD;
        // the last timestamp of the last representable round still maps to it
        assertEq(harness.roundAt(lastRoundStart + PERIOD - 1), type(uint64).max);
        // one second later the round is 2^64: a uint64 cast would silently return 0
        vm.expectRevert(Sealed.RoundOverflow.selector);
        harness.roundAt(lastRoundStart + PERIOD);
        vm.expectRevert(Sealed.RoundOverflow.selector);
        harness.roundAt(type(uint256).max);
    }

    function test_roundAfter_revertsPastUint64InsteadOfTruncating() public {
        uint256 lastRoundStart = GENESIS + (MAX_ROUND - 1) * PERIOD;
        assertEq(harness.roundAfter(lastRoundStart), type(uint64).max);
        // one second past the last round start: the next round (2^64) is not representable
        vm.expectRevert(Sealed.RoundOverflow.selector);
        harness.roundAfter(lastRoundStart + 1);
        vm.expectRevert(Sealed.RoundOverflow.selector);
        harness.roundAfter(type(uint256).max);
    }
}
