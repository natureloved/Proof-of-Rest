"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  PROOF_OF_REST_ADDRESS,
  PROOF_OF_REST_ABI,
} from "@/lib/contracts";
import { parseEther } from "viem";
import { useNow, fmtDuration, fmtMon } from "@/lib/format";
import { useSessionAlerts } from "@/lib/useSessionAlerts";
import { friendlyError } from "@/lib/agent/errors";
import { Vitals } from "./Vitals";

type Phase = "idle" | "active" | "cooldown";

export function SessionCard() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [stakeInput, setStakeInput] = useState("0.05");

  const { data: session } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sessions",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: lastEnd } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "lastEndTime",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: maxDur } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "maxSessionDuration",
  });
  const { data: cooldown } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "cooldownPeriod",
  });
  const { data: penalty } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "penaltyBps",
  });
  const { data: sponsored } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sponsoredStake",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: minStakeData } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "minStake",
  });

  const sponsoredStake = (sponsored as bigint) ?? 0n;
  const hasSponsored = sponsoredStake > 0n;
  const minStake = (minStakeData as bigint) ?? 0n;

  // Parse the stake input once for validation + button state.
  let stakeWei: bigint | null = null;
  try {
    stakeWei = parseEther(stakeInput.trim());
  } catch {
    stakeWei = null;
  }
  const belowMin = stakeWei !== null && minStake > 0n && stakeWei < minStake;
  const invalidStake = stakeWei === null || stakeWei <= 0n || belowMin;

  // sessions(address) returns the Session struct as a tuple: [stakeAmount, startTime, active]
  const sessionTuple = session as readonly [bigint, bigint, boolean] | undefined;
  const active = !!sessionTuple && sessionTuple[2] === true;
  const startTime = sessionTuple ? Number(sessionTuple[1]) : 0;
  const stakeAmount = sessionTuple ? sessionTuple[0] : 0n;

  const nowSec = Math.floor(Date.now() / 1000);
  const inCooldown =
    !!lastEnd &&
    !!cooldown &&
    !active &&
    nowSec < Number(lastEnd) + Number(cooldown);
  const ticking = active || inCooldown;
  useNow(ticking);

  const phase: Phase = active ? "active" : inCooldown ? "cooldown" : "idle";

  const limit = maxDur ? Number(maxDur) : 4 * 3600;
  const elapsed = active ? nowSec - startTime : 0;
  const remainingInSession = Math.max(0, limit - elapsed);
  const overrun = active && elapsed > limit;

  const cooldownTotal = cooldown ? Number(cooldown) : 0;
  const cooldownEnd = lastEnd && cooldown ? Number(lastEnd) + Number(cooldown) : 0;
  const cooldownRemaining = active ? 0 : Math.max(0, cooldownEnd - nowSec);

  // Progress toward the phase's goal, clamped to 0..1.
  const progress = active
    ? Math.min(1, limit > 0 ? elapsed / limit : 0)
    : phase === "cooldown"
      ? Math.min(1, cooldownTotal > 0 ? (cooldownTotal - cooldownRemaining) / cooldownTotal : 0)
      : 0;

  // Nudge the user via tab-title countdown + desktop notification, since the
  // whole premise is that they lose track of time with the tab backgrounded.
  useSessionAlerts({
    active,
    remainingSeconds: remainingInSession,
    limitSeconds: limit,
    overrun,
  });

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // When a tx confirms, refetch every contract read on the page (this card plus
  // Stats/Badges/History) instead of guessing with a fixed timeout.
  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries();
    }
  }, [isSuccess, queryClient]);

  const busy = isPending || isConfirming;

  const start = () => {
    let wei: bigint;
    try {
      wei = parseEther(stakeInput.trim());
    } catch {
      return; // non-numeric input
    }
    if (wei <= 0n || wei < minStake) return;
    resetWrite();
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: "startSession",
      value: wei,
    });
  };

  const startSponsored = () => {
    resetWrite();
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: "startSessionWithSponsorship",
    });
  };

  const end = () => {
    resetWrite();
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: "endSession",
    });
  };

  const statusLabel =
    phase === "active"
      ? overrun
        ? "OVERRUN"
        : "SESSION ACTIVE"
      : phase === "cooldown"
        ? "COOLDOWN"
        : "READY";

  const statusColor =
    phase === "active"
      ? overrun
        ? "text-danger"
        : "text-amber"
      : phase === "cooldown"
        ? "text-grass"
        : "text-grass/60";

  const barColor = overrun
    ? "bg-danger"
    : phase === "active"
      ? "bg-amber"
      : "bg-grass";

  const cardTone = overrun
    ? "border-danger/70 shadow-[0_0_0_1px_rgba(255,92,92,0.4),0_0_28px_-6px_rgba(255,92,92,0.5)]"
    : phase === "active"
      ? "border-amber/50 shadow-[0_0_24px_-8px_rgba(255,181,71,0.45)]"
      : phase === "cooldown"
        ? "border-grass/40 shadow-[0_0_24px_-10px_rgba(124,252,155,0.4)]"
        : "border-forest-600 shadow-lg";

  return (
    <div
      className={`rounded-2xl border bg-forest-800/70 p-5 transition-shadow duration-700 ${cardTone}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Session</h2>
        <span
          className={`flex items-center gap-2 font-mono text-xs font-bold ${statusColor}`}
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              phase === "idle" ? "bg-current" : "animate-pulse bg-current"
            }`}
          />
          {statusLabel}
        </span>
      </div>

      <Vitals phase={phase} />

      {/* Progress toward the session limit (or through the cooldown). */}
      {phase !== "idle" && (
        <div className="mt-4">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-forest-900"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label={phase === "active" ? "Session progress" : "Cooldown progress"}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${barColor}`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-grass/40">
            <span>{phase === "active" ? "limit" : "cooldown"}</span>
            <span>{fmtDuration(phase === "active" ? limit : cooldownTotal)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 font-mono text-sm">
        <div className="rounded-lg border border-forest-600 bg-forest-900/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-grass/60">
            Elapsed
          </div>
          <div className="text-xl text-grass">{fmtDuration(elapsed)}</div>
        </div>
        <div className="rounded-lg border border-forest-600 bg-forest-900/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-grass/60">
            {phase === "active" ? "Left to respect" : "Cooldown left"}
          </div>
          <div
            className={`text-xl ${
              overrun
                ? "text-danger"
                : phase === "active"
                  ? "text-amber"
                  : "text-grass"
            }`}
          >
            {fmtDuration(phase === "active" ? remainingInSession : cooldownRemaining)}
          </div>
        </div>
      </div>

      {active && (
        <div className="mt-3 font-mono text-xs text-grass/70">
          Staked: <span className="text-grass">{fmtMon(stakeAmount as bigint)} MON</span> · Penalty if
          overrun: <span className="text-amber">{(Number(penalty ?? 0) / 100).toFixed(2)}%</span>
        </div>
      )}

      <div className="mt-4">
        {!isConnected ? (
          <p className="text-center font-mono text-xs text-grass/50">Connect a wallet to begin.</p>
        ) : phase === "active" ? (
          <button
            onClick={end}
            disabled={busy}
            className="w-full rounded-xl bg-grass py-3 font-display text-base font-bold text-forest-900 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grass disabled:opacity-50"
          >
            {busy ? "Confirming…" : overrun ? "End Now — Take the Penalty" : "End Session"}
          </button>
        ) : phase === "cooldown" ? (
          <button
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-forest-600 py-3 font-display text-base font-bold text-grass/40"
          >
            Cooling down — enforced onchain
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative w-32">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                  aria-label="Stake amount in MON"
                  className={`w-full rounded-xl border bg-forest-900 px-3 py-3 pr-12 font-mono text-sm text-grass outline-none ${
                    belowMin ? "border-danger focus:border-danger" : "border-forest-600 focus:border-grass"
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-grass/40">
                  MON
                </span>
              </div>
              <button
                onClick={start}
                disabled={busy || invalidStake}
                className="flex-1 rounded-xl bg-grass py-3 font-display text-base font-bold text-forest-900 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grass disabled:opacity-50"
              >
                {busy ? "Confirming…" : "Start Session"}
              </button>
            </div>

            {minStake > 0n && (
              <p className={`font-mono text-[10px] ${belowMin ? "text-danger" : "text-grass/40"}`}>
                {belowMin
                  ? `Minimum stake is ${fmtMon(minStake)} MON — enough that the watchdog reward beats gas.`
                  : `Min stake ${fmtMon(minStake)} MON.`}
              </p>
            )}

            {hasSponsored && (
              <button
                onClick={startSponsored}
                disabled={busy}
                className="w-full rounded-xl border border-amber/60 bg-amber/10 py-2.5 font-display text-sm font-bold text-amber transition hover:bg-amber/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-50"
              >
                {busy
                  ? "Confirming…"
                  : `Start with ${fmtMon(sponsoredStake)} MON sponsored for you`}
              </button>
            )}
          </div>
        )}
      </div>

      {hash && (
        <p className="mt-3 break-all font-mono text-[10px] text-grass/50">
          tx: {hash} {isSuccess ? "✓" : isConfirming ? "…" : ""}
        </p>
      )}
      {writeError && (
        <p className="mt-3 font-mono text-xs text-danger">
          {friendlyError(writeError.message)}
        </p>
      )}
    </div>
  );
}
