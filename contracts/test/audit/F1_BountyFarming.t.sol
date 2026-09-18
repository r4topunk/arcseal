// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm, console} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F1 regression (PRD 7 "Treasury drain: only via passed proposals"): one member, acting alone and with
///         no proposal passing, tried to farm the reveal bounty (D6) with throwaway proposals: 200 proposals, one own
///         vote sealed and revealed on each, all inside one 10-minute voting window, long before a SetMember removal
///         could take effect (>= 10 min + 24 h). Before the fix this emptied the 2 USDC demo treasury for about
///         1.33 USDC of gas. SealedDAO now credits the bounty only for a proposal that met quorum, and a lone member
///         never meets the 50% quorum of the demo DAO, so nothing is credited.
/// @dev Run: cd contracts && forge test --match-contract AuditF1 -vv
///      Gas is priced per transaction like docs/GAS.md: every call starts on cold storage (`vm.cool`), and the tx
///      model is 21,000 + calldata (4 / 16 gas per zero / non-zero byte) + execution - capped refund, floored by
///      EIP-7623, at Arc's 20 gwei floor (1 USDC base unit = 50 gas).
contract AuditF1BountyFarmingTest is SealedDAOBaseTest {
    uint256 internal constant DEMO_TREASURY = 2e6; // PRD 10.2 step 3: 2 USDC
    uint256 internal constant GAS_PER_USDC_UNIT = 50; // 20 gwei * 50 gas = 1e12 wei = 1e-6 USDC
    uint256 internal constant CYCLES = 200; // DEMO_TREASURY / BOUNTY

    uint256 internal gasSpent;

    function setUp() public override {
        vm.warp(T0);
        usdc = new MockUSDC();
        // PRD 10.2 demo parameters: three members, quorum 5000, bounty 0.01 USDC, treasury 2 USDC.
        dao = _deploy(_addrs(alice, bob, carol), QUORUM_BPS, BOUNTY);
        _fund(dao, DEMO_TREASURY);
    }

    function test_loneMemberCannotExtractTreasuryWithoutPassedProposal() public {
        uint256 start = block.timestamp;
        uint256[] memory ids = new uint256[](CYCLES);
        for (uint256 i; i < CYCLES; ++i) {
            // A throwaway proposal nobody else votes on: it can never reach quorum (1 of 3 < 50%).
            bytes memory proposeCall = abi.encodeCall(
                SealedDAO.propose, (SealedDAO.ActionKind.TransferUSDC, alice, 1, false, "x", "", TEN_MINUTES)
            );
            ids[i] = abi.decode(_tx(alice, proposeCall), (uint256));
            bytes32 commitment = dao.hashVote(ids[i], alice, SealedDAO.Choice.Abstain, _salt(ids[i], alice));
            _tx(alice, abi.encodeCall(SealedDAO.vote, (ids[i], commitment, _ciphertext(VOTE_CT_LENGTH))));
        }

        vm.warp(_closeTime(ids[0])); // every proposal closes at the same round: 600 s after the first propose
        for (uint256 i; i < CYCLES; ++i) {
            bytes32[] memory salts = new bytes32[](1);
            salts[0] = _salt(ids[i], alice);
            _tx(alice, abi.encodeCall(SealedDAO.revealBatch, (ids[i], _addrs(alice), _choices(_abstain()), salts)));
        }

        uint256 elapsed = block.timestamp - start;
        uint256 extracted = dao.claimable(alice);
        uint256 gasCostUnits = gasSpent / GAS_PER_USDC_UNIT;
        console.log("free treasury left (USDC units):", usdc.balanceOf(address(dao)) - dao.totalClaimable());
        console.log("bounty credited to the lone member (USDC units):", extracted);
        console.log("gas paid by the lone member (gas, USDC units at 20 gwei):", gasSpent, gasCostUnits);
        console.log("seconds from first propose to empty treasury:", elapsed);

        // Nothing passed: the only proposals are the member's own, each 1 sealed vote of 3.
        for (uint256 i; i < CYCLES; ++i) {
            assertLt(uint256(dao.proposal(ids[i]).sealedCount) * 10_000, 3 * uint256(QUORUM_BPS), "no quorum");
            assertEq(dao.proposal(ids[i]).revealedCount, 1, "the reveals themselves still count");
        }
        // The fastest removal of the member (a SetMember proposal) needs MIN_VOTING + the 24 h reveal window, so only
        // the contract itself can stop the farm.
        assertLt(elapsed, dao.MIN_VOTING() + dao.REVEAL_WINDOW() * dao.QUICKNET_PERIOD(), "farm beats removal");
        // PRD 7: the treasury is drained only via passed proposals. A lone member must not end with more USDC credited
        // than the gas it spent: with the quorum-gated bounty nothing is credited at all.
        assertLe(extracted, gasCostUnits, "lone member extracted net USDC from the treasury without a passed proposal");
        assertEq(extracted, 0, "no bounty below quorum");
        assertEq(dao.totalClaimable(), 0);
        assertEq(usdc.balanceOf(address(dao)), DEMO_TREASURY, "free treasury intact");
    }

    /// @dev Sends `data` to the DAO from `from` as its own transaction (cold storage) and adds its modelled tx gas.
    function _tx(address from, bytes memory data) internal returns (bytes memory ret) {
        vm.cool(address(dao));
        vm.cool(address(usdc));
        vm.prank(from);
        bool ok;
        (ok, ret) = address(dao).call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        Vm.Gas memory g = vm.lastCallGas();
        gasSpent += _txGas(data, g.gasTotalUsed, g.gasRefunded);
    }

    /// @dev Same Prague transaction model as test/unit/SealedDAO.gas.t.sol (checked against anvil receipts there).
    function _txGas(bytes memory data, uint256 execution, int64 refunded) internal pure returns (uint256) {
        uint256 zeros;
        for (uint256 i; i < data.length; ++i) {
            if (data[i] == 0) ++zeros;
        }
        uint256 nonZeros = data.length - zeros;
        uint256 standard = 21_000 + 4 * zeros + 16 * nonZeros + execution;
        // casting to 'uint256' is safe because the branch only runs for a positive int64
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 refund = refunded > 0 ? uint256(int256(refunded)) : 0;
        if (refund > standard / 5) refund = standard / 5;
        uint256 used = standard - refund;
        uint256 floor = 21_000 + 10 * (zeros + 4 * nonZeros);
        return used > floor ? used : floor;
    }
}
