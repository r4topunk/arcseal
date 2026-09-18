// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title MockUSDC
/// @notice Test double of Circle's FiatToken v2.2 as seen through Arc's USDC ERC-20 view (0x3600...0000): 6 decimals,
///         open minting for tests, and a blocklist that makes transfers revert with FiatToken's revert string.
/// @dev Used by the Foundry suites and deployed on local anvil by the SDK tests and contracts/script/gas-anvil.sh.
///      `blacklist(account, true)` makes every transfer / transferFrom / approve that involves `account` (as caller,
///      sender or recipient) revert with "Blacklistable: account is blacklisted"; `blacklist(account, false)` lifts it.
contract MockUSDC {
    /// @notice Token name, as on Arc.
    string public constant name = "USDC";
    /// @notice Token symbol.
    string public constant symbol = "USDC";
    /// @notice ERC-20 view decimals, as on Arc.
    uint8 public constant decimals = 6;

    /// @notice Balances in base units.
    mapping(address account => uint256) public balanceOf;
    /// @notice ERC-20 allowances.
    mapping(address owner => mapping(address spender => uint256)) public allowance;
    /// @notice Blocklist flag per account (FiatToken naming).
    mapping(address account => bool) public isBlacklisted;
    /// @notice Sum of all balances.
    uint256 public totalSupply;

    /// @notice ERC-20 Transfer.
    event Transfer(address indexed from, address indexed to, uint256 value);
    /// @notice ERC-20 Approval.
    event Approval(address indexed owner, address indexed spender, uint256 value);
    /// @notice The blocklist flag of `account` changed.
    event Blacklisted(address indexed account, bool value);

    modifier notBlacklisted(address account) {
        require(!isBlacklisted[account], "Blacklistable: account is blacklisted");
        _;
    }

    /// @notice Mints `value` to `to` (test helper, anyone may call).
    function mint(address to, uint256 value) external {
        require(to != address(0), "FiatToken: mint to the zero address");
        balanceOf[to] += value;
        totalSupply += value;
        emit Transfer(address(0), to, value);
    }

    /// @notice Adds (`value` true) or removes (`value` false) `account` from the blocklist (test helper).
    function blacklist(address account, bool value) external {
        isBlacklisted[account] = value;
        emit Blacklisted(account, value);
    }

    /// @notice ERC-20 approve; reverts if the caller or the spender is blocklisted.
    function approve(address spender, uint256 value)
        external
        notBlacklisted(msg.sender)
        notBlacklisted(spender)
        returns (bool)
    {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice ERC-20 transfer; reverts if the caller or the recipient is blocklisted. Returns true.
    function transfer(address to, uint256 value) external notBlacklisted(msg.sender) notBlacklisted(to) returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /// @notice ERC-20 transferFrom; reverts if the caller, the sender or the recipient is blocklisted.
    function transferFrom(address from, address to, uint256 value)
        external
        notBlacklisted(msg.sender)
        notBlacklisted(from)
        notBlacklisted(to)
        returns (bool)
    {
        require(value <= allowance[from][msg.sender], "ERC20: transfer amount exceeds allowance");
        allowance[from][msg.sender] -= value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(value <= balanceOf[from], "ERC20: transfer amount exceeds balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
