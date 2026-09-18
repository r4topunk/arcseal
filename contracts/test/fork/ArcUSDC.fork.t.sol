// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";

/// @notice The FiatToken views the fork test reads (SealedDAO itself uses only balanceOf and transfer).
interface IFiatTokenView {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice PRD 8.1 "Fork": read-only checks against Arc's real USDC on a LOCAL fork. Nothing is ever broadcast.
///         Skipped unless ARC_RPC is set, so offline `forge test` stays green:
///           env ARC_RPC=https://rpc.mainnet.arc.io forge test --match-contract ArcUsdcForkTest -vv
///         Optional: ARC_FORK_BLOCK=<n> pins the block (lets forge cache fork state).
contract ArcUsdcForkTest is Test {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_MAINNET = 5042;
    uint256 internal constant ARC_TESTNET = 5042002;
    /// @dev FiatTokenProxy (ZeppelinOS AdminUpgradeabilityProxy) implementation slot:
    ///      keccak256("org.zeppelinos.proxy.implementation").
    bytes32 internal constant FIAT_TOKEN_PROXY_IMPLEMENTATION_SLOT =
        0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;

    bool internal enabled;
    IFiatTokenView internal usdc = IFiatTokenView(USDC);

    function setUp() public {
        string memory rpc = vm.envOr("ARC_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        uint256 forkBlock = vm.envOr("ARC_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        enabled = true;
    }

    modifier onlyFork() {
        if (!enabled) {
            vm.skip(true, "set ARC_RPC to run the read-only Arc fork tests");
            return;
        }
        _;
    }

    function test_fork_usdcIsSixDecimals() public onlyFork {
        assertTrue(block.chainid == ARC_MAINNET || block.chainid == ARC_TESTNET, "not an Arc chain");
        assertGt(USDC.code.length, 0);
        assertEq(usdc.decimals(), 6);
    }

    function test_fork_balanceOfWorks() public onlyFork {
        address holder = makeAddr("arcseal-fork-holder");
        assertEq(usdc.balanceOf(holder), 0);
        // Arc keeps one balance: 1.5 native USDC (18-decimal view) is 1_500_000 in the 6-decimal ERC-20 view
        vm.deal(holder, 1.5 ether);
        assertEq(usdc.balanceOf(holder), 1_500_000);
    }

    /// @dev The DAO's treasury accounting on the real token (local fork state only). Funding goes through the native
    ///      balance (vm.deal), because a USDC `transfer` cannot run on a plain fork: FiatToken on Arc calls a native-coin
    ///      precompile at 0x1800000000000000000000000000000000000000 that only Arc nodes implement (the local EVM
    ///      stops with OpcodeNotFound). So `claim` is not exercised here; every call below only reads `balanceOf`.
    function test_fork_daoAccountingWithRealUsdc() public onlyFork {
        address alice = makeAddr("arcseal-fork-alice");
        address bob = makeAddr("arcseal-fork-bob");
        address payee = makeAddr("arcseal-fork-payee");
        address[] memory members = new address[](2);
        (members[0], members[1]) = (alice, bob);
        SealedDAO dao = new SealedDAO(USDC, members, 5000, 10_000);
        vm.deal(address(dao), 2 ether); // 2 USDC in the 6-decimal view
        assertEq(usdc.balanceOf(address(dao)), 2_000_000);

        vm.prank(alice);
        uint256 id = dao.propose(SealedDAO.ActionKind.TransferUSDC, payee, 1_000_000, false, "fork", "", 600);
        bytes memory ct = new bytes(423);
        bytes32[] memory salts = new bytes32[](2);
        SealedDAO.Choice[] memory choices = new SealedDAO.Choice[](2);
        for (uint256 i; i < 2; ++i) {
            (salts[i], choices[i]) = (keccak256(abi.encode("fork-salt", i)), SealedDAO.Choice.For);
            bytes32 commitment = dao.hashVote(id, members[i], choices[i], salts[i]);
            vm.prank(members[i]);
            dao.vote(id, commitment, ct);
        }
        vm.warp(dao.roundTime(dao.proposal(id).closeRound));
        assertEq(dao.revealBatch(id, members, choices, salts), 2);
        assertEq(dao.claimable(address(this)), 20_000, "bounty credited against the real balance");
        vm.warp(dao.roundTime(dao.proposal(id).revealEndRound));
        dao.finalize(id);
        // cold storage, as in a real transaction: the DAO, the USDC proxy and its implementation
        vm.cool(address(dao));
        vm.cool(USDC);
        vm.cool(address(uint160(uint256(vm.load(USDC, FIAT_TOKEN_PROXY_IMPLEMENTATION_SLOT)))));
        dao.execute(id);
        console.log("execute TransferUSDC, real USDC proxy, cold: execution gas %d", vm.lastCallGas().gasTotalUsed);

        assertEq(dao.claimable(payee), 1_000_000);
        assertEq(dao.totalClaimable(), 1_020_000);
        assertGe(usdc.balanceOf(address(dao)), dao.totalClaimable());
    }
}
