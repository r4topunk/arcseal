// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SealedDAO} from "../src/SealedDAO.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @notice Deterministic CREATE2 deployment of SealedDAO through the canonical deployer
///         0x4e59b44847b379578588920cA78FbF26c0B4956C (present on Arc mainnet, Arc testnet and every local anvil),
///         salt keccak256("arcseal.v1"). The address depends only on the salt and the init code (bytecode plus
///         constructor arguments), so the same members on mainnet and testnet give the same address.
///
/// Signer: a Foundry encrypted keystore held by the human operator (see DEPLOY.md). No private keys in env or code.
/// The e2e dry run (scripts/e2e-testnet.ts --dry-run) runs this same script against a local anvil with --unlocked.
///
/// Env:
///   INITIAL_MEMBERS  required, comma-separated member addresses (PRD D16: the three demo wallets)
///   QUORUM_BPS       default 5000 (half the members must seal)
///   REVEAL_BOUNTY    default 10000 (0.01 USDC per revealed vote)
///   SALT_LABEL       default "arcseal.v1"; salt = keccak256(bytes(label)). A new label only for a new deployment.
///   USDC_ADDRESS     default 0x3600...0000; any other value is accepted only on a local chain (31337)
///
///   # simulation only (no --broadcast): prints the predicted address, sends nothing
///   env INITIAL_MEMBERS=0xA,0xB,0xC forge script script/Deploy.s.sol --rpc-url arc --account arcseal-deployer \
///     --sender 0xDEPLOYER
///   # real deploy (operator only): the same command plus --broadcast, then record it
///   node script/record-deployment.mjs 5042
contract Deploy is Script {
    /// @notice Canonical CREATE2 deployer (Arachnid's deterministic-deployment-proxy). Forge routes
    ///         `new C{salt: s}()` through it when broadcasting.
    address public constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @notice Arc USDC, ERC-20 view (6 decimals), on mainnet and testnet.
    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    /// @notice Salt label of the v1 deployment. Never reuse it for different bytecode or arguments.
    string public constant DEFAULT_SALT_LABEL = "arcseal.v1";
    /// @notice Demo quorum: half the members (PRD 10.2).
    uint16 public constant DEFAULT_QUORUM_BPS = 5000;
    /// @notice Demo bounty: 0.01 USDC per revealed vote (PRD 10.2).
    uint256 public constant DEFAULT_REVEAL_BOUNTY = 10_000;

    uint256 internal constant ARC_MAINNET = 5042;
    uint256 internal constant ARC_TESTNET = 5042002;
    uint256 internal constant LOCAL = 31337;

    /// @notice Constructor arguments plus the salt label.
    struct Params {
        address usdc;
        address[] members;
        uint16 quorumBps;
        uint256 revealBounty;
        string saltLabel;
    }

    error UnsupportedChain(uint256 chainId);
    error MissingCreate2Deployer();
    error UsdcOverrideNotAllowed(address usdc);
    error WrongTokenDecimals(address token, uint8 decimals);
    error MissingToken(address token);
    error QuorumOutOfRange(uint256 quorumBps);
    error AddressMismatch(address expected, address actual);
    error StateMismatch(string field);

    /// @notice Entry point of `forge script`: reads the parameters from env, then deploys (or skips).
    function run() external returns (SealedDAO dao) {
        return deploy(paramsFromEnv());
    }

    /// @notice Deployment parameters from env, with the demo defaults. Reverts on an unsupported chain, a missing
    ///         INITIAL_MEMBERS, a USDC override outside a local chain, or a quorum that does not fit uint16.
    function paramsFromEnv() public view returns (Params memory p) {
        uint256 chainId = block.chainid;
        _requireSupportedChain(chainId);

        p.usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        if (chainId != LOCAL && p.usdc != ARC_USDC) revert UsdcOverrideNotAllowed(p.usdc);
        p.members = vm.envAddress("INITIAL_MEMBERS", ",");

        uint256 quorum = vm.envOr("QUORUM_BPS", uint256(DEFAULT_QUORUM_BPS));
        if (quorum > type(uint16).max) revert QuorumOutOfRange(quorum);
        // forge-lint: disable-next-line(unsafe-typecast)
        p.quorumBps = uint16(quorum); // checked against uint16 max just above
        p.revealBounty = vm.envOr("REVEAL_BOUNTY", DEFAULT_REVEAL_BOUNTY);
        p.saltLabel = vm.envOr("SALT_LABEL", DEFAULT_SALT_LABEL);
    }

    /// @notice CREATE2 salt of a label: keccak256(bytes(label)).
    function saltOf(string memory label) public pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /// @notice Init code sent to the CREATE2 deployer: creation bytecode plus the ABI-encoded constructor arguments.
    function initCode(Params memory p) public pure returns (bytes memory) {
        return
            abi.encodePacked(type(SealedDAO).creationCode, abi.encode(p.usdc, p.members, p.quorumBps, p.revealBounty));
    }

    /// @notice Address SealedDAO gets for `p` on any chain that has the CREATE2 deployer.
    function predict(Params memory p) public pure returns (address) {
        return vm.computeCreate2Address(saltOf(p.saltLabel), keccak256(initCode(p)), CREATE2_DEPLOYER);
    }

    /// @notice Deploys SealedDAO for `p` through the CREATE2 deployer, or returns the existing contract when the
    ///         predicted address already has code (idempotent). Checks the deployed state against `p`.
    function deploy(Params memory p) public returns (SealedDAO dao) {
        uint256 chainId = block.chainid;
        _requireSupportedChain(chainId);
        if (CREATE2_DEPLOYER.code.length == 0) revert MissingCreate2Deployer();
        _requireUsdc(p.usdc);

        address expected = predict(p);
        console2.log("chainId", chainId);
        console2.log("usdc", p.usdc);
        for (uint256 i; i < p.members.length; ++i) {
            console2.log("member", p.members[i]);
        }
        console2.log("quorumBps", p.quorumBps);
        console2.log("revealBounty (USDC base units)", p.revealBounty);
        console2.log("salt label", p.saltLabel);
        console2.log("salt");
        console2.logBytes32(saltOf(p.saltLabel));
        console2.log("SealedDAO (CREATE2)", expected);

        if (expected.code.length > 0) {
            console2.log("already deployed, nothing to do");
            return SealedDAO(expected);
        }

        vm.startBroadcast();
        dao = new SealedDAO{salt: saltOf(p.saltLabel)}(p.usdc, p.members, p.quorumBps, p.revealBounty);
        vm.stopBroadcast();

        if (address(dao) != expected) revert AddressMismatch(expected, address(dao));
        _requireState(dao, p);
        console2.log("deployed", address(dao));
    }

    function _requireSupportedChain(uint256 chainId) internal pure {
        if (chainId != ARC_MAINNET && chainId != ARC_TESTNET && chainId != LOCAL) revert UnsupportedChain(chainId);
    }

    /// @dev The token must exist and report 6 decimals (Arc USDC's ERC-20 view, or MockUSDC on anvil).
    function _requireUsdc(address token) internal view {
        if (token.code.length == 0) revert MissingToken(token);
        uint8 decimals = IERC20Decimals(token).decimals();
        if (decimals != 6) revert WrongTokenDecimals(token, decimals);
    }

    /// @dev Reads the new contract back: every constructor argument landed where the PRD says it does.
    function _requireState(SealedDAO dao, Params memory p) internal view {
        if (address(dao.usdc()) != p.usdc) revert StateMismatch("usdc");
        if (dao.quorumBps() != p.quorumBps) revert StateMismatch("quorumBps");
        if (dao.revealBounty() != p.revealBounty) revert StateMismatch("revealBounty");
        if (dao.memberCount() != p.members.length) revert StateMismatch("memberCount");
        for (uint256 i; i < p.members.length; ++i) {
            if (!dao.isMember(p.members[i])) revert StateMismatch("member");
        }
        if (dao.proposalCount() != 0) revert StateMismatch("proposalCount");
    }
}
