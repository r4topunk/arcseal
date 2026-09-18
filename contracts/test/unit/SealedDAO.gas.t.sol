// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm, console} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "./SealedDAOBase.t.sol";

/// @notice Per-call gas of the PRD 4.5 calls (docs/GAS.md). Run `forge test --match-contract SealedDAOGas -vv`.
/// @dev One contract per scenario: `setUp` builds the state (forge snapshot does not count setUp gas) and gas metering
///      is paused in the test except around the measured call, so each .gas-snapshot line is that call's gas (plus
///      the CALL itself) and the 5% check guards it directly.
///      The measured call runs on cold storage (`vm.cool` on the DAO and the token), like the first touch in a real
///      transaction, and `vm.lastCallGas` gives its execution gas. Execution gas excludes the 21,000 intrinsic gas and
///      the calldata cost, so each line also prints a full-transaction model: 21,000 + calldata (4 / 16 gas per
///      zero / non-zero byte) + execution - refund (capped at 1/5), floored by EIP-7623 (Prague) at 21,000 + 10 gas
///      per calldata token (zero byte = 1 token, non-zero byte = 4). contracts/script/gas-anvil.sh checks the model
///      against real receipts on a local anvil. The asserts are the PRD 4.5 targets on that model.
abstract contract SealedDAOGasBase is SealedDAOBaseTest {
    struct Measured {
        uint256 execution;
        uint256 txModel;
    }

    /// @dev Pauses gas metering for the whole test; `_measure` meters only the measured call.
    modifier unmetered() {
        vm.pauseGasMetering();
        _;
    }

    /// @dev Runs `data` against the DAO from `from` on cold storage and logs execution and modelled tx gas.
    function _measure(string memory label, address from, bytes memory data) internal returns (Measured memory m) {
        vm.cool(address(dao));
        vm.cool(address(usdc));
        vm.prank(from);
        vm.resumeGasMetering();
        (bool ok, bytes memory ret) = address(dao).call(data);
        vm.pauseGasMetering();
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        Vm.Gas memory g = vm.lastCallGas();
        m.execution = g.gasTotalUsed;
        m.txModel = _txGas(data, g.gasTotalUsed, g.gasRefunded);
        console.log("%s: execution %d, tx model %d", label, m.execution, m.txModel);
    }

    /// @dev Prague transaction gas for calldata `data` and `execution` gas with `refunded` refunds.
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

    /// @dev The PRD 10.2 demo shape on proposal `id`: alice and bob vote For, carol Against; all three are revealed in
    ///      one batch and time moves to the end of the reveal window.
    function _demoToRevealEnd(uint256 id) internal {
        _vote(id, alice, _for());
        _vote(id, bob, _for());
        _vote(id, carol, _against());
        _warpToReveal(id);
        _reveal(id, _addrs(alice, bob, carol), _choices(_for(), _for(), _against()));
        _warpToRevealEnd(id);
    }
}

/// @notice `propose` (informative, no PRD target).
contract SealedDAOGasProposeTest is SealedDAOGasBase {
    function test_gas_propose() public unmetered {
        _measure(
            "propose TransferUSDC (8-byte description, 15-byte URI)",
            alice,
            abi.encodeCall(
                SealedDAO.propose,
                (SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, "pay 1 US", "ipfs://proposal", TEN_MINUTES)
            )
        );
    }
}

/// @notice `vote`: first seal of a member on an open proposal.
contract SealedDAOGasVoteTest is SealedDAOGasBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _proposeTransfer(carol, 1e6);
    }

    function _voteData(uint256 ctLength) internal view returns (bytes memory) {
        return abi.encodeCall(SealedDAO.vote, (id, _commitment(id, alice, _for()), _ciphertext(ctLength)));
    }

    /// @dev PRD 4.5 target size: 96-byte payload + 359 bytes of overhead.
    function test_gas_vote_455() public unmetered {
        assertLe(_measure("vote (455-byte ciphertext)", alice, _voteData(455)).txModel, 80_000, "PRD 4.5: vote");
    }

    /// @dev What the SDK actually sends (PRD 5): 64-byte plaintext + 359 = 423 bytes.
    function test_gas_vote_423() public unmetered {
        assertLe(_measure("vote (423-byte ciphertext)", alice, _voteData(423)).txModel, 80_000, "PRD 4.5: vote");
    }
}

