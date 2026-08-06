// Moss-style plan builder: discover → load → action → simulate.
//
// This is the RestGuardian agent's core — it turns a parsed intent into a
// structured AgentPlan: a human-readable receipt of what WOULD happen if the
// user signs, plus the exact calldata to execute that intent. The simulation
// step (via `publicClient.simulateContract`) checks whether the action would
// succeed or revert BEFORE any wallet sees it, which is the "safer and clearer"
// guarantee the Moss direction emphasizes.
//
// Never signs or sends. The plan is purely informational; signing happens only
// when the user clicks "Review & Sign" in the UI, which wires to `useWriteContract`.

import type { PublicClient } from "viem";
import { parseEther, formatEther } from "viem";
import type { ParsedIntent } from "./intents";
import { friendlyError } from "./errors";

export interface AgentPlan {
  intent: ParsedIntent;
  summary: string;
  consequence: string;
  warnings: string[];
  /** The contract write to execute, if any. Absent for read-only intents. */
  action?: {
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  };
  receipt: string[];
  canSign: boolean;
  simulation: "ok" | "will_revert" | "read_only" | "skipped";
  revertReason?: string;
}

interface OnChainState {
  session: readonly [bigint, bigint, boolean];
  lastEndTime: bigint;
  streak: bigint;
  sessionsCompleted: bigint;
  sessionsForfeited: bigint;
  maxSessionDuration: bigint;
  cooldownPeriod: bigint;
  penaltyBps: bigint;
  watchdogBps: bigint;
  successBonusBps: bigint;
  minStake: bigint;
  rewardPool: bigint;
  sponsoredStake: bigint;
}

const PROOF_OF_REST_ADDRESS_PLACEHOLDER = "0x01BEB2CB254A09f698E1E0Cbd8624B7d4f67586A" as `0x${string}`;

function fmtMon(wei: bigint): string {
  return parseFloat(formatEther(wei)).toFixed(4);
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Discover/load: read current on-chain state for the connected user. Returns
 * undefined on RPC failure so the agent can surface a friendly "can't reach
 * the chain" rather than crashing mid-plan.
 */
async function loadState(
  publicClient: PublicClient,
  address: `0x${string}`,
  contractAddress: `0x${string}`,
  abi: unknown,
): Promise<OnChainState | undefined> {
  try {
    const [
      session,
      lastEndTime,
      streak,
      sessionsCompleted,
      sessionsForfeited,
      maxSessionDuration,
      cooldownPeriod,
      penaltyBps,
      watchdogBps,
      successBonusBps,
      minStake,
      rewardPool,
      sponsoredStake,
    ] = await Promise.all([
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "sessions",
        args: [address],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "lastEndTime",
        args: [address],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "streak",
        args: [address],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "sessionsCompleted",
        args: [address],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "sessionsForfeited",
        args: [address],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "maxSessionDuration",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "cooldownPeriod",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "penaltyBps",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "watchdogBps",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "successBonusBps",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "minStake",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "rewardPool",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: abi as never,
        functionName: "sponsoredStake",
        args: [address],
      }),
    ]);

    return {
      session: session as readonly [bigint, bigint, boolean],
      lastEndTime: lastEndTime as bigint,
      streak: streak as bigint,
      sessionsCompleted: sessionsCompleted as bigint,
      sessionsForfeited: sessionsForfeited as bigint,
      maxSessionDuration: maxSessionDuration as bigint,
      cooldownPeriod: cooldownPeriod as bigint,
      penaltyBps: penaltyBps as bigint,
      watchdogBps: watchdogBps as bigint,
      successBonusBps: successBonusBps as bigint,
      minStake: minStake as bigint,
      rewardPool: rewardPool as bigint,
      sponsoredStake: sponsoredStake as bigint,
    };
  } catch {
    return undefined;
  }
}

/**
 * Build an AgentPlan from a parsed intent. This is the public entry point —
 * call it with a `ParsedIntent` (from either the deterministic or LLM path)
 * and you get back a complete plan with simulation result.
 */
