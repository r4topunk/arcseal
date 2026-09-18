// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC20
/// @notice The two ERC-20 functions SealedDAO calls on Arc's USDC (0x3600000000000000000000000000000000000000,
///         6-decimal ERC-20 view of the native balance). Nothing else of the token is relied on (PRD 7, last row).
interface IERC20 {
    /// @notice Balance of `account` in token base units (USDC: 6 decimals).
    function balanceOf(address account) external view returns (uint256);

    /// @notice Moves `amount` from the caller to `to`. FiatToken returns true or reverts (for example on a blocklist).
    function transfer(address to, uint256 amount) external returns (bool);
}