/// @notice `revealBatch` with `n` items: a 256-member DAO where at least 128 members sealed (the 50% quorum, so the
///         bounty is due), `n` of those votes (choices cycle For / Against / Abstain so every tally counter is written)
///         revealed in one batch by a first-time revealer (claimable 0 -> bounty) in a DAO with nothing reserved yet
///         (totalClaimable 0 -> bounty): the worst case of every batch size.
abstract contract SealedDAOGasRevealBatchBase is SealedDAOGasBase {
    uint256 internal constant MEMBER_SEED = 1;
    /// @dev Sealed votes needed for the 50% quorum of 256 members: below it no bounty is credited (audit F1).
    uint256 internal constant QUORUM_SEALERS = 128;
    uint256 internal id;

    function _items() internal pure virtual returns (uint256);

    function setUp() public override {
        super.setUp();
        address[] memory members = _members(256, MEMBER_SEED);
        dao = _deploy(members, QUORUM_BPS, BOUNTY);
        _fund(dao, TREASURY);
        id = _propose(members[0], SealedDAO.ActionKind.TransferUSDC, carol, 1e6, false, TEN_MINUTES);
        uint256 sealers = _items() > QUORUM_SEALERS ? _items() : QUORUM_SEALERS;
        for (uint256 i; i < sealers; ++i) {
            _vote(id, members[i], SealedDAO.Choice((i + 1) % 3));
        }
        _warpToReveal(id);
    }

    /// @dev The batch, rebuilt from pure derivations so the test does not read it back from storage.
    function _batch()
        internal
        view
        returns (address[] memory voters, SealedDAO.Choice[] memory choices, bytes32[] memory salts)
    {
        uint256 n = _items();
        address[] memory members = _members(256, MEMBER_SEED);
        voters = new address[](n);
        choices = new SealedDAO.Choice[](n);
        salts = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            voters[i] = members[i];
            choices[i] = SealedDAO.Choice((i + 1) % 3);
            salts[i] = _salt(id, members[i]);
        }
    }

    function _measureBatch() internal returns (Measured memory m) {
        (address[] memory voters, SealedDAO.Choice[] memory choices, bytes32[] memory salts) = _batch();
        uint256 n = voters.length;
        m = _measure(
            string.concat("revealBatch ", vm.toString(n), " items"),
            revealer,
            abi.encodeCall(SealedDAO.revealBatch, (id, voters, choices, salts))
        );
        console.log("  per item: execution %d, tx model %d", m.execution / n, m.txModel / n);
        assertEq(dao.proposal(id).revealedCount, n);
        assertEq(dao.claimable(revealer), n * BOUNTY, "worst case: the bounty is credited");
    }
}

/// @dev Small batches carry the fixed cost of a call: 21k intrinsic, the tally slots and, for a first-time revealer
///      in a DAO with nothing reserved, two 0 -> non-zero writes (claimable[revealer] and totalClaimable, about 44k
///      together). Per item that is over the 45k target at 1 and 3 items (docs/GAS.md), so no target assert.
contract SealedDAOGasRevealBatch1Test is SealedDAOGasRevealBatchBase {
    function _items() internal pure override returns (uint256) {
        return 1;
    }

    function test_gas_revealBatch() public unmetered {
        _measureBatch();
    }
}

/// @dev The mainnet demo size (three members, one batch). Over the 45k per-item target, see above.
contract SealedDAOGasRevealBatch3Test is SealedDAOGasRevealBatchBase {
    function _items() internal pure override returns (uint256) {
        return 3;
    }

    function test_gas_revealBatch() public unmetered {
        _measureBatch();
    }
}

contract SealedDAOGasRevealBatch10Test is SealedDAOGasRevealBatchBase {
    function _items() internal pure override returns (uint256) {
        return 10;
    }

    function test_gas_revealBatch() public unmetered {
        assertLe(_measureBatch().txModel / 10, 45_000, "PRD 4.5: revealBatch per item");
    }
}

contract SealedDAOGasRevealBatch50Test is SealedDAOGasRevealBatchBase {
    function _items() internal pure override returns (uint256) {
        return 50;
    }

    function test_gas_revealBatch() public unmetered {
        assertLe(_measureBatch().txModel / 50, 45_000, "PRD 4.5: revealBatch per item");
    }
}

