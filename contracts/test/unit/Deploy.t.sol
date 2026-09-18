// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev A token that is not USDC's 6-decimal ERC-20 view.
contract EighteenDecimals {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

/// @notice Runs contracts/script/Deploy.s.sol locally: CREATE2 address, constructor state, idempotency, chain and
///         token guards, and the env parsing of `run()`. MockUSDC is etched at Arc's USDC address, as in the e2e dry run.
contract DeployTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    /// @dev Runtime code of the canonical CREATE2 deployer (Arachnid deterministic-deployment-proxy).
    bytes internal constant CREATE2_DEPLOYER_CODE =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    Deploy internal script;
    address[] internal members;

    function setUp() public {
        if (CREATE2_DEPLOYER.code.length == 0) vm.etch(CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE);
        vm.etch(ARC_USDC, address(new MockUSDC()).code);
        script = new Deploy();
        members.push(makeAddr("main"));
        members.push(makeAddr("walletB"));
        members.push(makeAddr("walletC"));
    }

    function _params() internal view returns (Deploy.Params memory p) {
        p.usdc = ARC_USDC;
        p.members = members;
        p.quorumBps = script.DEFAULT_QUORUM_BPS();
        p.revealBounty = script.DEFAULT_REVEAL_BOUNTY();
        p.saltLabel = script.DEFAULT_SALT_LABEL();
    }

    function test_deploy_createsDaoAtPredictedAddressWithConstructorState() public {
        Deploy.Params memory p = _params();
        address predicted = script.predict(p);
        assertEq(predicted.code.length, 0);

        SealedDAO dao = script.deploy(p);

        assertEq(address(dao), predicted);
        assertGt(address(dao).code.length, 0);
        assertEq(address(dao.usdc()), ARC_USDC);
        assertEq(dao.quorumBps(), 5000);
        assertEq(dao.revealBounty(), 10_000);
        assertEq(dao.memberCount(), 3);
        for (uint256 i; i < members.length; ++i) {
            assertTrue(dao.isMember(members[i]));
        }
        assertFalse(dao.isMember(address(this)));
        assertEq(dao.proposalCount(), 0);
        assertEq(dao.totalClaimable(), 0);
    }

    function test_predict_isTheCreate2FormulaOverDeployerSaltAndInitCode() public view {
        Deploy.Params memory p = _params();
        bytes32 salt = keccak256("arcseal.v1");
        assertEq(script.saltOf("arcseal.v1"), salt);
        bytes memory init = abi.encodePacked(
            type(SealedDAO).creationCode, abi.encode(ARC_USDC, members, uint16(5000), uint256(10_000))
        );
        assertEq(keccak256(script.initCode(p)), keccak256(init));
        address manual = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, keccak256(init)))))
        );
        assertEq(script.predict(p), manual);
    }

    function test_deploy_isIdempotent() public {
        Deploy.Params memory p = _params();
        SealedDAO first = script.deploy(p);
        bytes32 codeHash = address(first).codehash;

        SealedDAO second = script.deploy(p);

        assertEq(address(second), address(first));
        assertEq(address(second).codehash, codeHash);
        assertEq(second.memberCount(), 3);
    }

    function test_deploy_sameAddressOnArcMainnetTestnetAndLocal() public {
        Deploy.Params memory p = _params();
        address local = script.predict(p);

        vm.chainId(5042);
        assertEq(script.predict(p), local);
        assertEq(address(script.deploy(p)), local);

        vm.chainId(5042002);
        assertEq(script.predict(p), local);
    }

    function test_predict_changesWithSaltLabelAndArguments() public view {
        Deploy.Params memory p = _params();
        address base = script.predict(p);

        p.saltLabel = "arcseal.v2";
        assertTrue(script.predict(p) != base);

        p = _params();
        p.members[2] = address(0xC0FFEE);
        assertTrue(script.predict(p) != base);

        p = _params();
        p.quorumBps = 6000;
        assertTrue(script.predict(p) != base);

        p = _params();
        p.revealBounty = 0;
        assertTrue(script.predict(p) != base);
    }

    function test_deploy_revert_unsupportedChain() public {
        vm.chainId(1);
        Deploy.Params memory p = _params();
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, uint256(1)));
        script.deploy(p);
    }

    function test_deploy_revert_missingCreate2Deployer() public {
        vm.etch(CREATE2_DEPLOYER, "");
        Deploy.Params memory p = _params();
        vm.expectRevert(Deploy.MissingCreate2Deployer.selector);
        script.deploy(p);
    }

    function test_deploy_revert_missingToken() public {
        Deploy.Params memory p = _params();
        p.usdc = address(0xDEAD);
        vm.expectRevert(abi.encodeWithSelector(Deploy.MissingToken.selector, address(0xDEAD)));
        script.deploy(p);
    }

    function test_deploy_revert_tokenWithoutSixDecimals() public {
        Deploy.Params memory p = _params();
        p.usdc = address(new EighteenDecimals());
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongTokenDecimals.selector, p.usdc, uint8(18)));
        script.deploy(p);
    }

    /// @dev The only test that touches the process env (forge runs tests in parallel; no other test reads these).
    function test_run_readsParamsFromEnv() public {
        // Defaults, when the operator's shell does not set them.
        vm.setEnv("INITIAL_MEMBERS", _joined());
        vm.setEnv("USDC_ADDRESS", vm.toString(ARC_USDC));
        Deploy.Params memory p = script.paramsFromEnv();
        if (!vm.envExists("QUORUM_BPS")) assertEq(p.quorumBps, 5000);
        if (!vm.envExists("REVEAL_BOUNTY")) assertEq(p.revealBounty, 10_000);
        if (!vm.envExists("SALT_LABEL")) assertEq(p.saltLabel, "arcseal.v1");
        assertEq(p.usdc, ARC_USDC);
        assertEq(p.members, members);

        // Explicit values, then the full run() path (deploy through the CREATE2 deployer).
        vm.setEnv("QUORUM_BPS", "6667");
        vm.setEnv("REVEAL_BOUNTY", "0");
        vm.setEnv("SALT_LABEL", "arcseal.test");
        p = script.paramsFromEnv();
        assertEq(p.quorumBps, 6667);
        assertEq(p.revealBounty, 0);
        assertEq(p.saltLabel, "arcseal.test");
        SealedDAO dao = script.run();
        assertEq(address(dao), script.predict(p));
        assertEq(dao.quorumBps(), 6667);
        assertEq(dao.revealBounty(), 0);
        assertEq(dao.memberCount(), 3);

        // A quorum that does not fit uint16 is refused before any deploy.
        vm.setEnv("QUORUM_BPS", "70000");
        vm.expectRevert(abi.encodeWithSelector(Deploy.QuorumOutOfRange.selector, uint256(70_000)));
        script.paramsFromEnv();
        vm.setEnv("QUORUM_BPS", "5000");

        // Another USDC is accepted on a local chain only.
        address mock = address(new MockUSDC());
        vm.setEnv("USDC_ADDRESS", vm.toString(mock));
        assertEq(script.paramsFromEnv().usdc, mock);
        vm.chainId(5042);
        vm.expectRevert(abi.encodeWithSelector(Deploy.UsdcOverrideNotAllowed.selector, mock));
        script.paramsFromEnv();
        vm.setEnv("USDC_ADDRESS", vm.toString(ARC_USDC));
        assertEq(script.paramsFromEnv().usdc, ARC_USDC);
    }

    function _joined() internal view returns (string memory s) {
        for (uint256 i; i < members.length; ++i) {
            s = i == 0 ? vm.toString(members[i]) : string.concat(s, ",", vm.toString(members[i]));
        }
    }
}
