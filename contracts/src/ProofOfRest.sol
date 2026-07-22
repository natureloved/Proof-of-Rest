// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRestBadge} from "./interfaces/IRestBadge.sol";

/// @title Proof of Rest
/// @notice An onchain commitment device for solo builders who overwork.
///         Lock a MON stake, end the session within the limit to reclaim it
///         (plus a slice of the community reward pool). Overrun and a percentage
///         is forfeited into the pool; a cooldown enforces a real break.
contract ProofOfRest is ReentrancyGuard, Ownable {
    struct Session {
        uint256 stakeAmount;
        uint64 startTime;
        bool active;
    }

    mapping(address => Session) public sessions;
    mapping(address => uint64) public lastEndTime; // for cooldown check
    mapping(address => uint32) public streak; // consecutive respected sessions
    mapping(address => uint32) public sessionsCompleted;
    mapping(address => uint32) public sessionsForfeited;

    // Sponsor-a-session. Tracked per (beneficiary, sponsor) so a sponsor can
    // always reclaim their own unused funds — pooling only the aggregate for
    // display would let one sponsor reclaim another's money.
    mapping(address => uint256) public sponsoredStake; // beneficiary => total available (aggregate)
    mapping(address => mapping(address => uint256)) public sponsorContribution; // beneficiary => sponsor => amount
    mapping(address => mapping(address => uint64)) public sponsorSince; // beneficiary => sponsor => last top-up time
    mapping(address => mapping(address => uint64)) public sponsorEpoch; // beneficiary => sponsor => epoch of contribution
    mapping(address => uint64) public beneficiaryEpoch; // beneficiary => current epoch (bumped on consumption)

    uint64 public maxSessionDuration = 4 hours; // owner-adjustable default
    uint64 public cooldownPeriod = 30 minutes; // owner-adjustable default
    uint64 public sponsorshipReclaimDelay = 7 days; // sponsor can reclaim unused funds after this
    uint16 public penaltyBps = 5000; // 50.00%, basis points out of 10000
    uint16 public watchdogBps = 500; // 5.00% of the penalty, paid to the closer
    uint16 public successBonusBps = 200; // 2.00% of the current rewardPool, paid on success
    uint256 public minStake = 0.001 ether; // floor so the watchdog reward reliably beats gas
    uint256 public rewardPool; // community pot — funded by 95% of every penalty
    uint256 public lockedFunds; // user-owned obligations: active stakes + sponsored balances

    IRestBadge public restBadge;

    error SessionAlreadyActive();
    error CooldownActive(uint64 secondsRemaining);
    error ZeroStake();
    error MinStakeNotMet(uint256 required);
    error SessionNotActive();
    error SessionStillWithinLimit();
    error NoSponsoredStake();
    error ZeroSponsorAmount();
    error SponsorshipLocked(uint64 secondsRemaining);
    error PenaltyTooHigh();
    error WatchdogTooHigh();
    error SuccessBonusTooHigh();

    event SessionStarted(address indexed user, uint256 stake, uint64 startTime);
    event SessionEnded(address indexed user, uint256 refunded, uint256 poolBonus, uint64 duration);
    event SessionForfeited(
        address indexed user,
        address indexed closedBy,
        uint256 refunded,
        uint256 watchdogReward,
        uint256 poolContribution,
        uint64 duration
    );
    event StreakUpdated(address indexed user, uint32 newStreak);
    event RewardPoolFunded(uint256 amount, uint256 newPoolBalance);
    event SessionSponsored(address indexed sponsor, address indexed beneficiary, uint256 amount);
    event SponsorshipReclaimed(address indexed sponsor, address indexed beneficiary, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // ---------------------------------------------------------------------
    // Session lifecycle
    // ---------------------------------------------------------------------

    /// @notice Stake your own MON to begin a rest session.
    function startSession() external payable {
        if (sessions[msg.sender].active) revert SessionAlreadyActive();
        uint64 cooldownEnd = lastEndTime[msg.sender] + cooldownPeriod;
        if (block.timestamp < cooldownEnd) {
            revert CooldownActive(uint64(cooldownEnd - block.timestamp));
        }
        if (msg.value == 0) revert ZeroStake();
        if (msg.value < minStake) revert MinStakeNotMet(minStake);

        lockedFunds += msg.value;
        sessions[msg.sender] = Session(msg.value, uint64(block.timestamp), true);
        emit SessionStarted(msg.sender, msg.value, uint64(block.timestamp));
    }

    /// @notice Start a session funded by a sponsor's stake instead of your own MON.
    function startSessionWithSponsorship() external {
        if (sessions[msg.sender].active) revert SessionAlreadyActive();
        uint64 cooldownEnd = lastEndTime[msg.sender] + cooldownPeriod;
        if (block.timestamp < cooldownEnd) {
            revert CooldownActive(uint64(cooldownEnd - block.timestamp));
        }
        uint256 avail = sponsoredStake[msg.sender];
        if (avail == 0) revert NoSponsoredStake();

        // Consume the whole sponsored balance. Bumping the beneficiary epoch
        // invalidates every prior per-sponsor contribution in O(1), so a sponsor
        // can no longer reclaim funds that have now been spent.
        sponsoredStake[msg.sender] = 0;
        beneficiaryEpoch[msg.sender] += 1;
        sessions[msg.sender] = Session(avail, uint64(block.timestamp), true);
        emit SessionStarted(msg.sender, avail, uint64(block.timestamp));
    }

    /// @notice End your own session. If you respected the limit you reclaim your
    ///         stake plus a slice of the reward pool; if you overran, the penalty
    ///         path runs through `_forceClose` and your streak resets.
    function endSession() external nonReentrant {
        Session storage s = sessions[msg.sender];
        if (!s.active) revert SessionNotActive();

        uint64 duration = uint64(block.timestamp) - s.startTime;

        if (duration <= maxSessionDuration) {
            uint256 stake = s.stakeAmount;
            uint256 poolBonus = (rewardPool * successBonusBps) / 10000;

            // checks-effects-interactions: mutate pool + session before any call
            rewardPool -= poolBonus;
            lockedFunds -= stake;
            s.active = false;
            lastEndTime[msg.sender] = uint64(block.timestamp);

            sessionsCompleted[msg.sender] += 1;
            streak[msg.sender] += 1;
            emit StreakUpdated(msg.sender, streak[msg.sender]);
            emit SessionEnded(msg.sender, stake, poolBonus, duration);

            _maybeAwardBadge(msg.sender);

            (bool ok,) = msg.sender.call{value: stake + poolBonus}("");
            require(ok, "RefundFailed");
        } else {
            _forceClose(msg.sender, msg.sender);
        }
    }

    /// @notice Permissionless watchdog: anyone may close a session that has run
    ///         past the limit. The caller earns the watchdog reward.
    function forceEndOverrunSession(address user) external nonReentrant {
        Session storage s = sessions[user];
        if (!s.active) revert SessionNotActive();
        if (block.timestamp - s.startTime <= maxSessionDuration) {
            revert SessionStillWithinLimit();
        }
        _forceClose(user, msg.sender);
    }

    /// @dev Shared penalty accounting used by both the late self-close and the
    ///      third-party watchdog paths. `closer` receives the watchdog reward.
    function _forceClose(address user, address closer) internal {
        Session storage s = sessions[user];
        uint256 stake = s.stakeAmount;
        uint64 duration = uint64(block.timestamp) - s.startTime;

        uint256 penalty = (stake * penaltyBps) / 10000;
        uint256 refund = stake - penalty;
        uint256 watchdogReward = (penalty * watchdogBps) / 10000;
        uint256 poolContribution = penalty - watchdogReward;

        // mutate all state first (checks-effects-interactions)
        s.active = false;
        s.stakeAmount = 0;
        lastEndTime[user] = uint64(block.timestamp);
        streak[user] = 0;
        sessionsForfeited[user] += 1;
        lockedFunds -= stake;
        rewardPool += poolContribution;

        emit StreakUpdated(user, 0);
        emit SessionForfeited(user, closer, refund, watchdogReward, poolContribution, duration);
        emit RewardPoolFunded(poolContribution, rewardPool);

        if (refund > 0) {
            (bool ok,) = user.call{value: refund}("");
            require(ok, "RefundFailed");
        }
        if (watchdogReward > 0) {
            (bool ok,) = closer.call{value: watchdogReward}("");
            require(ok, "WatchdogRewardFailed");
        }
    }

    /// @dev Nudges the badge contract if one is wired up. No-op otherwise so
    ///      Tier 1 works standalone.
    function _maybeAwardBadge(address user) internal {
        if (address(restBadge) != address(0)) {
            restBadge.mintIfEligible(user, streak[user]);
        }
    }

    // ---------------------------------------------------------------------
    // Sponsor-a-session (Tier 1 committed, surfaced in Tier 3)
    // ---------------------------------------------------------------------

    function sponsorSession(address beneficiary) external payable {
        if (msg.value == 0) revert ZeroSponsorAmount();

        uint64 epoch = beneficiaryEpoch[beneficiary];
        // If a previous contribution from this sponsor belonged to an older
        // (already-consumed) epoch, its bookkeeping is stale — start fresh.
        if (sponsorEpoch[beneficiary][msg.sender] != epoch) {
            sponsorContribution[beneficiary][msg.sender] = 0;
            sponsorEpoch[beneficiary][msg.sender] = epoch;
        }

        lockedFunds += msg.value;
        sponsoredStake[beneficiary] += msg.value;
        sponsorContribution[beneficiary][msg.sender] += msg.value;
        sponsorSince[beneficiary][msg.sender] = uint64(block.timestamp);
        emit SessionSponsored(msg.sender, beneficiary, msg.value);
    }

    /// @notice Reclaim MON you sponsored for a beneficiary who never used it.
    ///         Available once `sponsorshipReclaimDelay` has passed since your
    ///         last top-up, and only while the funds are still unspent (the
    ///         beneficiary hasn't started a sponsored session since). This closes
    ///         the fund-lock where an unused sponsorship would otherwise be stuck
    ///         forever.
    function reclaimSponsorship(address beneficiary) external nonReentrant {
        // Contribution is only valid if it belongs to the current (unspent) epoch.
        if (sponsorEpoch[beneficiary][msg.sender] != beneficiaryEpoch[beneficiary]) {
            revert NoSponsoredStake();
        }
        uint256 amount = sponsorContribution[beneficiary][msg.sender];
        if (amount == 0) revert NoSponsoredStake();

        uint64 unlockAt = sponsorSince[beneficiary][msg.sender] + sponsorshipReclaimDelay;
        if (block.timestamp < unlockAt) {
            revert SponsorshipLocked(uint64(unlockAt - block.timestamp));
        }

        // checks-effects-interactions
        sponsorContribution[beneficiary][msg.sender] = 0;
        sponsoredStake[beneficiary] -= amount;
        lockedFunds -= amount;
        emit SponsorshipReclaimed(msg.sender, beneficiary, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "ReclaimFailed");
    }

    // ---------------------------------------------------------------------
    // Owner configuration
    // ---------------------------------------------------------------------

    function setMaxSessionDuration(uint64 _v) external onlyOwner {
        maxSessionDuration = _v;
    }

    function setCooldownPeriod(uint64 _v) external onlyOwner {
        cooldownPeriod = _v;
    }

    function setMinStake(uint256 _v) external onlyOwner {
        minStake = _v;
    }

    function setSponsorshipReclaimDelay(uint64 _v) external onlyOwner {
        sponsorshipReclaimDelay = _v;
    }

    function setPenaltyBps(uint16 _v) external onlyOwner {
        if (_v > 8000) revert PenaltyTooHigh(); // cap 80%
        penaltyBps = _v;
    }

    function setWatchdogBps(uint16 _v) external onlyOwner {
        if (_v >= 10000) revert WatchdogTooHigh();
        watchdogBps = _v;
    }

    function setSuccessBonusBps(uint16 _v) external onlyOwner {
        if (_v > 1000) revert SuccessBonusTooHigh(); // cap 10%
        successBonusBps = _v;
    }

    function setRestBadgeContract(address _badge) external onlyOwner {
        restBadge = IRestBadge(_badge);
    }

    /// @notice Owner may sweep only MON sent to the contract directly (dust).
    ///         Everything the protocol actually owes — the reward pool plus every
    ///         active stake and sponsored balance (tracked in `lockedFunds`) — is
    ///         off limits, so this can never touch user funds.
    function rescueDust() external onlyOwner nonReentrant {
        uint256 reserved = rewardPool + lockedFunds;
        uint256 bal = address(this).balance;
        if (bal > reserved) {
            (bool ok,) = msg.sender.call{value: bal - reserved}("");
            require(ok, "RescueFailed");
        }
    }
}