contract SealedDAOGasRevealBatch256Test is SealedDAOGasRevealBatchBase {
    function _items() internal pure override returns (uint256) {
        return 256;
    }

    function test_gas_revealBatch() public unmetered {
        assertLe(_measureBatch().txModel / 256, 45_000, "PRD 4.5: revealBatch per item");
    }
}

/// @notice `finalize` after the demo vote (For, For, Against).
contract SealedDAOGasFinalizeTest is SealedDAOGasBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _proposeTransfer(carol, 1e6);
        _demoToRevealEnd(id);
    }

    function test_gas_finalize() public unmetered {
        Measured memory m = _measure("finalize", outsider, abi.encodeCall(SealedDAO.finalize, (id)));
        assertLe(m.txModel, 60_000, "PRD 4.5: finalize");
    }
}

/// @notice `execute` of a passed TransferUSDC and SetMember proposal (demo vote, finalized).
contract SealedDAOGasExecuteTest is SealedDAOGasBase {
    uint256 internal transferToEve;
    uint256 internal addEve;

    function setUp() public override {
        super.setUp();
        transferToEve = _proposeTransfer(eve, 1e6);
        addEve = _proposeSetMember(eve, true, TEN_MINUTES); // same close round as transferToEve
        _vote(addEve, alice, _for());
        _vote(addEve, bob, _for());
        _vote(addEve, carol, _against());
        _vote(transferToEve, alice, _for());
        _vote(transferToEve, bob, _for());
        _vote(transferToEve, carol, _against());
        _warpToReveal(transferToEve);
        _reveal(transferToEve, _addrs(alice, bob, carol), _choices(_for(), _for(), _against()));
        _reveal(addEve, _addrs(alice, bob, carol), _choices(_for(), _for(), _against()));
        _warpToRevealEnd(transferToEve);
        dao.finalize(transferToEve);
        dao.finalize(addEve);
    }

    /// @dev A first payout to eve writes claimable[eve] from 0 to non-zero (about 20k of the total): the price of pull
    ///      payments (D13), which puts this call over the 60k target (docs/GAS.md). No target assert.
    function test_gas_executeTransferUSDC() public unmetered {
        _measure("execute TransferUSDC (fresh recipient)", outsider, abi.encodeCall(SealedDAO.execute, (transferToEve)));
    }

    function test_gas_executeSetMember() public unmetered {
        _measure("execute SetMember (add)", outsider, abi.encodeCall(SealedDAO.execute, (addEve)));
    }
}

/// @notice `execute` TransferUSDC when the recipient already has an unclaimed balance (claimable non-zero -> non-zero).
contract SealedDAOGasExecutePendingClaimTest is SealedDAOGasBase {
    uint256 internal second;

    function setUp() public override {
        super.setUp();
        uint256 first = _proposeTransfer(eve, 1e6);
        second = _proposeTransfer(eve, 2e6); // same close round as `first`
        _vote(first, alice, _for());
        _vote(first, bob, _for());
        _vote(first, carol, _against());
        _vote(second, alice, _for());
        _vote(second, bob, _for());
        _vote(second, carol, _against());
        _warpToReveal(first);
        _reveal(first, _addrs(alice, bob, carol), _choices(_for(), _for(), _against()));
        _reveal(second, _addrs(alice, bob, carol), _choices(_for(), _for(), _against()));
        _warpToRevealEnd(first);
        dao.finalize(first);
        dao.finalize(second);
        dao.execute(first);
    }

    function test_gas_executeTransferUSDC_pendingClaim() public unmetered {
        Measured memory m =
            _measure("execute TransferUSDC (pending claim)", outsider, abi.encodeCall(SealedDAO.execute, (second)));
        assertLe(m.txModel, 60_000, "PRD 4.5: execute TransferUSDC");
    }
}

/// @notice `claim` of a payout.
contract SealedDAOGasClaimTest is SealedDAOGasBase {
    function setUp() public override {
        super.setUp();
        uint256 id = _proposeTransfer(carol, 1e6);
        _demoToRevealEnd(id);
        dao.finalize(id);
        dao.execute(id);
        // on Arc the claimer pays gas in USDC, so its USDC balance slot is already non-zero
        usdc.mint(carol, 1e6);
    }

    function test_gas_claim() public unmetered {
        Measured memory m = _measure("claim", carol, abi.encodeCall(SealedDAO.claim, ()));
        assertLe(m.txModel, 55_000, "PRD 4.5: claim");
    }
}
