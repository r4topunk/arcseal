// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Sealed
/// @notice Timelock-sealed commitments on drand quicknet rounds: the onchain half of ArcSeal.
/// @dev Abstract module (PRD D7): an app inherits it; it is never deployed on its own. See docs/SPEC.md.
///
///      A group (one per proposal in SealedDAO) has a close round and a reveal window. A sealer posts a hash
///      commitment plus a tlock ciphertext that anyone can decrypt once drand publishes the close round. Only the
///      commitment is stored; the ciphertext is emitted in the `Sealed` event and never written to state (D10).
///      After the close, anyone who decrypted a ciphertext reveals it by hash (D11): this contract never parses
///      ciphertexts and never verifies drand signatures. It knows nothing about votes.
///
///      Time model (PRD 4.1): quicknet publishes round r at
///      roundTime(r) = QUICKNET_GENESIS + (r - 1) * QUICKNET_PERIOD.
///      Sealing is open while block.timestamp < roundTime(closeRound). Revealing is open while
///      roundTime(closeRound) <= block.timestamp < roundTime(revealEndRound). A group exists iff closeRound != 0
///      (round 0 does not exist on drand, so an opened group always has closeRound >= 1).
///
///      Reveal flow for inheritors: the reveal window is enforced inside `_consumeReveal` (and `_reveal`), so no
///      commitment can be consumed outside it. `_verifyReveal` is a pure comparison without a window check, so a
///      batch caller calls `_requireRevealOpen` once up front (an out-of-window batch then reverts even when every
///      item would be skipped), then per item `_verifyReveal` and, on true, `_consumeReveal`.
///
///      The event `Sealed` shares the contract's name on purpose (the SDK reads `Sealed` logs). solc warns about the
///      shadowing (2519); foundry.toml silences that code for this file only.
abstract contract Sealed {
    /// @notice Round bookkeeping of one group.
    /// @param closeRound First drand round at or after the end of the sealing phase; its ciphertexts open here.
    /// @param revealEndRound closeRound + REVEAL_WINDOW; revealing is closed from roundTime(revealEndRound) on.
    struct SealGroup {
        uint64 closeRound;
        uint64 revealEndRound;
    }

    /// @notice drand quicknet genesis time in unix seconds; round 1 is published at this instant.
    uint256 public constant QUICKNET_GENESIS = 1_692_803_367;
    /// @notice drand quicknet period in seconds.
    uint256 public constant QUICKNET_PERIOD = 3;
    /// @notice Reveal window length in rounds (28,800 rounds x 3 s = 24 h).
    uint64 public constant REVEAL_WINDOW = 28_800;
    /// @notice Shortest sealing phase `_openGroup` accepts, in seconds (10 minutes).
    uint32 public constant MIN_VOTING = 600;
    /// @notice Longest sealing phase `_openGroup` accepts, in seconds.
    uint32 public constant MAX_VOTING = 7 days;
    /// @notice Shortest accepted ciphertext in bytes: the flat tlock + age overhead measured for quicknet.
    uint256 public constant MIN_CIPHERTEXT_LENGTH = 359;
    /// @notice Longest accepted ciphertext in bytes (caps calldata and log cost per seal).
    uint256 public constant MAX_CIPHERTEXT_LENGTH = 1024;
    /// @notice Stored in place of a commitment once it is revealed, so it can never be revealed twice.
    bytes32 public constant REVEALED = bytes32(uint256(1));

    /// @notice Round bookkeeping per group. closeRound == 0 means the group was never opened.
    mapping(uint256 groupId => SealGroup) internal _groups;
    /// @notice Live commitment per (group, sealer): 0 if never sealed, REVEALED once revealed.
    mapping(uint256 groupId => mapping(address sealer => bytes32)) internal _commitments;

    /// @notice A group was opened; its ciphertexts must be encrypted to `closeRound`.
    /// @param groupId The group (proposal) id.
    /// @param closeRound Sealing closes at roundTime(closeRound) and revealing opens at the same instant.
    /// @param revealEndRound Revealing closes at roundTime(revealEndRound).
    event SealGroupOpened(uint256 indexed groupId, uint64 closeRound, uint64 revealEndRound);

    /// @notice A sealer committed. The ciphertext exists only in this log, never in storage.
    /// @param groupId The group the commitment belongs to.
    /// @param sealer The address the commitment is bound to.
    /// @param commitment The hash that a later reveal must match.
    /// @param ciphertext Raw (not armored) tlock ciphertext to the group's close round.
    event Sealed(uint256 indexed groupId, address indexed sealer, bytes32 commitment, bytes ciphertext);

    /// @notice A commitment was revealed and consumed.
    /// @param groupId The group the commitment belongs to.
    /// @param sealer The address the commitment was bound to.
    /// @param commitment The consumed commitment (its storage slot now holds REVEALED).
    event Revealed(uint256 indexed groupId, address indexed sealer, bytes32 commitment);

    /// @notice Sealing is not open: the group does not exist or roundTime(closeRound) has been reached.
    error SealingClosed();
    /// @notice Revealing is not open yet: the group does not exist or roundTime(closeRound) is still ahead.
    error RevealNotOpen();
    /// @notice The reveal window is over: roundTime(revealEndRound) has been reached.
    error RevealClosed();
    /// @notice The sealer already has a commitment in this group (commits are final, D8).
    error AlreadySealed();
    /// @notice The sealer has no live commitment in this group (never sealed, or already revealed).
    error NothingSealed();
    /// @notice A strict single reveal (`_reveal`) did not match the live commitment.
    error BadReveal();
    /// @notice The sealing phase is outside [MIN_VOTING, MAX_VOTING] seconds.
    error BadDuration();
    /// @notice The ciphertext is outside [MIN_CIPHERTEXT_LENGTH, MAX_CIPHERTEXT_LENGTH] bytes.
    error BadCiphertextLength();
    /// @notice The commitment is 0 (would read as "not sealed") or REVEALED (would read as "already revealed").
    error BadCommitment();
    /// @notice `_openGroup` was called for a group id that is already open.
    error GroupAlreadyOpen();
    /// @notice A round number does not fit in uint64.
    error RoundOverflow();

    // ------------------------------------------------------------------
    // Internal API for inheritors
    // ------------------------------------------------------------------

    /// @notice Opens `groupId` with a sealing phase of `votingSeconds` from now.
    /// @dev closeRound = roundAfter(block.timestamp + votingSeconds), so the close is the first round published at or
    ///      after the requested end (never earlier). revealEndRound = closeRound + REVEAL_WINDOW. Reverts
    ///      BadDuration outside [MIN_VOTING, MAX_VOTING] and GroupAlreadyOpen for an existing group, so rounds can
    ///      never be rewritten under live commitments. Like `roundAfter`, panics if the end is before
    ///      QUICKNET_GENESIS, which only happens on a local chain that was not warped past 2023-08-23.
    /// @param groupId Fresh group id chosen by the inheritor (SealedDAO uses the proposal id).
    /// @param votingSeconds Length of the sealing phase in seconds.
    /// @return closeRound The drand round sealers must encrypt to.
    function _openGroup(uint256 groupId, uint32 votingSeconds) internal returns (uint64 closeRound) {
        if (votingSeconds < MIN_VOTING || votingSeconds > MAX_VOTING) revert BadDuration();
        if (_groups[groupId].closeRound != 0) revert GroupAlreadyOpen();

        closeRound = roundAfter(block.timestamp + votingSeconds);
        uint64 revealEndRound = closeRound + REVEAL_WINDOW;
        _groups[groupId] = SealGroup({closeRound: closeRound, revealEndRound: revealEndRound});
        emit SealGroupOpened(groupId, closeRound, revealEndRound);
    }

    /// @notice Records `sealer`'s commitment in `groupId` and emits the ciphertext.
    /// @dev Checks in order: sealing open (SealingClosed, also for an unknown group), no prior commitment
    ///      (AlreadySealed, also after a reveal), commitment not 0 or REVEALED (BadCommitment), ciphertext length
    ///      in bounds (BadCiphertextLength). The ciphertext is never parsed: a malformed one only fails to decrypt
    ///      later. Authorization of `sealer` is the inheritor's job.
    /// @param groupId The open group.
    /// @param sealer The address the commitment is bound to (msg.sender in SealedDAO).
    /// @param commitment Hash binding the group, the sealer and the secret payload (D11).
    /// @param ciphertext Raw tlock ciphertext to the group's close round; only emitted, never stored.
    function _seal(uint256 groupId, address sealer, bytes32 commitment, bytes calldata ciphertext) internal {
        if (!sealingOpen(groupId)) revert SealingClosed();
        mapping(address => bytes32) storage commitments = _commitments[groupId];
        if (commitments[sealer] != bytes32(0)) revert AlreadySealed();
        if (commitment == bytes32(0) || commitment == REVEALED) revert BadCommitment();
        uint256 length = ciphertext.length;
        if (length < MIN_CIPHERTEXT_LENGTH || length > MAX_CIPHERTEXT_LENGTH) revert BadCiphertextLength();

        commitments[sealer] = commitment;
        emit Sealed(groupId, sealer, commitment, ciphertext);
    }

    /// @notice Whether `expected` equals `sealer`'s live commitment in `groupId`.
    /// @dev Pure comparison for batch callers: never reverts, does not check the reveal window, and returns false
    ///      for a sealer without a commitment or with a consumed one (REVEALED), whatever `expected` is.
    /// @param groupId The group.
    /// @param sealer The sealer whose commitment is checked.
    /// @param expected The commitment recomputed from the decrypted payload.
    /// @return ok True iff a live commitment exists and equals `expected`.
    function _verifyReveal(uint256 groupId, address sealer, bytes32 expected) internal view returns (bool ok) {
        bytes32 stored = _commitments[groupId][sealer];
        ok = stored == expected && stored != bytes32(0) && stored != REVEALED;
    }

    /// @notice Consumes `sealer`'s live commitment: replaces it with REVEALED and emits `Revealed`.
    /// @dev Enforces the reveal window itself (RevealNotOpen / RevealClosed) and reverts NothingSealed for a sealer
    ///      without a live commitment, so a second consume reverts. Does NOT compare hashes: call `_verifyReveal`
    ///      first (batch path) or use `_reveal` (strict single path).
    /// @param groupId The group, inside its reveal window.
    /// @param sealer The sealer whose commitment is consumed.
    function _consumeReveal(uint256 groupId, address sealer) internal {
        _requireRevealOpen(groupId);
        _markRevealed(groupId, sealer);
    }

    /// @notice Strict single reveal: checks the window, reverts BadReveal unless `expected` matches, then consumes.
    /// @dev For inheritors that reveal one item per call. A missing or consumed commitment also reverts BadReveal.
    /// @param groupId The group, inside its reveal window.
    /// @param sealer The sealer whose commitment is revealed.
    /// @param expected The commitment recomputed from the decrypted payload.
    function _reveal(uint256 groupId, address sealer, bytes32 expected) internal {
        _requireRevealOpen(groupId);
        if (!_verifyReveal(groupId, sealer, expected)) revert BadReveal();
        _markRevealed(groupId, sealer);
    }

    /// @notice Reverts unless `groupId` is inside its reveal window.
    /// @dev RevealNotOpen for an unknown group or before roundTime(closeRound); RevealClosed from
    ///      roundTime(revealEndRound) on. Batch callers use it once before looping over items.
    /// @param groupId The group.
    function _requireRevealOpen(uint256 groupId) internal view {
        SealGroup memory group = _groups[groupId];
        if (group.closeRound == 0 || block.timestamp < roundTime(group.closeRound)) revert RevealNotOpen();
        if (block.timestamp >= roundTime(group.revealEndRound)) revert RevealClosed();
    }

    // ------------------------------------------------------------------
    // Round math and windows
    // ------------------------------------------------------------------

    /// @notice The latest quicknet round published at or before `t`: (t - GENESIS) / PERIOD + 1.
    /// @dev Reverts with Panic(0x11) (checked arithmetic) for t < QUICKNET_GENESIS, where no round exists, and with
    ///      RoundOverflow if the round does not fit in uint64 (t beyond about 5.5e19; never truncates).
    /// @param t Unix timestamp in seconds.
    /// @return The round number (>= 1).
    function roundAt(uint256 t) public pure returns (uint64) {
        return _toRound((t - QUICKNET_GENESIS) / QUICKNET_PERIOD + 1);
    }

    /// @notice The first quicknet round published at or after `t`: roundAt(t), plus 1 unless t is a round boundary.
    /// @dev Computed as ceil((t - GENESIS) / PERIOD) + 1, which equals that definition, with no branch on the
    ///      remainder: `propose` then costs the same gas in every second, so a gas estimate taken one second before
    ///      inclusion stays exact. `elapsed + PERIOD - 1` cannot overflow because elapsed <= 2^256 - 1 - GENESIS.
    ///      Same revert rules as `roundAt`: Panic(0x11) for t < QUICKNET_GENESIS, RoundOverflow past uint64.
    /// @param t Unix timestamp in seconds.
    /// @return The round number (>= 1).
    function roundAfter(uint256 t) public pure returns (uint64) {
        uint256 elapsed = t - QUICKNET_GENESIS;
        return _toRound((elapsed + QUICKNET_PERIOD - 1) / QUICKNET_PERIOD + 1);
    }

    /// @notice Unix time at which quicknet publishes round `r`: GENESIS + (r - 1) * PERIOD.
    /// @dev Round 0 does not exist: roundTime(0) reverts with Panic(0x11). Computed in uint256, so every uint64
    ///      round maps without overflow.
    /// @param r Round number (>= 1).
    /// @return Unix timestamp in seconds.
    function roundTime(uint64 r) public pure returns (uint256) {
        return QUICKNET_GENESIS + (uint256(r) - 1) * QUICKNET_PERIOD;
    }

    /// @notice Whether `groupId` accepts seals now: the group exists and block.timestamp < roundTime(closeRound).
    /// @param groupId The group.
    /// @return True while sealing is open.
    function sealingOpen(uint256 groupId) public view returns (bool) {
        uint64 closeRound = _groups[groupId].closeRound;
        return closeRound != 0 && block.timestamp < roundTime(closeRound);
    }

    /// @notice Whether `groupId` accepts reveals now:
    ///         roundTime(closeRound) <= block.timestamp < roundTime(revealEndRound).
    /// @param groupId The group.
    /// @return True while the reveal window is open. False for an unknown group.
    function revealOpen(uint256 groupId) public view returns (bool) {
        SealGroup memory group = _groups[groupId];
        return group.closeRound != 0 && block.timestamp >= roundTime(group.closeRound)
            && block.timestamp < roundTime(group.revealEndRound);
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    /// @dev Replaces a live commitment with REVEALED and emits `Revealed`. Callers enforce the window.
    function _markRevealed(uint256 groupId, address sealer) private {
        mapping(address => bytes32) storage commitments = _commitments[groupId];
        bytes32 stored = commitments[sealer];
        if (stored == bytes32(0) || stored == REVEALED) revert NothingSealed();
        commitments[sealer] = REVEALED;
        emit Revealed(groupId, sealer, stored);
    }

    /// @dev Checked narrowing to uint64: reverts RoundOverflow instead of truncating.
    function _toRound(uint256 round) private pure returns (uint64) {
        if (round > type(uint64).max) revert RoundOverflow();
        // casting to 'uint64' is safe because the line above rejects every value above type(uint64).max
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(round);
    }
}
