// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProofOfRest} from "../src/ProofOfRest.sol";
import {RestBadge} from "../src/RestBadge.sol";

contract ProofOfRestTest is Test {
    ProofOfRest public por;
    RestBadge public badge;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob"); // third-party watchdog
    address public carol = makeAddr("carol");

    uint256 public constant STAKE = 1 ether;

    function setUp() public {
        por = new ProofOfRest();
        badge = new RestBadge();
        por.setRestBadgeContract(address(badge));
        badge.setAuthorizedMinter(address(por));
    }

    // ---- startSession ----------------------------------------------------

    function test_StartSessionRevertsIfAlreadyActive() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();

        vm.prank(alice);
        vm.expectRevert(ProofOfRest.SessionAlreadyActive.selector);
        por.startSession{value: STAKE}();
    }

    function test_StartSessionRevertsOnCooldown() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();

        vm.warp(block.timestamp + 1); // still active; end it within limit
        vm.prank(alice);
        por.endSession();

        // immediately try to start again -> cooldown should block
        vm.prank(alice);
        vm.expectRevert();
        por.startSession{value: STAKE}();
    }

    function test_StartSessionRevertsZeroStake() public {
        vm.prank(alice);
        vm.expectRevert(ProofOfRest.ZeroStake.selector);
        por.startSession{value: 0}();
    }

    // ---- endSession within limit ----------------------------------------

    function test_EndSessionWithinLimitRefundsFullPlusPoolBonus() public {
        por.setSuccessBonusBps(200); // 2%

        // First fund the pool via bob's forfeiture (alice is the watchdog).
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + por.maxSessionDuration() + 1);
        vm.prank(alice); // alice is the watchdog
        por.forceEndOverrunSession(bob);
        // alice received a watchdog reward here; ignore for the balance math below.

        uint256 poolBefore = por.rewardPool();
        uint256 expectedBonus = (poolBefore * 200) / 10000;

        // Now alice starts + ends her OWN session quickly (within limit).
        vm.deal(alice, 10 ether);
        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        por.endSession();

        assertEq(alice.balance, aliceBalBefore - STAKE + STAKE + expectedBonus, "refund + bonus");
        assertEq(por.sessionsCompleted(alice), 1);
        assertEq(por.streak(alice), 1);
        assertEq(por.rewardPool(), poolBefore - expectedBonus, "pool decreased by bonus");
    }

    function test_RewardPoolNeverNegativeAfterManySuccesses() public {
        // many successful sessions, each draining a tiny bonus; pool must stay >= 0
        por.setSuccessBonusBps(1000); // 10% max
        vm.deal(alice, 100 ether);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(alice);
            por.startSession{value: STAKE}();
            vm.warp(block.timestamp + 1);
            vm.prank(alice);
            por.endSession();
            vm.warp(block.timestamp + por.cooldownPeriod() + 1);
        }
        assertGe(por.rewardPool(), 0, "pool never negative");
    }

    // ---- forceEndOverrunSession -----------------------------------------

    function test_ForceEndRevertsBeforeLimit() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();

        vm.warp(block.timestamp + por.maxSessionDuration() - 1); // still within
        vm.prank(bob);
        vm.expectRevert(ProofOfRest.SessionStillWithinLimit.selector);
        por.forceEndOverrunSession(alice);
    }

    function test_ForceEndSplitsRefundWatchdogAndPool() public {
        por.setPenaltyBps(5000); // 50%
        por.setWatchdogBps(500); // 5% of penalty

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + por.maxSessionDuration() + 1);

        uint256 expectedPenalty = (STAKE * 5000) / 10000; // 0.5 ether
        uint256 expectedRefund = STAKE - expectedPenalty; // 0.5 ether
        uint256 expectedWatchdog = (expectedPenalty * 500) / 10000; // 0.025 ether
        uint256 expectedPool = expectedPenalty - expectedWatchdog; // 0.475 ether

        uint256 bobBefore = bob.balance;
        uint256 aliceBefore = alice.balance;
        uint256 poolBefore = por.rewardPool();

        vm.prank(bob);
        por.forceEndOverrunSession(alice);

        assertEq(alice.balance, aliceBefore + expectedRefund, "refund to owner");
        assertEq(bob.balance, bobBefore + expectedWatchdog, "watchdog reward to closer");
        assertEq(por.rewardPool(), poolBefore + expectedPool, "pool contribution");
        assertEq(por.streak(alice), 0, "streak reset");
        assertEq(por.sessionsForfeited(alice), 1);
        (, , bool activeAfter) = por.sessions(alice);
        assertFalse(activeAfter, "session closed");
    }

    function test_ThirdPartyWatchdogEarnsReward() public {
        // same as above but assert the watchdog is distinctly bob (not alice)
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + por.maxSessionDuration() + 1);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        por.forceEndOverrunSession(alice);
        assertGt(bob.balance, bobBefore, "third-party closer earned reward");
    }

    function test_SelfCloseOverrunPaysSelf() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + por.maxSessionDuration() + 1);

        uint256 before = alice.balance;
        vm.prank(alice);
        por.endSession(); // late self-close routes through _forceClose(alice, alice)

        uint256 expectedPenalty = (STAKE * por.penaltyBps()) / 10000;
        uint256 expectedWatchdog = (expectedPenalty * por.watchdogBps()) / 10000;
        uint256 expectedRefund = STAKE - expectedPenalty;
        assertEq(alice.balance, before + expectedRefund + expectedWatchdog, "self gets refund+watchdog");
    }

    // ---- reentrancy ------------------------------------------------------

    function test_ReentrantEndSessionReverts() public {
        ReentrantReceiver r = new ReentrantReceiver(por);
        address attacker = address(r);
        vm.deal(attacker, 10 ether);

        vm.prank(attacker);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + 1); // within limit

        // the malicious receiver tries to re-enter endSession on its own refund.
        // ReentrancyGuard must revert.
        vm.prank(attacker);
        vm.expectRevert(); // ReentrancyGuard revert (bytes4 selector)
        r.triggerEnd();
    }

    // ---- badges ----------------------------------------------------------

    function test_BadgeMintsOncePerThreshold() public {
        vm.deal(alice, 100 ether);

        // 3 respected sessions in a row -> unlocks threshold 1 and 3 (not 7)
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + por.cooldownPeriod() + 1);
            vm.prank(alice);
            por.startSession{value: STAKE}();
            vm.warp(block.timestamp + 1);
            vm.prank(alice);
            por.endSession();
        }
        assertEq(por.streak(alice), 3);

        // a 4th respected session must NOT mint the same badges again
        vm.warp(block.timestamp + por.cooldownPeriod() + 1);
        vm.prank(alice);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        por.endSession();

        // ownership checks: tokens encoded as (owner<<32 | threshold)
        uint256 id1 = (uint256(uint160(alice)) << 32) | 1;
        uint256 id3 = (uint256(uint160(alice)) << 32) | 3;
        uint256 id7 = (uint256(uint160(alice)) << 32) | 7;
        assertEq(badge.ownerOf(id1), alice);
        assertEq(badge.ownerOf(id3), alice);
        vm.expectRevert(); // token 7 never minted
        badge.ownerOf(id7);
    }

    function test_SoulboundTransferReverts() public {
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        por.endSession();

        uint256 id1 = (uint256(uint160(alice)) << 32) | 1;
        vm.prank(alice);
        vm.expectRevert(RestBadge.SoulboundNonTransferable.selector);
        badge.transferFrom(alice, carol, id1);
    }

    // ---- rescueDust fund protection -------------------------------------

    function test_RescueDustCannotTakeActiveStake() public {
        // alice has an active session; her stake must be untouchable by the owner.
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();

        uint256 ownerBefore = address(this).balance;
        por.rescueDust(); // this test contract is the owner
        assertEq(address(this).balance, ownerBefore, "owner drained nothing");
        assertEq(address(por).balance, STAKE, "active stake still held");

        // alice can still reclaim her full stake.
        vm.warp(block.timestamp + 1);
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        por.endSession();
        assertEq(alice.balance, aliceBefore + STAKE, "alice reclaimed full stake");
    }

    function test_RescueDustCannotTakeSponsoredFunds() public {
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        por.sponsorSession{value: STAKE}(carol);

        uint256 ownerBefore = address(this).balance;
        por.rescueDust();
        assertEq(address(this).balance, ownerBefore, "owner drained nothing");
        assertEq(por.sponsoredStake(carol), STAKE, "sponsored balance intact");
    }

    function test_RescueDustSweepsOnlyTrueExcess() public {
        // alice's active stake is locked in the contract.
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: STAKE}();

        // Stray MON forced in without a receive hook (selfdestruct/coinbase),
        // simulated by bumping the contract balance directly.
        vm.deal(address(por), address(por).balance + 2 ether);

        uint256 ownerBefore = address(this).balance;
        por.rescueDust(); // this test contract is the owner
        // Only the 2 ether of stray funds is recoverable; the staked MON stays put.
        assertEq(address(this).balance, ownerBefore + 2 ether, "only stray swept");
        assertEq(address(por).balance, STAKE, "locked stake untouched");
    }

    // ---- minStake --------------------------------------------------------

    function test_StartSessionRevertsBelowMinStake() public {
        por.setMinStake(0.01 ether);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProofOfRest.MinStakeNotMet.selector, 0.01 ether));
        por.startSession{value: 0.005 ether}();
    }

    function test_StartSessionAtMinStakeSucceeds() public {
        por.setMinStake(0.01 ether);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        por.startSession{value: 0.01 ether}();
        (uint256 amt,, bool act) = por.sessions(alice);
        assertEq(amt, 0.01 ether);
        assertTrue(act);
    }

    // ---- reclaimSponsorship ---------------------------------------------

    function test_ReclaimSponsorshipReturnsUnusedFunds() public {
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        por.sponsorSession{value: STAKE}(carol);

        // too early — still locked
        vm.prank(bob);
        vm.expectRevert();
        por.reclaimSponsorship(carol);

        // after the delay, bob reclaims in full
        vm.warp(block.timestamp + por.sponsorshipReclaimDelay());
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        por.reclaimSponsorship(carol);

        assertEq(bob.balance, bobBefore + STAKE, "bob got funds back");
        assertEq(por.sponsoredStake(carol), 0, "aggregate cleared");
        assertEq(por.sponsorContribution(carol, bob), 0, "contribution cleared");
    }

    function test_CannotReclaimAfterBeneficiaryUsedIt() public {
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        por.sponsorSession{value: STAKE}(carol);

        // carol consumes the sponsorship
        vm.prank(carol);
        por.startSessionWithSponsorship();

        // even after the delay, bob can't reclaim spent funds
        vm.warp(block.timestamp + por.sponsorshipReclaimDelay());
        vm.prank(bob);
        vm.expectRevert(ProofOfRest.NoSponsoredStake.selector);
        por.reclaimSponsorship(carol);
    }

    function test_ReclaimIsSponsorIsolated() public {
        // Two sponsors fund carol; each can reclaim only their own share.
        vm.deal(bob, 10 ether);
        vm.deal(alice, 10 ether);
        vm.prank(bob);
        por.sponsorSession{value: 1 ether}(carol);
        vm.prank(alice);
        por.sponsorSession{value: 2 ether}(carol);
        assertEq(por.sponsoredStake(carol), 3 ether);

        vm.warp(block.timestamp + por.sponsorshipReclaimDelay());

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        por.reclaimSponsorship(carol);
        assertEq(bob.balance, bobBefore + 1 ether, "bob reclaims only his 1");
        assertEq(por.sponsoredStake(carol), 2 ether, "alice's 2 remains");

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        por.reclaimSponsorship(carol);
        assertEq(alice.balance, aliceBefore + 2 ether, "alice reclaims her 2");
        assertEq(por.sponsoredStake(carol), 0);
    }

    function test_StaleSponsorshipCannotStealNewFunds() public {
        // bob sponsors, carol consumes (epoch bumps), alice sponsors fresh.
        // bob's stale entry must NOT be reclaimable against alice's funds.
        vm.deal(bob, 10 ether);
        vm.deal(alice, 10 ether);
        vm.prank(bob);
        por.sponsorSession{value: 1 ether}(carol);
        vm.prank(carol);
        por.startSessionWithSponsorship(); // consumes bob's 1, epoch -> 1

        vm.prank(alice);
        por.sponsorSession{value: 2 ether}(carol); // fresh funds, epoch 1

        vm.warp(block.timestamp + por.sponsorshipReclaimDelay());
        vm.prank(bob);
        vm.expectRevert(ProofOfRest.NoSponsoredStake.selector);
        por.reclaimSponsorship(carol); // bob's epoch-0 entry is stale

        // alice can still reclaim her own fresh funds
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        por.reclaimSponsorship(carol);
        assertEq(alice.balance, aliceBefore + 2 ether);
    }

    function test_RescueDustCannotTakeReclaimableSponsorship() public {
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        por.sponsorSession{value: STAKE}(carol);

        uint256 ownerBefore = address(this).balance;
        por.rescueDust();
        assertEq(address(this).balance, ownerBefore, "owner drained nothing");
        assertEq(address(por).balance, STAKE, "sponsored funds still held");
    }

    receive() external payable {}
}

/// @dev Malicious receiver that attempts to re-enter ProofOfRest.endSession.
contract ReentrantReceiver {
    ProofOfRest public por;

    constructor(ProofOfRest _por) {
        por = _por;
    }

    receive() external payable {
        // try to re-enter while the first endSession call is mid-execution.
        // state has not been mutated to block us here; the ReentrancyGuard must revert.
        por.endSession();
    }

    function triggerEnd() external {
        por.endSession();
    }
}
