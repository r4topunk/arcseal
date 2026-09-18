// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SealedDAO} from "../../src/SealedDAO.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Drives a SealedDAO through random proposals, votes, reveals, finalizations, executions, claims, funding,
///         blocklist toggles and time jumps. Expected failures are caught; anything else reverts the campaign
///         (fail-on-revert), in particular a `revealBatch` inside its window, which must never revert.
contract SealedDAOHandler is Test {
    SealedDAO public dao;
    MockUSDC public usdc;
    address public funder = makeAddr("inv-funder");

    /// @notice Every account that can ever hold a claimable balance or membership (targets and revealers too).
    address[] public actors;

    // ghosts
    mapping(uint256 id => uint256) public ghostSealed;
    mapping(uint256 id => uint256) public ghostRevealed;
    /// @notice Members added by an executed SetMember while proposal `id` was still sealing.
    mapping(uint256 id => uint256) public ghostAddedWhileSealing;
    mapping(uint256 id => bool) public ghostTerminalSeen;
    mapping(uint256 id => SealedDAO.Status) public ghostTerminal;
    bool public ghostLeftTerminal;
    bool public ghostFailedClaimChangedState;
    bool public ghostRevealMismatch;
    uint256 public ghostFunded;
    uint256 public ghostClaimed;

    // coverage counters
    uint256 public proposals;
    uint256 public votes;
    uint256 public reveals;
    uint256 public finalized;
    uint256 public executions;
    uint256 public membersAddedWhileSealing;
    uint256 public claims;
    uint256 public blockedClaims;

    // what each sealer committed to, so reveals can be built
    mapping(uint256 id => address[]) internal _sealers;
    mapping(uint256 id => mapping(address voter => SealedDAO.Choice)) internal _choice;
    mapping(uint256 id => mapping(address voter => bytes32)) internal _salt;

    constructor(SealedDAO dao_, MockUSDC usdc_, address[] memory actors_, uint256 initialFunding) {
        dao = dao_;
        usdc = usdc_;
        actors = actors_;
        ghostFunded = initialFunding;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    /// @dev After every action: Executed and Expired must never be left once reached.
    modifier checkTerminal() {
        _;
        uint256 n = dao.proposalCount();
        for (uint256 id = 1; id <= n; ++id) {
            SealedDAO.Status s = dao.status(id);
            if (ghostTerminalSeen[id]) {
                if (s != ghostTerminal[id]) ghostLeftTerminal = true;
            } else if (s == SealedDAO.Status.Executed || s == SealedDAO.Status.Expired) {
                ghostTerminalSeen[id] = true;
                ghostTerminal[id] = s;
            }
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// @dev A current member most of the time (any actor when seed % 8 == 0, or when nobody is a member).
    function _member(uint256 seed) internal view returns (address) {
        if (seed % 8 == 0) return _actor(seed >> 3);
        address[] memory found = new address[](actors.length);
        uint256 k;
        for (uint256 i; i < actors.length; ++i) {
            if (dao.isMember(actors[i])) found[k++] = actors[i];
        }
        return k == 0 ? _actor(seed) : found[(seed >> 3) % k];
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = dao.proposalCount();
        return n == 0 ? 0 : bound(seed, 1, n);
    }

    /// @dev A proposal in `phase` (Voting, Revealing, Ready or Passed) most of the time, else any proposal id, so the
    ///      failure paths keep being exercised. Returns 0 when there is no proposal.
    function _idIn(uint256 seed, SealedDAO.Status phase) internal view returns (uint256) {
        uint256 n = dao.proposalCount();
        if (n == 0) return 0;
        if (seed % 8 == 0) return _id(seed >> 3);
        uint256[] memory found = new uint256[](n);
        uint256 k;
        for (uint256 id = 1; id <= n; ++id) {
            if (dao.status(id) == phase) found[k++] = id;
        }
        return k == 0 ? _id(seed >> 3) : found[(seed >> 3) % k];
    }

    /// @dev At most 3 proposals in Voting at a time, so votes concentrate and proposals reach quorum.
    function propose(uint256 actorSeed, bool setMember, uint256 targetSeed, uint256 amount, bool flag, uint8 duration)
        external
        checkTerminal
    {
        uint256 open;
        for (uint256 id = 1; id <= dao.proposalCount(); ++id) {
            if (dao.sealingOpen(id)) ++open;
        }
        if (open >= 3) return;
        uint32[4] memory durations = [uint32(600), 1 hours, 1 days, 7 days];
        SealedDAO.ActionKind kind = setMember ? SealedDAO.ActionKind.SetMember : SealedDAO.ActionKind.TransferUSDC;
        address target = _actor(targetSeed);
        // SetMember usually flips the target's membership (add a non-member, remove a member); 1 in 4 is a no-op
        if (targetSeed % 4 != 0) flag = !dao.isMember(target);
        vm.prank(_member(actorSeed));
        try dao.propose(kind, target, bound(amount, 1, 40e6), flag, "inv", "", durations[duration % 4]) returns (
            uint256
        ) {
            ++proposals;
        } catch {}
    }

    function vote(uint256 actorSeed, uint256 idSeed, uint8 rawChoice, bytes32 salt, uint16 ctLength)
        external
        checkTerminal
    {
        uint256 id = _idIn(idSeed, SealedDAO.Status.Voting);
        if (id == 0) return;
        _tryVote(id, _member(actorSeed), rawChoice, salt, ctLength);
    }

    /// @dev Every actor (members and non-members) tries to seal on one proposal, with choices from `choiceSeed`.
    function voteAll(uint256 idSeed, uint256 choiceSeed, bytes32 saltSeed) external checkTerminal {
        uint256 id = _idIn(idSeed, SealedDAO.Status.Voting);
        if (id == 0) return;
        for (uint256 i; i < actors.length; ++i) {
            // truncating to 'uint8' is intended: each actor takes one byte of the seed as its raw choice
            // forge-lint: disable-next-line(unsafe-typecast)
            _tryVote(id, actors[i], uint8(choiceSeed >> (8 * i)), keccak256(abi.encode(saltSeed, i)), 423);
        }
    }

    /// @dev Seals `voter`'s vote if the DAO accepts it; For twice as often as the other choices, so proposals pass.
    ///      1 in 16 ciphertext lengths is outside [359, 1024]: rejected, and it must not count.
    function _tryVote(uint256 id, address voter, uint8 rawChoice, bytes32 salt, uint16 ctLength) internal {
        SealedDAO.Choice choice = SealedDAO.Choice(rawChoice % 4 == 3 ? 1 : rawChoice % 4);
        bytes32 commitment = dao.hashVote(id, voter, choice, salt);
        bytes memory ct = new bytes(ctLength % 16 == 0 ? bound(ctLength, 0, 358) : bound(ctLength, 359, 1024));
        vm.prank(voter);
        try dao.vote(id, commitment, ct) {
            ++ghostSealed[id];
            ++votes;
            _sealers[id].push(voter);
            _choice[id][voter] = choice;
            _salt[id][voter] = salt;
        } catch {}
    }

    /// @dev Reveals a random subset of the sealed votes plus wrong-salt items, duplicates and an unknown voter.
    function revealBatch(uint256 idSeed, uint256 mask, uint256 junkMask, uint256 revealerSeed) external checkTerminal {
        uint256 id = _idIn(idSeed, SealedDAO.Status.Revealing);
        if (id == 0 || !dao.revealOpen(id)) return;
        if (mask % 4 != 0) mask |= type(uint128).max; // usually reveal everything (bit 255, duplicates, stays random)
        _reveal(id, mask, junkMask, revealerSeed);
    }

    /// @dev A reveal batch under construction.
    struct Batch {
        address[] voters;
        SealedDAO.Choice[] choices;
        bytes32[] salts;
        uint256 length;
    }

    function _push(Batch memory b, address voter, SealedDAO.Choice choice, bytes32 salt) internal pure {
        if (b.length == b.voters.length) return;
        (b.voters[b.length], b.choices[b.length], b.salts[b.length]) = (voter, choice, salt);
        ++b.length;
    }

    /// @dev Reveals the sealers selected by `mask`, a wrong-salt item per bit of `junkMask`, an unknown voter, and
    ///      duplicates of the whole batch when bit 255 of `mask` is set. The DAO must count exactly the live ones.
    function _reveal(uint256 id, uint256 mask, uint256 junkMask, uint256 revealerSeed) internal {
        address[] storage sealers = _sealers[id];
        uint256 capacity = 2 * sealers.length + 1;
        Batch memory b = Batch(new address[](capacity), new SealedDAO.Choice[](capacity), new bytes32[](capacity), 0);
        uint256 expected;
        for (uint256 i; i < sealers.length; ++i) {
            address voter = sealers[i];
            if ((junkMask >> i) & 1 == 1) _push(b, voter, _choice[id][voter], ~_salt[id][voter]);
            if ((mask >> i) & 1 == 1) {
                _push(b, voter, _choice[id][voter], _salt[id][voter]);
                if (dao.commitmentOf(id, voter) != dao.REVEALED()) ++expected;
            }
        }
        _push(b, address(uint160(uint256(keccak256(abi.encode(id, mask))))), SealedDAO.Choice.Abstain, 0);
        // duplicate the batch (as far as capacity allows) when the mask asks for it
        if (mask >> 255 == 1) {
            uint256 half = b.length;
            for (uint256 i; i < half; ++i) {
                _push(b, b.voters[i], b.choices[i], b.salts[i]);
            }
        }
        (address[] memory voters, SealedDAO.Choice[] memory choices, bytes32[] memory salts) =
            (b.voters, b.choices, b.salts);
        uint256 k = b.length;
        assembly ("memory-safe") {
            mstore(voters, k)
            mstore(choices, k)
            mstore(salts, k)
        }
        vm.prank(_actor(revealerSeed));
        uint32 revealed = dao.revealBatch(id, voters, choices, salts); // must not revert inside the window
        if (revealed != expected) ghostRevealMismatch = true;
        ghostRevealed[id] += revealed;
        ++reveals;
    }

    function finalize(uint256 idSeed) external checkTerminal {
        uint256 id = _idIn(idSeed, SealedDAO.Status.Ready);
        if (id == 0) return;
        try dao.finalize(id) {
            ++finalized;
        } catch {}
    }

    function execute(uint256 idSeed) external checkTerminal {
        uint256 id = _idIn(idSeed, SealedDAO.Status.Passed);
        if (id == 0) return;
        _tryExecute(id);
    }

    /// @dev Executes `id` if the DAO accepts it; a member add is recorded against every proposal still sealing.
    function _tryExecute(uint256 id) internal {
        try dao.execute(id) {
            ++executions;
            SealedDAO.Proposal memory p = dao.proposal(id);
            if (p.kind == SealedDAO.ActionKind.SetMember && p.flag) {
                uint256 n = dao.proposalCount();
                for (uint256 other = 1; other <= n; ++other) {
                    if (dao.sealingOpen(other)) {
                        ++ghostAddedWhileSealing[other];
                        ++membersAddedWhileSealing;
                    }
                }
            }
        } catch {}
    }

    /// @dev Claims for an actor with a balance most of the time (any actor when seed % 8 == 0).
    function claim(uint256 actorSeed) external checkTerminal {
        address a = _actor(actorSeed);
        for (uint256 i; i < actors.length && actorSeed % 8 != 0; ++i) {
            address candidate = _actor(actorSeed % actors.length + i);
            if (dao.claimable(candidate) != 0) {
                a = candidate;
                break;
            }
        }
        uint256 before = dao.claimable(a);
        uint256 reserved = dao.totalClaimable();
        vm.prank(a);
        try dao.claim() {
            ghostClaimed += before;
            ++claims;
        } catch {
            if (usdc.isBlacklisted(a) && before != 0) ++blockedClaims;
            if (dao.claimable(a) != before || dao.totalClaimable() != reserved) ghostFailedClaimChangedState = true;
        }
    }

    function fund(uint256 amount) external checkTerminal {
        amount = bound(amount, 0, 30e6);
        usdc.mint(funder, amount);
        vm.prank(funder);
        assertTrue(usdc.transfer(address(dao), amount));
        ghostFunded += amount;
    }

    function blocklist(uint256 actorSeed, bool value) external checkTerminal {
        usdc.blacklist(_actor(actorSeed), value);
    }

    /// @dev Pushes one proposal to its next phase: Voting -> every actor tries to seal, then time jumps to the close;
    ///      Revealing -> everything sealed is revealed, then time jumps to the reveal end; Ready -> finalize;
    ///      Passed -> execute. Interleaved with the random actions, this lets full lifecycles (and a member added
    ///      while another proposal is still sealing) happen within one run.
    function advance(uint256 idSeed, uint256 choiceSeed) external checkTerminal {
        uint256 id = idSeed % 4 == 0 ? _id(idSeed >> 2) : _mostUrgent();
        if (id == 0) return;
        SealedDAO.Status st = dao.status(id);
        SealedDAO.Proposal memory p = dao.proposal(id);
        if (st == SealedDAO.Status.Voting) {
            for (uint256 i; i < actors.length; ++i) {
                // truncating to 'uint8' is intended: each actor takes one byte of the seed as its raw choice
                // forge-lint: disable-next-line(unsafe-typecast)
                _tryVote(id, actors[i], uint8(choiceSeed >> (8 * i)), keccak256(abi.encode(choiceSeed, i)), 423);
            }
            vm.warp(dao.roundTime(p.closeRound));
        } else if (st == SealedDAO.Status.Revealing) {
            _reveal(id, type(uint256).max >> 1, 0, choiceSeed);
            vm.warp(dao.roundTime(p.revealEndRound));
        } else if (st == SealedDAO.Status.Ready) {
            dao.finalize(id);
            ++finalized;
        } else if (st == SealedDAO.Status.Passed) {
            _tryExecute(id);
        }
        vm.roll(block.number + 1);
    }

    /// @dev The PRD 4.3 edge in one step: a long proposal P (7 days) is open while a short SetMember proposal adds a
    ///      non-member, passes and is executed; the newcomer then seals on P, so P.sealedCount may exceed
    ///      P.memberSnapshot. Random actions before and after keep interleaving with it.
    function memberAddedMidVote(uint256 seed) external checkTerminal {
        address newcomer;
        for (uint256 i; i < actors.length; ++i) {
            address a = _actor(seed % actors.length + i);
            if (!dao.isMember(a)) {
                newcomer = a;
                break;
            }
        }
        address proposer = _member(1);
        if (newcomer == address(0) || !dao.isMember(proposer)) return;

        vm.startPrank(proposer);
        uint256 longVote = dao.propose(SealedDAO.ActionKind.TransferUSDC, _actor(seed), 1e6, false, "long", "", 7 days);
        uint256 addition = dao.propose(SealedDAO.ActionKind.SetMember, newcomer, 0, true, "add", "", 600);
        vm.stopPrank();
        proposals += 2;
        for (uint256 i; i < actors.length; ++i) {
            _tryVote(addition, actors[i], 1, keccak256(abi.encode(seed, i)), 423);
        }
        vm.warp(dao.roundTime(dao.proposal(addition).closeRound));
        _reveal(addition, type(uint256).max >> 1, 0, seed);
        vm.warp(dao.roundTime(dao.proposal(addition).revealEndRound));
        dao.finalize(addition);
        ++finalized;
        _tryExecute(addition);
        // truncating to 'uint8' is intended: the low byte of the seed is the raw choice
        // forge-lint: disable-next-line(unsafe-typecast)
        if (dao.isMember(newcomer)) _tryVote(longVote, newcomer, uint8(seed), keccak256(abi.encode(seed)), 423);
    }

    /// @dev The live proposal whose next step comes first (finalize / execute now, else the earliest close or reveal
    ///      end), so short proposals complete while long ones are still sealing, as in real time. 0 if none.
    function _mostUrgent() internal view returns (uint256 best) {
        uint256 bestTime = type(uint256).max;
        uint256 n = dao.proposalCount();
        for (uint256 id = 1; id <= n; ++id) {
            SealedDAO.Status st = dao.status(id);
            uint256 at;
            if (st == SealedDAO.Status.Voting) at = dao.roundTime(dao.proposal(id).closeRound);
            else if (st == SealedDAO.Status.Revealing) at = dao.roundTime(dao.proposal(id).revealEndRound);
            else if (st == SealedDAO.Status.Ready || st == SealedDAO.Status.Passed) at = block.timestamp;
            else continue;
            if (at < bestTime) (best, bestTime) = (id, at);
        }
    }

    /// @dev Jumps to the next phase boundary of one proposal (its close, reveal end or grace end), plus 0..59 s.
    function warpToBoundary(uint256 idSeed, uint8 offset) external checkTerminal {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        SealedDAO.Proposal memory p = dao.proposal(id);
        uint256[3] memory boundaries = [
            dao.roundTime(p.closeRound),
            dao.roundTime(p.revealEndRound),
            dao.roundTime(p.revealEndRound) + dao.EXECUTION_GRACE()
        ];
        for (uint256 i; i < 3; ++i) {
            if (boundaries[i] > block.timestamp) {
                vm.warp(boundaries[i] + offset % 60);
                vm.roll(block.number + 1);
                return;
            }
        }
    }

    /// @dev Half the jumps are short (inside a voting phase), half long (across reveal windows and grace periods).
    function warp(uint256 dt) external checkTerminal {
        dt = dt % 2 == 0 ? bound(dt, 0, 1 hours) : bound(dt, 1 hours, 3 days);
        vm.warp(block.timestamp + dt);
        vm.roll(block.number + 1);
    }
}
