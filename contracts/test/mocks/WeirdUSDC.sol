// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title WeirdUSDC
/// @notice Hostile token double for SealedDAO's `claim` path: a one-shot reentrancy hook fired inside `transfer`,
///         and transfer modes that return false, return nothing, or revert without data.
/// @dev Arc's USDC has no transfer hooks and always returns true; this mock checks that the DAO does not rely on it.
contract WeirdUSDC {
    /// @notice How `transfer` behaves.
    enum Mode {
        Normal, // moves the balance and returns true
        ReturnFalse, // returns false without moving anything
        ReturnNothing, // moves the balance and returns no data
        RevertEmpty // reverts without data
    }

    /// @notice Balances in base units.
    mapping(address account => uint256) public balanceOf;
    /// @notice Current transfer mode.
    Mode public mode;

    /// @notice Contract called from inside the next `transfer` (cleared once fired).
    address public hookTarget;
    /// @notice Calldata of the hook call.
    bytes public hookData;
    /// @notice Whether the last hook call succeeded.
    bool public hookSucceeded;
    /// @notice Revert data (or return data) of the last hook call.
    bytes public hookResult;

    /// @notice Mints `value` to `to`.
    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    /// @notice Sets the transfer mode.
    function setMode(Mode newMode) external {
        mode = newMode;
    }

    /// @notice Arms a one-shot call to `target` with `data`, fired at the start of the next `transfer`.
    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
    }

    /// @notice ERC-20 transfer with the configured quirks.
    function transfer(address to, uint256 value) external returns (bool) {
        address target = hookTarget;
        if (target != address(0)) {
            hookTarget = address(0);
            (hookSucceeded, hookResult) = target.call(hookData);
        }
        Mode m = mode;
        if (m == Mode.RevertEmpty) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
        if (m == Mode.ReturnFalse) return false;
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        if (m == Mode.ReturnNothing) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return true;
    }
}
