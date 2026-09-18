// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SealedDAO} from "../../src/SealedDAO.sol";
import {SealedDAOBaseTest} from "../unit/SealedDAOBase.t.sol";

/// @notice Audit F8 regression (robustness): `description` was capped at 256 bytes but `descriptionURI` had no bound, so
///         any member could store a multi-kilobyte URI that every `proposal(id)` read and ProposalCreated log carries.
///         `propose` now reverts DescriptionURITooLong above MAX_DESCRIPTION_URI_LENGTH (2,048 bytes, the web form's
///         limit). The scheme is still not checked onchain: apps/web links only https://, http:// and ipfs:// URIs
///         (apps/web/test/proposal-form.test.ts), because React 19 only neutralises javascript: hrefs, it does not stop
///         a phishing link.
/// @dev Run: cd contracts && forge test --match-contract AuditF8 -vv
contract AuditF8DescriptionURIUnboundedTest is SealedDAOBaseTest {
    bytes1 internal constant FILL = "A";

    function _uri(string memory prefix, uint256 total) internal pure returns (string memory) {
        bytes memory head = bytes(prefix);
        bytes memory out = new bytes(total);
        for (uint256 i; i < total; ++i) {
            out[i] = i < head.length ? head[i] : FILL;
        }
        return string(out);
    }

    function test_uriLongerThanTheCapIsRejected() public {
        uint256 cap = dao.MAX_DESCRIPTION_URI_LENGTH();
        assertEq(cap, 2048);
        string memory huge = _uri("javascript:alert(document.domain)//", 35 + 16_384);
        vm.prank(alice);
        vm.expectRevert(SealedDAO.DescriptionURITooLong.selector);
        dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, "short", huge, TEN_MINUTES);

        vm.prank(alice);
        vm.expectRevert(SealedDAO.DescriptionURITooLong.selector);
        dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, "short", _uri("https://", cap + 1), 600);
        assertEq(dao.proposalCount(), 0);
    }

    function test_uriAtTheCapIsStored() public {
        string memory uri = _uri("https://example.org/", dao.MAX_DESCRIPTION_URI_LENGTH());
        vm.prank(alice);
        uint256 id = dao.propose(SealedDAO.ActionKind.TransferUSDC, carol, 1, false, "short", uri, TEN_MINUTES);
        assertEq(bytes(dao.proposal(id).descriptionURI).length, 2048);
    }
}
