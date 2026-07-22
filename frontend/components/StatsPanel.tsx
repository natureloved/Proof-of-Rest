"use client";

import { useAccount, useReadContract } from "wagmi";
import { PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";
import { fmtMon } from "@/lib/format";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-forest-600 bg-forest-900/60 p-3">
      <div className="text-[10px] uppercase tracking-widest text-grass/60">{label}</div>
      <div className={`font-mono text-xl ${accent ?? "text-grass"}`}>{value}</div>
    </div>
  );
}

export function StatsPanel() {
  const { address } = useAccount();

  const { data: completed } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sessionsCompleted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: streak } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "streak",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: forfeited } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sessionsForfeited",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: rewardPool } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "rewardPool",
  });
  const { data: successBonus } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "successBonusBps",
  });

  const streakVal = Number(streak ?? 0);
  const pool = (rewardPool as bigint) ?? 0n;
  const bonusBps = Number(successBonus ?? 0);
  // What you'd collect on your next successful close: successBonusBps of the pool.
  const nextBonus = (pool * BigInt(bonusBps)) / 10000n;

  return (
    <div className="rounded-2xl border border-forest-600 bg-forest-800/70 p-5">
      <h2 className="mb-3 font-display text-lg font-semibold">Your Stats</h2>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Current streak"
          value={streakVal > 0 ? `${streakVal} 🌱` : "0"}
          accent="text-amber"
        />
        <Stat label="Sessions done" value={String(completed ?? 0)} />
        <Stat label="Forfeited" value={String(forfeited ?? 0)} accent="text-danger" />
        <Stat label="Reward pool" value={`${fmtMon(pool)} MON`} />
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-grass/20 bg-grass/5 px-3 py-2 font-mono text-[11px]">
        <span className="text-grass/60">Next successful close pays you</span>
        <span className="font-bold text-grass">+{fmtMon(nextBonus)} MON</span>
      </div>
    </div>
  );
}
