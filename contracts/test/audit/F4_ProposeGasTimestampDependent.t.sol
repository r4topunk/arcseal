// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F4 regression (SDK write path, packages/sdk/src/actions.ts `write`): `propose` used to cost 70 gas more
///         when block.timestamp + votingSeconds was not a drand round boundary (a round-up branch in `roundAfter`).
///         A local-account transaction sent with the node's exact estimate, taken in an aligned second and mined one
///         second later, then ran out of gas after the simulation passed. `roundAfter` is now a branch-free ceiling
///         division, so `propose` costs the same in every second; the SDK also adds a 20% gas margin for local
///         accounts (packages/sdk/test/anvil.test.ts) against every other state-dependent path.
/// @dev Each call goes to a fresh, identical, cold DAO so storage warmth is the same.
///      Run: cd contracts && forge test --match-contract AuditF4 -vv
contract AuditF4ProposeGasTimestampDependentTest is SealedDAOBaseTest {
    function test_proposeGasEstimateFromPreviousSecondStillSuffices() public {
        address[] memory members = _addrs(alice, bob, carol);
        SealedDAO estimated = _deploy(members, QUORUM_BPS, BOUNTY);
        SealedDAO control = _deploy(members, QUORUM_BPS, BOUNTY);
        SealedDAO mined = _deploy(members, QUORUM_BPS, BOUNTY);
        SealedDAO measured = _deploy(members, QUORUM_BPS, BOUNTY);
        bytes memory data = abi.encodeCall(
            SealedDAO.propose, (SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, "pay carol", "", TEN_MINUTES)
        );

        // T0 is a round boundary and 600 is a multiple of the 3 s period: T0 + 600 needs no round-up.
        assertEq((T0 + TEN_MINUTES - dao.QUICKNET_GENESIS()) % dao.QUICKNET_PERIOD(), 0, "aligned second");
        vm.cool(address(estimated));
        vm.prank(alice);
        (bool ok,) = address(estimated).call(data);
        assertTrue(ok);
        uint256 estimate = vm.lastCallGas().gasTotalUsed;

        // control: the exact estimate is enough in the same second
        vm.cool(address(control));
        vm.prank(alice);
        (ok,) = address(control).call{gas: estimate}(data);
        assertTrue(ok, "exact estimate works in the aligned second");

        // one second later (unaligned): what propose needs now, then the previous second's exact limit
        vm.warp(T0 + 1);
        vm.cool(address(measured));
        vm.prank(alice);
        (ok,) = address(measured).call(data);
        assertTrue(ok);
        uint256 unaligned = vm.lastCallGas().gasTotalUsed;
        console.log("propose execution gas, aligned second:", estimate);
        console.log("propose execution gas, next second:", unaligned);
        assertEq(unaligned, estimate, "propose gas must not depend on round alignment");
        vm.cool(address(mined));
        vm.prank(alice);
        (ok,) = address(mined).call{gas: estimate}(data);
        assertTrue(ok, "propose with the previous second's exact gas estimate ran out of gas");
    }
}
