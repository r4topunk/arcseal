// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "./Sealed.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title SealedDAO
/// @notice Member-list DAO with a USDC treasury whose votes stay timelock-encrypted until the voting round closes.
/// @dev Reference app of ArcSeal (PRD 4.3). See docs/SPEC.md and docs/THREATS.md.
///
///      Lifecycle of a proposal (one `Sealed` group per proposal, group id = proposal id):
///      1. `propose` (members): opens the group. Sealing closes at roundTime(closeRound), the first drand round at
///         or after now + votingSeconds.
///      2. `vote` (members): posts keccak256(abi.encode(id, voter, choice, salt)) plus a tlock ciphertext of
///         abi.encode(uint8 choice, bytes32 salt) to closeRound. Only the hash is stored; the ciphertext is logged.
///      3. `revealBatch` (anyone, inside the 24 h reveal window): after drand publishes closeRound, anyone decrypts
///         the logged ciphertexts offchain and submits (voter, choice, salt) triples. Items that do not match a live
///         commitment are skipped, never reverted (D9). The caller is credited `revealBounty` per revealed vote,
///         only when the proposal met quorum and the free treasury covers it (D6; the quorum condition keeps a lone
///         member from draining the treasury with throwaway proposals, see docs/THREATS.md 9).
///      4. `finalize` (anyone, after the reveal window): quorum over SEALED votes against the member count at
///         proposal time; passes iff quorum is met and For > Against among REVEALED votes (D4). Ties fail.
///      5. `execute` (anyone, within EXECUTION_GRACE after the reveal window): credits a USDC payout to the target's
///         `claimable` balance, or adds / removes a member.
///      6. `claim` (anyone with a balance): pulls `claimable[msg.sender]` (D13). Nothing is ever pushed.
///
///      Treasury accounting: `totalClaimable` is USDC owed to claimants. Every credit (payout or bounty) first checks
///      usdc.balanceOf(this) - totalClaimable, so usdc.balanceOf(this) >= totalClaimable always holds and every
///      claim is solvent. `revealBatch`, `execute` and `claim` share one reentrancy lock, so a token that calls back
///      from inside `transfer` cannot credit anything against a balance that is about to leave. Funding is a plain
///      ERC-20 `transfer` to this contract; there is no `receive`, so a native value transfer (the 18-decimal view of
///      the same USDC) reverts. Only `balanceOf` and `transfer` of the token are used.
///
///      Membership (D2): 1 address = 1 vote. Eligibility is `isMember[msg.sender]` when `vote` is called, so a member
///      added mid-vote by another proposal's execution may vote, and a member removed mid-vote cannot vote (a vote
///      sealed before the removal still counts). The member count at proposal time (`memberSnapshot`) is used only as
///      the quorum denominator, so `sealedCount` can exceed `memberSnapshot` in that edge case. The last member can
///      never be removed (`LastMember`), so the DAO always has someone who can propose.
///
///      Immutable (D14): no owner, no upgrade, no pause; parameters are fixed in the constructor.
contract SealedDAO is Sealed {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @notice A vote. Abstain is 0, so an all-zero plaintext decodes to a harmless abstention.
    /// @dev A value above 2 cannot be passed at all: ABI decoding of `Choice` reverts the whole call.
    enum Choice {
        Abstain,
        For,
        Against
    }

    /// @notice What a passed proposal does when executed (D3).
    enum ActionKind {
        TransferUSDC, // credit `amount` USDC to `target`'s claimable balance
        SetMember // set isMember[target] = flag
    }

    /// @notice Derived proposal state (never stored), see `status`.
    enum Status {
        Voting, // sealing open: block.timestamp < roundTime(closeRound)
        Revealing, // reveal window: roundTime(closeRound) <= block.timestamp < roundTime(revealEndRound)
        Ready, // reveal window over, not finalized yet
        Passed, // finalized, passed, executable until roundTime(revealEndRound) + EXECUTION_GRACE
        Failed, // finalized, did not pass (terminal)
        Executed, // executed (terminal)
        Expired // finalized, passed, not executed within the grace period (terminal)
    }

    /// @notice A proposal and its tally, as returned by `proposal`.
    /// @param proposer Member who created it.
    /// @param kind The action executed if it passes.
    /// @param target TransferUSDC: payout recipient. SetMember: the account whose membership changes.
    /// @param amount TransferUSDC: USDC base units (6 decimals). Ignored for SetMember.
    /// @param flag SetMember: true adds, false removes. Ignored for TransferUSDC.
    /// @param description Short text, at most MAX_DESCRIPTION_LENGTH bytes.
    /// @param descriptionURI Optional pointer to a longer text, at most MAX_DESCRIPTION_URI_LENGTH bytes (the scheme
    ///        is not checked onchain; apps must only link safe schemes).
    /// @param closeRound drand round that closes sealing and opens the ciphertexts.
    /// @param revealEndRound closeRound + REVEAL_WINDOW; reveals are accepted until roundTime(revealEndRound).
    /// @param memberSnapshot memberCount at proposal time: the quorum denominator.
    /// @param sealedCount Votes sealed (the quorum numerator).
    /// @param revealedCount Votes revealed: forCount + againstCount + abstainCount.
    /// @param forCount Revealed For votes.
    /// @param againstCount Revealed Against votes.
    /// @param abstainCount Revealed Abstain votes.
    /// @param finalized Set by `finalize`.
    /// @param passed Set by `finalize`: quorum met and forCount > againstCount.
    /// @param executed Set by `execute`.
    struct Proposal {
        address proposer;
        ActionKind kind;
        address target;
        uint256 amount;
        bool flag;
        string description;
        string descriptionURI;
        uint64 closeRound;
        uint64 revealEndRound;
        uint32 memberSnapshot;
        uint32 sealedCount;
        uint32 revealedCount;
        uint32 forCount;
        uint32 againstCount;
        uint32 abstainCount;
        bool finalized;
        bool passed;
        bool executed;
    }

    // ------------------------------------------------------------------
    // Constants, immutables and storage
    // ------------------------------------------------------------------

    /// @notice How long a passed proposal stays executable after its reveal window ends.
    uint256 public constant EXECUTION_GRACE = 7 days;
    /// @notice Maximum number of items in one `revealBatch` call.
    uint256 public constant MAX_BATCH = 256;
    /// @notice Maximum length of `description` in bytes (longer text goes behind `descriptionURI`).
    uint256 public constant MAX_DESCRIPTION_LENGTH = 256;
    /// @notice Maximum length of `descriptionURI` in bytes.
    uint256 public constant MAX_DESCRIPTION_URI_LENGTH = 2048;
    /// @dev Basis-point denominator of `quorumBps`.
    uint256 private constant BPS = 10_000;

    /// @notice The treasury token: USDC's 6-decimal ERC-20 view (0x3600...0000 on Arc).
    IERC20 public immutable usdc;
    /// @notice Quorum in basis points of `memberSnapshot`, in (0, 10_000].
    uint16 public immutable quorumBps;
    /// @notice USDC base units credited to the `revealBatch` caller per revealed vote of a proposal that met quorum
    ///         (0 disables the bounty).
    uint256 public immutable revealBounty;

    /// @notice Current number of members.
    uint32 public memberCount;
    /// @notice Current membership. Changes only through executed SetMember proposals.
    mapping(address account => bool) public isMember;
    /// @notice USDC owed to each account, withdrawn with `claim`.
    mapping(address account => uint256) public claimable;
    /// @notice Number of proposals created; ids run from 1 to proposalCount.
    uint256 public proposalCount;
    /// @notice Proposals by id.
    mapping(uint256 id => Proposal) internal _proposals;
    /// @notice Sum of every `claimable` balance: USDC reserved for claims. usdc.balanceOf(this) >= totalClaimable.
    uint256 public totalClaimable;

    /// @dev Reentrancy lock of `revealBatch`, `execute` and `claim` (EIP-1153 transient storage, cleared at the end
    ///      of each tx).
    bool private transient _entered;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    /// @notice A proposal was created. Its sealed votes arrive as `Sealed` events of group `id`.
    /// @param id The proposal id (also the `Sealed` group id).
    /// @param proposer The member who created it.
    /// @param kind The action.
    /// @param target Payout recipient or member account.
    /// @param amount USDC base units (TransferUSDC).
    /// @param flag Add (true) or remove (false) (SetMember).
    /// @param closeRound Ciphertexts must be encrypted to this drand round.
    /// @param revealEndRound Reveals are accepted until roundTime(revealEndRound).
    /// @param memberSnapshot Quorum denominator.
    /// @param description Short text.
    /// @param descriptionURI Pointer to a longer text.
    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        ActionKind kind,
        address target,
        uint256 amount,
        bool flag,
        uint64 closeRound,
        uint64 revealEndRound,
        uint32 memberSnapshot,
        string description,
        string descriptionURI
    );

    /// @notice A sealed vote was revealed and counted (emitted after the module's `Revealed`).
    /// @param id The proposal.
    /// @param voter The member whose vote it is.
    /// @param choice The decrypted choice.
    event VoteRevealed(uint256 indexed id, address indexed voter, Choice choice);

    /// @notice A `revealBatch` item was skipped: no live commitment matches (wrong choice or salt, unknown voter,
    ///         already revealed, or a duplicate within the same batch).
    /// @param id The proposal.
    /// @param voter The voter named by the skipped item.
    event RevealSkipped(uint256 indexed id, address indexed voter);

    /// @notice The `revealBatch` caller was credited the reveal bounty (claimable, see `claim`). Only a proposal that
    ///         met quorum pays it; below quorum no bounty event is emitted at all.
    /// @param id The proposal.
    /// @param revealer The `revealBatch` caller.
    /// @param amount revealBounty * revealed votes, in USDC base units.
    event BountyCredited(uint256 indexed id, address indexed revealer, uint256 amount);

    /// @notice The free treasury could not cover the bounty of a `revealBatch` call; the reveals still counted.
    /// @param id The proposal.
    event BountySkipped(uint256 indexed id);

    /// @notice A proposal was finalized with this tally.
    /// @param id The proposal.
    /// @param passed Quorum met and forCount > againstCount.
    /// @param forCount Revealed For votes.
    /// @param againstCount Revealed Against votes.
    /// @param abstainCount Revealed Abstain votes.
    /// @param sealedCount Sealed votes (quorum numerator).
    /// @param revealedCount Revealed votes.
    event Finalized(
        uint256 indexed id,
        bool passed,
        uint32 forCount,
        uint32 againstCount,
        uint32 abstainCount,
        uint32 sealedCount,
        uint32 revealedCount
    );

    /// @notice A passed proposal was executed.
    /// @param id The proposal.
    event Executed(uint256 indexed id);

    /// @notice Membership of `account` changed (constructor or an executed SetMember proposal).
    /// @param account The account.
    /// @param isMember Its new membership.
    event MemberSet(address indexed account, bool isMember);

    /// @notice `account` withdrew its claimable USDC.
    /// @param account The claimant (msg.sender of `claim`).
    /// @param amount USDC base units transferred.
    event Claimed(address indexed account, uint256 amount);

    // ------------------------------------------------------------------
    // Errors (the module's SealingClosed, AlreadySealed, RevealNotOpen, RevealClosed, BadDuration,
    // BadCiphertextLength and BadCommitment are inherited from Sealed)
    // ------------------------------------------------------------------

    /// @notice The caller is not a member (propose, vote).
    error NotMember();
    /// @notice The proposal target is the zero address, this DAO, or the USDC token: none of them can ever claim a
    ///         payout or vote, so a passed proposal to them would lock funds or inflate the quorum forever.
    error BadTarget();
    /// @notice A TransferUSDC proposal with amount 0.
    error BadAmount();
    /// @notice `description` is longer than MAX_DESCRIPTION_LENGTH bytes.
    error DescriptionTooLong();
    /// @notice `descriptionURI` is longer than MAX_DESCRIPTION_URI_LENGTH bytes.
    error DescriptionURITooLong();
    /// @notice `revealBatch` arrays differ in length.
    error LengthMismatch();
    /// @notice `revealBatch` got more than MAX_BATCH items.
    error TooManyItems();
    /// @notice finalize: the reveal window is not over (or the proposal does not exist). execute: not finalized.
    error NotReady();
    /// @notice `finalize` was already called for this proposal.
    error AlreadyFinalized();
    /// @notice `execute` on a finalized proposal that did not pass.
    error NotPassed();
    /// @notice `execute` on a proposal that was already executed.
    error AlreadyExecuted();
    /// @notice `execute` after roundTime(revealEndRound) + EXECUTION_GRACE.
    error Expired();
    /// @notice The free treasury (balance - totalClaimable) cannot cover the TransferUSDC amount.
    error InsufficientTreasury();
    /// @notice SetMember would not change anything (add an existing member, remove a non-member).
    error NoOp();
    /// @notice SetMember would remove the last member, after which nobody could ever propose again.
    error LastMember();
    /// @notice `claim` with a zero claimable balance.
    error NothingToClaim();
    /// @notice The token's `transfer` returned false or malformed data. A token revert (for example the USDC
    ///         blocklist) is bubbled unchanged instead.
    error TransferFailed();
    /// @notice `status` of an id that was never created.
    error UnknownProposal();
    /// @notice Reentrant call into `revealBatch`, `execute` or `claim`.
    error Reentrancy();
    /// @notice Constructor: the USDC address is zero.
    error BadUSDC();
    /// @notice Constructor: quorumBps is 0 or above 10_000.
    error BadQuorum();
    /// @notice Constructor: the initial member list is empty.
    error NoMembers();
    /// @notice Constructor: an initial member is the zero address.
    error BadMember();
    /// @notice Constructor: an initial member appears twice.
    error DuplicateMember();

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    /// @notice Deploys an immutable DAO. Emits `MemberSet(member, true)` per initial member.
    /// @param usdc_ USDC ERC-20 (on Arc: 0x3600000000000000000000000000000000000000).
    /// @param initialMembers Non-empty list of distinct, non-zero member addresses.
    /// @param quorumBps_ Quorum in basis points of the member count, in (0, 10_000] (5000 = half the members).
    /// @param revealBounty_ USDC base units paid per revealed vote to the `revealBatch` caller (10_000 = 0.01 USDC).
    constructor(address usdc_, address[] memory initialMembers, uint16 quorumBps_, uint256 revealBounty_) {
        if (usdc_ == address(0)) revert BadUSDC();
        if (quorumBps_ == 0 || quorumBps_ > BPS) revert BadQuorum();
        uint256 length = initialMembers.length;
        if (length == 0) revert NoMembers();

        uint32 count;
        for (uint256 i; i < length; ++i) {
            address member = initialMembers[i];
            if (member == address(0)) revert BadMember();
            if (isMember[member]) revert DuplicateMember();
            isMember[member] = true;
            ++count;
            emit MemberSet(member, true);
        }
        memberCount = count;

        usdc = IERC20(usdc_);
        quorumBps = quorumBps_;
        revealBounty = revealBounty_;
    }

    // ------------------------------------------------------------------
    // Proposals and votes
    // ------------------------------------------------------------------

    /// @notice Creates a proposal and opens its sealing phase (members only).
    /// @dev Checks in order: NotMember, BadTarget (target is zero, this DAO or the USDC token, both kinds), BadAmount
    ///      (TransferUSDC with amount 0), DescriptionTooLong, DescriptionURITooLong, BadDuration (votingSeconds
    ///      outside [MIN_VOTING, MAX_VOTING]). Whether a SetMember change is a no-op, or removes the last member, is
    ///      checked at execute, because membership may change in between.
    ///      memberSnapshot = memberCount now; it is only the quorum denominator.
    /// @param kind TransferUSDC or SetMember.
    /// @param target Payout recipient or member account; never zero, this DAO or the USDC token.
    /// @param amount TransferUSDC: USDC base units, > 0. Ignored (stored as given) for SetMember.
    /// @param flag SetMember: true adds, false removes. Ignored (stored as given) for TransferUSDC.
    /// @param description At most MAX_DESCRIPTION_LENGTH bytes.
    /// @param descriptionURI Pointer to a longer text, at most MAX_DESCRIPTION_URI_LENGTH bytes.
    /// @param votingSeconds Length of the sealing phase, in [MIN_VOTING, MAX_VOTING].
    /// @return id The new proposal id (proposalCount after the call).
    function propose(
        ActionKind kind,
        address target,
        uint256 amount,
        bool flag,
        string calldata description,
        string calldata descriptionURI,
        uint32 votingSeconds
    ) external returns (uint256 id) {
        if (!isMember[msg.sender]) revert NotMember();
        if (target == address(0) || target == address(this) || target == address(usdc)) revert BadTarget();
        if (kind == ActionKind.TransferUSDC && amount == 0) revert BadAmount();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        if (bytes(descriptionURI).length > MAX_DESCRIPTION_URI_LENGTH) revert DescriptionURITooLong();

        id = ++proposalCount;
        uint64 closeRound = _openGroup(id, votingSeconds);

        Proposal storage p = _proposals[id];
        p.proposer = msg.sender;
        p.kind = kind;
        p.target = target;
        p.amount = amount;
        p.flag = flag;
        p.description = description;
        p.descriptionURI = descriptionURI;
        p.closeRound = closeRound;
        p.revealEndRound = _groups[id].revealEndRound;
        p.memberSnapshot = memberCount;

        _emitProposalCreated(id, p, description, descriptionURI);
    }

    /// @notice Seals the caller's vote on proposal `id` (members only, once, while sealing is open).
    /// @dev Checks in order: NotMember, then the module's SealingClosed (also for an unknown id), AlreadySealed,
    ///      BadCommitment and BadCiphertextLength ([359, 1024] bytes). The ciphertext is never parsed onchain: a
    ///      malformed one simply fails to decrypt and the vote stays unrevealed (it still counts toward quorum).
    ///      Emits the module's `Sealed(id, msg.sender, commitment, ciphertext)`.
    /// @param id The proposal.
    /// @param commitment hashVote(id, msg.sender, choice, salt) with a 32-byte CSPRNG salt.
    /// @param ciphertext Raw tlock ciphertext of abi.encode(uint8 choice, bytes32 salt) to the proposal's closeRound.
    function vote(uint256 id, bytes32 commitment, bytes calldata ciphertext) external {
        if (!isMember[msg.sender]) revert NotMember();
        _seal(id, msg.sender, commitment, ciphertext);
        ++_proposals[id].sealedCount;
    }

    /// @notice Reveals up to MAX_BATCH sealed votes of proposal `id` (anyone, inside the reveal window).
    /// @dev Checks in order: Reentrancy, LengthMismatch, TooManyItems, then the module's RevealNotOpen (also for an
    ///      unknown id) or RevealClosed. Per item: if hashVote(id, voter, choice, salt) does not equal the voter's live
    ///      commitment (wrong choice or salt, a voter who never sealed, one already revealed, or a duplicate in this
    ///      batch) the item is skipped with `RevealSkipped` and the call goes on. Otherwise the commitment is
    ///      consumed (`Revealed`), the tally is updated and `VoteRevealed` is emitted.
    ///      A choice above 2 in calldata makes ABI decoding revert the whole call; such a choice could never match
    ///      a valid commitment anyway, and the SDK never builds one.
    ///      Bounty (D6): if at least one vote was revealed, revealBounty > 0 and the proposal met quorum (sealedCount,
    ///      final once sealing closed, against memberSnapshot, as in `finalize`), the caller is credited
    ///      revealed * revealBounty (`BountyCredited`) when balance - totalClaimable covers it, else `BountySkipped`
    ///      and the reveals still count. Below quorum the proposal cannot pass, so its reveals change no outcome and
    ///      pay nothing (no bounty event): otherwise one member could farm the bounty with throwaway proposals. The
    ///      comparison is overflow-free, so no bounty setting can block reveals. The reentrancy lock keeps a token
    ///      callback from inside `claim` from crediting a bounty against USDC that is about to leave.
    /// @param id The proposal.
    /// @param voters Voter of each item.
    /// @param choices Decrypted choice of each item.
    /// @param salts Decrypted salt of each item.
    /// @return revealed Number of items that were valid and counted.
    function revealBatch(uint256 id, address[] calldata voters, Choice[] calldata choices, bytes32[] calldata salts)
        external
        nonReentrant
        returns (uint32 revealed)
    {
        uint256 length = voters.length;
        if (choices.length != length || salts.length != length) revert LengthMismatch();
        if (length > MAX_BATCH) revert TooManyItems();
        _requireRevealOpen(id);

        uint32[3] memory tally; // revealed votes per Choice
        for (uint256 i; i < length; ++i) {
            Choice choice = choices[i];
            if (_revealOne(id, voters[i], choice, salts[i])) ++tally[uint8(choice)];
        }

        uint32 abstainVotes = tally[uint8(Choice.Abstain)];
        uint32 forVotes = tally[uint8(Choice.For)];
        uint32 againstVotes = tally[uint8(Choice.Against)];
        revealed = abstainVotes + forVotes + againstVotes;
        if (revealed == 0) return 0;

        Proposal storage p = _proposals[id];
        p.revealedCount += revealed;
        if (forVotes != 0) p.forCount += forVotes;
        if (againstVotes != 0) p.againstCount += againstVotes;
        if (abstainVotes != 0) p.abstainCount += abstainVotes;

        if (_quorumMet(p.sealedCount, p.memberSnapshot)) _creditBounty(id, revealed);
    }

    /// @notice Closes the tally of proposal `id` (anyone, from roundTime(revealEndRound) on, once).
    /// @dev passed = sealedCount * 10_000 >= memberSnapshot * quorumBps && forCount > againstCount (D4).
    ///      Unrevealed votes count toward quorum and nothing else; ties fail. Reverts AlreadyFinalized on a second
    ///      call and NotReady before the reveal window ends or for an unknown id.
    /// @param id The proposal.
    function finalize(uint256 id) external {
        Proposal storage p = _proposals[id];
        if (p.finalized) revert AlreadyFinalized();
        uint64 revealEndRound = p.revealEndRound;
        if (revealEndRound == 0 || block.timestamp < roundTime(revealEndRound)) revert NotReady();

        uint32 sealedCount = p.sealedCount;
        uint32 forCount = p.forCount;
        uint32 againstCount = p.againstCount;
        bool passed = _quorumMet(sealedCount, p.memberSnapshot) && forCount > againstCount;
        p.finalized = true;
        p.passed = passed;

        emit Finalized(id, passed, forCount, againstCount, p.abstainCount, sealedCount, p.revealedCount);
    }

    /// @notice Executes passed proposal `id` (anyone, once, until roundTime(revealEndRound) + EXECUTION_GRACE).
    /// @dev Checks in order: NotReady (not finalized), NotPassed, AlreadyExecuted, Expired. TransferUSDC credits
    ///      `amount` to claimable[target] and totalClaimable (InsufficientTreasury if balance - totalClaimable is
    ///      short); nothing is transferred, so a blocklisted target cannot block execution. SetMember sets
    ///      isMember[target] = flag and updates memberCount (NoOp if nothing changes, LastMember if it would remove
    ///      the only member) and emits `MemberSet`.
    /// @param id The proposal.
    function execute(uint256 id) external nonReentrant {
        Proposal storage p = _proposals[id];
        if (!p.finalized) revert NotReady();
        if (!p.passed) revert NotPassed();
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp > roundTime(p.revealEndRound) + EXECUTION_GRACE) revert Expired();
        p.executed = true;

        address target = p.target;
        if (p.kind == ActionKind.TransferUSDC) {
            uint256 amount = p.amount;
            if (_available() < amount) revert InsufficientTreasury();
            claimable[target] += amount;
            totalClaimable += amount;
        } else {
            bool flag = p.flag;
            if (isMember[target] == flag) revert NoOp();
            if (!flag && memberCount == 1) revert LastMember();
            isMember[target] = flag;
            if (flag) ++memberCount;
            else --memberCount;
            emit MemberSet(target, flag);
        }
        emit Executed(id);
    }

    /// @notice Transfers the caller's whole claimable USDC balance to the caller (pull payment, D13).
    /// @dev Checks-effects-interactions plus a reentrancy lock. If the token reverts (for example the caller is on
    ///      the USDC blocklist) the revert is bubbled and the balance stays claimable; a `false` or malformed return
    ///      reverts TransferFailed.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        _transferOut(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Derived state of proposal `id`.
    /// @dev Precedence: Executed, then Expired (finalized, passed, after roundTime(revealEndRound) +
    ///      EXECUTION_GRACE), then Passed / Failed (finalized), then Ready (from roundTime(revealEndRound) on), then
    ///      Revealing (from roundTime(closeRound) on), else Voting. Reverts UnknownProposal for an id never created.
    /// @param id The proposal.
    /// @return The current status.
    function status(uint256 id) external view returns (Status) {
        Proposal storage p = _proposals[id];
        uint64 closeRound = p.closeRound;
        if (closeRound == 0) revert UnknownProposal();
        if (p.executed) return Status.Executed;
        uint256 revealEnd = roundTime(p.revealEndRound);
        if (p.finalized) {
            if (!p.passed) return Status.Failed;
            return block.timestamp > revealEnd + EXECUTION_GRACE ? Status.Expired : Status.Passed;
        }
        if (block.timestamp >= revealEnd) return Status.Ready;
        if (block.timestamp >= roundTime(closeRound)) return Status.Revealing;
        return Status.Voting;
    }

    /// @notice Proposal `id` with its tally. An unknown id returns an all-zero struct (closeRound == 0).
    /// @param id The proposal.
    /// @return The stored proposal.
    function proposal(uint256 id) external view returns (Proposal memory) {
        return _proposals[id];
    }

    /// @notice The live commitment of `voter` on proposal `id`: 0 if none, REVEALED (bytes32(uint256(1))) once
    ///         revealed.
    /// @param id The proposal.
    /// @param voter The voter.
    /// @return The stored commitment.
    function commitmentOf(uint256 id, address voter) external view returns (bytes32) {
        return _commitments[id][voter];
    }

    /// @notice The vote commitment: keccak256(abi.encode(id, voter, choice, salt)) (D11).
    /// @dev Binding the proposal id and the voter prevents replay across proposals and voters. `choice` is
    ///      ABI-encoded as uint8 in a 32-byte word, exactly like the SDK's hashVote.
    /// @param id The proposal.
    /// @param voter The voter.
    /// @param c The choice.
    /// @param salt 32 random bytes chosen by the voter.
    /// @return The commitment.
    function hashVote(uint256 id, address voter, Choice c, bytes32 salt) external pure returns (bytes32) {
        return _hashVote(id, voter, c, salt);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// @dev Reverts Reentrancy on a nested call into any function that carries it.
    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @dev D4 quorum, shared by `finalize` and the `revealBatch` bounty: sealed votes against the member count at
    ///      proposal time, in uint256 (no overflow).
    function _quorumMet(uint32 sealedCount, uint32 memberSnapshot) private view returns (bool) {
        return uint256(sealedCount) * BPS >= uint256(memberSnapshot) * quorumBps;
    }

    /// @dev See `hashVote`.
    function _hashVote(uint256 id, address voter, Choice c, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(id, voter, c, salt));
    }

    /// @dev One `revealBatch` item: consumes the voter's commitment and emits `VoteRevealed` if it matches, else
    ///      emits `RevealSkipped`. Never reverts on a mismatch (the window was checked by the caller and is checked
    ///      again by `_consumeReveal`).
    /// @return True iff the vote was revealed and must be counted.
    function _revealOne(uint256 id, address voter, Choice choice, bytes32 salt) private returns (bool) {
        if (!_verifyReveal(id, voter, _hashVote(id, voter, choice, salt))) {
            emit RevealSkipped(id, voter);
            return false;
        }
        _consumeReveal(id, voter);
        emit VoteRevealed(id, voter, choice);
        return true;
    }

    /// @dev Emits ProposalCreated from the fields `propose` just stored (a separate frame keeps the 11 event
    ///      arguments within the stack limit).
    function _emitProposalCreated(
        uint256 id,
        Proposal storage p,
        string calldata description,
        string calldata descriptionURI
    ) private {
        emit ProposalCreated(
            id,
            p.proposer,
            p.kind,
            p.target,
            p.amount,
            p.flag,
            p.closeRound,
            p.revealEndRound,
            p.memberSnapshot,
            description,
            descriptionURI
        );
    }

    /// @dev Credits revealBounty * revealed to msg.sender if the free treasury covers it, else emits BountySkipped.
    ///      Called only for a proposal that met quorum. `perVote <= available / revealed` is
    ///      `perVote * revealed <= available` without the multiplication.
    function _creditBounty(uint256 id, uint32 revealed) private {
        uint256 perVote = revealBounty;
        if (perVote == 0) return;
        if (perVote <= _available() / revealed) {
            uint256 bounty = perVote * revealed;
            claimable[msg.sender] += bounty;
            totalClaimable += bounty;
            emit BountyCredited(id, msg.sender, bounty);
        } else {
            emit BountySkipped(id);
        }
    }

    /// @dev Free treasury: USDC held minus USDC owed to claimants (0 rather than an underflow panic).
    function _available() private view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 reserved = totalClaimable;
        return balance > reserved ? balance - reserved : 0;
    }

    /// @dev usdc.transfer(to, amount) with return check: bubbles a token revert (for example "Blacklistable: account
    ///      is blacklisted"), reverts TransferFailed on an empty revert, a false return or a short return.
    function _transferOut(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok) {
            if (ret.length == 0) revert TransferFailed();
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        if (ret.length < 32 || abi.decode(ret, (uint256)) != 1) revert TransferFailed();
    }
}
