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

function fmtDuration(seconds: number | bigint): string {
  // Coerce defensively: this does number arithmetic, so a bigint argument would
  // throw "Cannot mix BigInt and other types". Number() is safe on both.
  const total = Number(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Discover/load: read all needed on-chain state in a SINGLE request.
 *
 * The public testnet-rpc.monad.xyz endpoint rate-limits at 15 requests/sec
 * *across the whole page* — and the page already spends much of that budget on
 * StatsPanel / SessionCard / leaderboard polling. Firing 13 separate reads (even
 * throttled) piles onto that shared budget and trips HTTP 429. So we batch all
 * 13 calls into one Multicall3 request: 13 reads → 1 request. Multicall3 is
 * deployed at the canonical address on Monad testnet; we pass it explicitly
 * because the chain definition in contracts.ts doesn't declare it.
 *
 * We use `allowFailure: true` because `minStake()` reverts on the deployed
 * contract (the getter is in the ABI but non-functional on the deployed
 * bytecode). SessionCard already tolerates this via `?? 0n`; we mirror that
 * here — a single reverting getter must not sink the whole plan. Any per-call
 * failure other than that is defaulted to a safe zero-ish value, and only a
 * total request failure (RPC unreachable / 429) returns undefined so the agent
 * surfaces a friendly "can't reach the chain" rather than crashing mid-plan.
 */
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as `0x${string}`;

// The per-call shape viem returns under `allowFailure: true`. We type it
// ourselves because the `contracts as never` cast (needed for the untyped ABI)
// collapses viem's inferred result tuple to `never`.
type MulticallEntry =
  | { status: "success"; result: unknown; error?: undefined }
  | { status: "failure"; result?: undefined; error: Error };

async function loadState(
  publicClient: PublicClient,
  address: `0x${string}`,
  contractAddress: `0x${string}`,
  abi: unknown,
): Promise<OnChainState | undefined> {
  const base = { address: contractAddress, abi: abi as never } as const;
  const contracts = [
    { ...base, functionName: "sessions", args: [address] },
    { ...base, functionName: "lastEndTime", args: [address] },
    { ...base, functionName: "streak", args: [address] },
    { ...base, functionName: "sessionsCompleted", args: [address] },
    { ...base, functionName: "sessionsForfeited", args: [address] },
    { ...base, functionName: "maxSessionDuration" },
    { ...base, functionName: "cooldownPeriod" },
    { ...base, functionName: "penaltyBps" },
    { ...base, functionName: "watchdogBps" },
    { ...base, functionName: "successBonusBps" },
    { ...base, functionName: "minStake" },
    { ...base, functionName: "rewardPool" },
    { ...base, functionName: "sponsoredStake", args: [address] },
  ];

  try {
    const results = (await publicClient.multicall({
      contracts: contracts as never,
      multicallAddress: MULTICALL3_ADDRESS,
      allowFailure: true,
    })) as MulticallEntry[];

    // `allowFailure: true` returns { status, result } per call. Unwrap each,
    // defaulting a reverting getter to a safe zero (minStake reverts on the
    // deployed contract — see SessionCard's `?? 0n`). If EVERY call failed the
    // request itself is unhealthy (RPC down / 429), so bail to undefined.
    const anyOk = results.some((r) => r.status === "success");
    if (!anyOk) {
      console.error("[RestGuardian] loadState: every read failed", results[0]?.error);
      return undefined;
    }

    const val = <T>(i: number, fallback: T): T =>
      results[i]?.status === "success" ? (results[i].result as T) : fallback;

    // Coerce every scalar to bigint at this single boundary. viem decodes small
    // Solidity ints (<= uint48) to a JS `number` and larger ones to `bigint` — so
    // penaltyBps/watchdogBps/successBonusBps (uint16) and streak/sessionsCompleted/
    // sessionsForfeited (uint32) come back as numbers, while stakes/pool (uint256)
    // and durations (uint64) come back as bigints. Downstream math mixes them with
    // `10000n` literals, and `bigint * number` throws "Cannot mix BigInt and other
    // types". BigInt() is a no-op on a bigint and lifts a number, so forcing every
    // scalar to bigint here makes OnChainState's types honest and the math safe.
    const big = (i: number): bigint => {
      const r = results[i];
      return r?.status === "success" ? BigInt(r.result as bigint | number) : 0n;
    };

    return {
      session: val<readonly [bigint, bigint, boolean]>(0, [0n, 0n, false]),
      lastEndTime: big(1),
      streak: big(2),
      sessionsCompleted: big(3),
      sessionsForfeited: big(4),
      maxSessionDuration: big(5),
      cooldownPeriod: big(6),
      penaltyBps: big(7),
      watchdogBps: big(8),
      successBonusBps: big(9),
      minStake: big(10),
      rewardPool: big(11),
      sponsoredStake: big(12),
    };
  } catch (err) {
    console.error("[RestGuardian] loadState multicall failed:", err);
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
      consequence:
        "Couldn't read on-chain state from the Monad Testnet RPC. The public endpoint rate-limits at 15 requests/sec — if the page just loaded, wait a second and try again. Check the console for the exact error.",
      warnings: [],
      receipt: [
        "❌ Couldn't load on-chain state.",
        "The public testnet-rpc.monad.xyz caps at 15 req/sec (HTTP 429) — wait a moment and retry.",
        "If it persists: confirm your wallet is on Monad Testnet (10143).",
      ],
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
    // Race the simulation against a timeout. The public Monad RPC rate-limits
    // at 15 req/sec, and a throttled eth_call can stall — without this the UI
    // would hang on "Thinking…" indefinitely. On timeout we treat the action as
    // un-simulatable (canSign:false) rather than blocking forever.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Simulation timed out — the RPC is rate-limited (15 req/sec). Try again in a moment.")), 12000),
    );
    await Promise.race([
      publicClient.simulateContract({
        address: contractAddress,
        abi: abi as never,
        functionName: action.functionName,
        args: action.args as never,
        value: action.value,
        account,
      }),
      timeout,
    ]);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: friendlyError(msg) };
  }
}
