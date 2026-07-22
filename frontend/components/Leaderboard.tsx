"use client";

import { useReadContract } from "wagmi";
import { useCallback, useEffect, useState } from "react";
import { PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";
import { useParticipants } from "@/lib/useParticipants";

type Score = { streak: number; completed: number };

export function Leaderboard() {
  const { addresses, scanning } = useParticipants();
  // Cap fan-out to keep RPC load sane.
  const capped = addresses.slice(0, 24);
  const [scores, setScores] = useState<Record<string, Score>>({});

  const report = useCallback((addr: string, s: Score) => {
    setScores((prev) => {
      const cur = prev[addr];
      if (cur && cur.streak === s.streak && cur.completed === s.completed) return prev;
      return { ...prev, [addr]: s };
    });
  }, []);

  const ranked = Object.entries(scores)
    .filter(([, s]) => s.completed > 0 || s.streak > 0)
    .sort((a, b) => b[1].streak - a[1].streak || b[1].completed - a[1].completed)
    .slice(0, 8);

  return (
    <div className="rounded-2xl border border-forest-600 bg-forest-800/70 p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Leaderboard</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-grass/40">
          {scanning ? "scanning…" : "recent"}
        </span>
      </div>
      <p className="mb-3 font-mono text-[11px] text-grass/50">
        Longest active streaks among recently-seen builders.
      </p>

      {/* Hidden readers: one component per address, stable hook order each. */}
      {capped.map((a) => (
        <ScoreReader key={a} address={a} onScore={report} />
      ))}

      {ranked.length === 0 ? (
        <p className="font-mono text-xs text-grass/40">
          {addresses.length === 0
            ? "No recent activity in the scanned window."
            : "No streaks yet."}
        </p>
      ) : (
        <ol className="space-y-2">
          {ranked.map(([addr, s], i) => (
            <li
              key={addr}
              className="flex items-center gap-3 rounded-lg border border-forest-600 bg-forest-900/50 px-3 py-2 font-mono text-xs"
            >
              <span
                className={`w-5 shrink-0 text-center font-bold ${
                  i === 0 ? "text-amber" : i === 1 ? "text-grass" : "text-grass/50"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex-1 truncate text-grass/70">
                {addr.slice(0, 6)}…{addr.slice(-4)}
              </span>
              <span className="shrink-0 text-grass/50">{s.completed} done</span>
              <span className="shrink-0 font-bold text-amber">
                {s.streak > 0 ? `${s.streak}🌱` : "—"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ScoreReader({
  address,
  onScore,
}: {
  address: `0x${string}`;
  onScore: (addr: string, s: Score) => void;
}) {
  const { data: streak } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "streak",
    args: [address],
    query: { refetchInterval: 15000 },
  });
  const { data: completed } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sessionsCompleted",
    args: [address],
    query: { refetchInterval: 15000 },
  });

  const s = Number(streak ?? 0);
  const c = Number(completed ?? 0);
  useEffect(() => {
    onScore(address.toLowerCase(), { streak: s, completed: c });
  }, [address, s, c, onScore]);

  return null;
}
