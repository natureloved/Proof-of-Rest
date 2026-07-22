"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";
import { fmtMon, fmtDuration, useNow } from "@/lib/format";
import { useParticipants } from "@/lib/useParticipants";

export function WatchdogPanel() {
  const { isConnected } = useAccount();
  const { addresses, scanning } = useParticipants();
  const [manual, setManual] = useState("");

  const manualValid = /^0x[a-fA-F0-9]{40}$/.test(manual);

  // Merge discovered + manually-entered address, de-duped.
  const candidates = Array.from(
    new Set([
      ...(manualValid ? [manual.toLowerCase()] : []),
      ...addresses.map((a) => a.toLowerCase()),
    ]),
  ) as `0x${string}`[];

  return (
    <div className="rounded-2xl border border-forest-600 bg-forest-800/70 p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Watchdog</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-grass/40">
          {scanning ? "scanning…" : "recent"}
        </span>
      </div>
      <p className="mb-3 font-mono text-[11px] text-grass/50">
        Anyone can close an overrun session and earn the watchdog reward. Recent
        sessions are scanned from chain logs (limited window) — or paste an address to check.
      </p>

      {!isConnected ? (
        <p className="font-mono text-xs text-grass/50">Connect a wallet to act as a watchdog.</p>
      ) : (
        <>
          <input
            placeholder="check an address (0x…)"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            aria-label="Address to check for overrun"
            className={`mb-3 w-full rounded-xl border bg-forest-900 px-3 py-2 font-mono text-xs text-grass outline-none ${
              manual && !manualValid
                ? "border-danger focus:border-danger"
                : "border-forest-600 focus:border-grass"
            }`}
          />
          {candidates.length === 0 ? (
            <p className="font-mono text-xs text-grass/40">
              No recent sessions found in the scanned window.
            </p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((addr) => (
                <WatchRow key={addr} user={addr} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function WatchRow({ user }: { user: `0x${string}` }) {
  const now = useNow(true);
  const queryClient = useQueryClient();

  const { data: session } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sessions",
    args: [user],
    query: { refetchInterval: 8000 },
  });
  const { data: maxDur } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "maxSessionDuration",
  });
  const { data: penalty } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "penaltyBps",
  });
  const { data: watchdog } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "watchdogBps",
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const tuple = session as readonly [bigint, bigint, boolean] | undefined;
  const active = !!tuple && tuple[2] === true;
  const stake = tuple ? tuple[0] : 0n;
  const startTime = tuple ? Number(tuple[1]) : 0;
  const limit = maxDur ? Number(maxDur) : 4 * 3600;
  const elapsed = active ? now - startTime : 0;
  const overrun = active && elapsed > limit;

  // Estimated reward = stake * penaltyBps * watchdogBps / 1e8
  const estReward =
    (stake * BigInt(Number(penalty ?? 0)) * BigInt(Number(watchdog ?? 0))) / 100_000_000n;

  useEffect(() => {
    if (isSuccess) queryClient.invalidateQueries();
  }, [isSuccess, queryClient]);

  // Only show sessions that are actually closable (overrun). Non-overrun and
  // idle addresses are hidden to keep the list actionable.
  if (!overrun) return null;

  const close = () => {
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: "forceEndOverrunSession",
      args: [user],
    });
  };

  const busy = isPending || isConfirming;
  const short = `${user.slice(0, 6)}…${user.slice(-4)}`;

  return (
    <li className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 font-mono text-xs">
      <span className="min-w-0 flex-1">
        <span className="text-grass/70">{short}</span>
        <span className="block text-[10px] text-danger">
          over by {fmtDuration(elapsed - limit)} · reward ≈ {fmtMon(estReward)} MON
        </span>
      </span>
      <button
        onClick={close}
        disabled={busy}
        className="shrink-0 rounded-lg border border-danger/60 bg-danger/10 px-2 py-1 text-[10px] font-bold uppercase text-danger transition hover:bg-danger/20 disabled:opacity-50"
      >
        {busy ? "…" : "Close & earn"}
      </button>
    </li>
  );
}