export async function buildPlan(
  intent: ParsedIntent,
  publicClient: PublicClient,
  address: `0x${string}`,
  contractAddress: `0x${string}`,
  abi: unknown,
): Promise<AgentPlan> {
  const state = await loadState(publicClient, address, contractAddress, abi);
  if (!state) {
    return {
      intent,
      summary: "Can't reach the chain",
      consequence: "RPC unreachable — check your network and try again.",
      warnings: [],
      receipt: ["❌ RPC error — unable to load on-chain state."],
      canSign: false,
      simulation: "skipped",
    };
  }

  const [stakeAmount, startTime, active] = state.session;
  const now = Math.floor(Date.now() / 1000);
  const elapsed = active ? now - Number(startTime) : 0;
  const limit = Number(state.maxSessionDuration);
  const overrun = active && elapsed > limit;

  switch (intent.kind) {
    case "end_session":
    case "claim_reward": {
      // Both map to `endSession()` — "claim reward" is just user-friendly
      // phrasing for the same action (the success bonus is paid on end).
      if (!active) {
        return {
          intent,
          summary: "End your session",
          consequence: "No active session to end.",
          warnings: [],
          receipt: ["❌ You don't have an active session."],
          canSign: false,
          simulation: "will_revert",
          revertReason: "No active session.",
        };
      }

      const action = { functionName: "endSession", args: [] as const };
      let receipt: string[];
      const warnings: string[] = [];

      if (overrun) {
        const penalty = (stakeAmount * state.penaltyBps) / 10000n;
        const refund = stakeAmount - penalty;
        const watchdogReward = (penalty * state.watchdogBps) / 10000n;
        const poolContrib = penalty - watchdogReward;
        receipt = [
          `⚠ Ending after the limit: you're ${fmtDuration(elapsed - limit)} overrun.`,
          `Penalty: ${(Number(state.penaltyBps) / 100).toFixed(2)}% (${fmtMon(penalty)} MON) forfeited.`,
          `You reclaim ${fmtMon(refund)} MON.`,
          `Watchdog reward (${fmtMon(watchdogReward)} MON) + pool contribution (${fmtMon(poolContrib)} MON).`,
          `Streak resets to 0.`,
        ];
        warnings.push("You've overrun the session limit — your streak will reset.");
      } else {
        const poolBonus = (state.rewardPool * state.successBonusBps) / 10000n;
        const newStreak = Number(state.streak) + 1;
        receipt = [
          `✓ Ending within the limit.`,
          `You reclaim ${fmtMon(stakeAmount)} MON + ${fmtMon(poolBonus)} MON success bonus from the pool.`,
          `Streak: ${Number(state.streak)} → ${newStreak} 🌱`,
        ];
      }

      const sim = await simulate(publicClient, contractAddress, abi, address, action);
      return {
        intent,
        summary: intent.kind === "claim_reward" ? "Claim your reward" : "End your session",
        consequence: overrun
          ? `Penalty applied: you reclaim ${fmtMon(stakeAmount - (stakeAmount * state.penaltyBps) / 10000n)} MON.`
          : `Success: you reclaim ${fmtMon(stakeAmount)} MON + pool bonus, streak +1.`,
        warnings,
        action,
        receipt,
        canSign: sim.ok,
        simulation: sim.ok ? "ok" : "will_revert",
        revertReason: sim.error,
      };
    }

    case "start_session": {
      if (active) {
        return {
          intent,
          summary: "Start a new session",
          consequence: "A session is already active.",
          warnings: [],
          receipt: ["❌ You already have an active session — end it first."],
          canSign: false,
          simulation: "will_revert",
          revertReason: "A session is already active.",
        };
      }

      const cooldownEnd = Number(state.lastEndTime) + Number(state.cooldownPeriod);
      if (now < cooldownEnd) {
        const remaining = cooldownEnd - now;
        return {
          intent,
          summary: "Start a new session",
          consequence: `Cooldown active: ${fmtDuration(remaining)} remaining.`,
          warnings: [],
          receipt: [
            `❌ Cooldown is still active.`,
            `${fmtDuration(remaining)} remaining before you can start again.`,
          ],
          canSign: false,
          simulation: "will_revert",
          revertReason: `Cooldown active: ${fmtDuration(remaining)} remaining.`,
        };
      }

      // Prefer user-requested stake, fallback to a safe default above minStake.
      let stakeWei = state.minStake > 0n ? state.minStake : parseEther("0.05");
      if (intent.amountMon) {
        try {
          stakeWei = parseEther(intent.amountMon);
        } catch {
          /* ignore parse failure, use the default */
        }
      }

      const warnings: string[] = [];
      if (intent.minutes && intent.minutes * 60 !== limit) {
        warnings.push(
          `You asked for ${intent.minutes} minutes, but the contract-wide limit is ${fmtDuration(limit)}. Your session will use the ${fmtDuration(limit)} limit.`,
        );
      }
      if (stakeWei < state.minStake) {
        warnings.push(
          `Stake ${fmtMon(stakeWei)} MON is below the minimum ${fmtMon(state.minStake)} MON — the transaction will revert.`,
        );
      }

      const action = { functionName: "startSession", args: [] as const, value: stakeWei };
      const receipt = [
        `Stake: ${fmtMon(stakeWei)} MON`,
        `Limit: ${fmtDuration(limit)} (contract-wide owner setting)`,
        `End within the limit to reclaim your stake + ${(Number(state.successBonusBps) / 100).toFixed(2)}% of the pool.`,
        `Overrun and ${(Number(state.penaltyBps) / 100).toFixed(2)}% is forfeited; cooldown enforced.`,
      ];

      const sim = await simulate(publicClient, contractAddress, abi, address, action);
      return {
        intent,
        summary: "Start a new session",
        consequence: `Lock ${fmtMon(stakeWei)} MON for a ${fmtDuration(limit)} session.`,
        warnings,
        action,
        receipt,
        canSign: sim.ok,
        simulation: sim.ok ? "ok" : "will_revert",
        revertReason: sim.error,
      };
    }

    case "watchdog_close": {
      const targetAddr = intent.address ?? PROOF_OF_REST_ADDRESS_PLACEHOLDER;
      if (!intent.address) {
        return {
          intent,
          summary: "Close an overrun session (watchdog)",
          consequence: "No address specified.",
          warnings: [],
          receipt: [
            "❌ No address provided. Type an address like 0x1234... or pick one from the discovered list.",
          ],
          canSign: false,
          simulation: "skipped",
        };
      }

      // Read the target's session to see if it's actually closable.
      let targetSession: readonly [bigint, bigint, boolean] | undefined;
      try {
        targetSession = (await publicClient.readContract({
          address: contractAddress,
          abi: abi as never,
          functionName: "sessions",
          args: [targetAddr],
        })) as readonly [bigint, bigint, boolean];
      } catch {
        return {
          intent,
          summary: "Close an overrun session (watchdog)",
          consequence: "Can't read target session.",
          warnings: [],
          receipt: [`❌ Unable to read session for ${targetAddr}.`],
          canSign: false,
          simulation: "skipped",
        };
      }

      const [targetStake, targetStart, targetActive] = targetSession;
      if (!targetActive) {
        return {
          intent,
          summary: "Close an overrun session (watchdog)",
          consequence: "That session isn't active.",
          warnings: [],
          receipt: [`❌ ${targetAddr} doesn't have an active session.`],
          canSign: false,
          simulation: "will_revert",
          revertReason: "Target session isn't active.",
        };
      }

      const targetElapsed = now - Number(targetStart);
      const targetOverrun = targetElapsed > limit;
      if (!targetOverrun) {
        const remaining = limit - targetElapsed;
        return {
          intent,
          summary: "Close an overrun session (watchdog)",
          consequence: "That session hasn't overrun yet.",
          warnings: [],
          receipt: [
            `❌ ${targetAddr.slice(0, 8)}... still has ${fmtDuration(remaining)} left.`,
            "Nothing to close — watchdog only applies to overrun sessions.",
          ],
          canSign: false,
          simulation: "will_revert",
          revertReason: "Session hasn't overrun yet.",
        };
      }

      const penalty = (targetStake * state.penaltyBps) / 10000n;
      const watchdogReward = (penalty * state.watchdogBps) / 10000n;
      const action = {
        functionName: "forceEndOverrunSession",
        args: [targetAddr] as const,
      };
      const receipt = [
        `✓ ${targetAddr.slice(0, 8)}... is ${fmtDuration(targetElapsed - limit)} overrun.`,
        `You close it and earn ${fmtMon(watchdogReward)} MON (the watchdog reward).`,
        `They reclaim ${fmtMon(targetStake - penalty)} MON; the rest tops up the pool.`,
      ];

      const sim = await simulate(publicClient, contractAddress, abi, address, action);
      return {
        intent,
        summary: "Close an overrun session (watchdog)",
        consequence: `Earn ${fmtMon(watchdogReward)} MON for closing ${targetAddr.slice(0, 8)}...`,
        warnings: [],
        action,
        receipt,
        canSign: sim.ok,
        simulation: sim.ok ? "ok" : "will_revert",
        revertReason: sim.error,
      };
    }

    case "query_state": {
      const receipt = [
        `Reward pool: ${fmtMon(state.rewardPool)} MON`,
        `Your streak: ${Number(state.streak)} ${Number(state.streak) > 0 ? "🌱" : ""}`,
        `Sessions completed: ${Number(state.sessionsCompleted)}`,
        `Sessions forfeited: ${Number(state.sessionsForfeited)}`,
        active
          ? `Active session: ${fmtMon(stakeAmount)} MON staked, ${fmtDuration(elapsed)} elapsed`
          : "No active session",
        `Sponsored stake available: ${fmtMon(state.sponsoredStake)} MON`,
      ];
      return {
        intent,
        summary: "Your current state",
        consequence: "Read-only query — no transaction needed.",
        warnings: [],
        receipt,
        canSign: false,
        simulation: "read_only",
      };
    }

    case "sponsor":
    case "reclaim":
    case "unknown":
    default: {
      return {
        intent,
        summary: "Unknown or unsupported intent",
        consequence: "The agent doesn't recognize this request yet.",
        warnings: [],
        receipt: [
          "❓ Try phrasing it differently, or use the manual UI to complete this action.",
        ],
        canSign: false,
        simulation: "skipped",
      };
    }
  }
}

interface SimResult {
  ok: boolean;
  error?: string;
}

/**
 * Simulate: call `publicClient.simulateContract` to verify the action would
 * succeed. This is the Moss "verify unsigned tx" step — it never sends anything,
 * and the returned `ok` is what the UI uses to show/hide "Review & Sign".
 */
async function simulate(
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
  abi: unknown,
  account: `0x${string}`,
  action: { functionName: string; args: readonly unknown[]; value?: bigint },
): Promise<SimResult> {
  try {
    await publicClient.simulateContract({
      address: contractAddress,
      abi: abi as never,
      functionName: action.functionName,
      args: action.args as never,
      value: action.value,
      account,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: friendlyError(msg) };
  }
}
