"use client";

import { useAccount, useReadContract } from "wagmi";
import { REST_BADGE_ADDRESS, REST_BADGE_ABI } from "@/lib/contracts";

const BADGES = [
  { threshold: 1, name: "First Grass Touched", desc: "Respect 1 session" },
  { threshold: 3, name: "3x Streak", desc: "Respect 3 in a row" },
  { threshold: 7, name: "Break Champion", desc: "Respect 7 in a row" },
];

export function BadgeGallery() {
  const { address, isConnected } = useAccount();

  return (
    <div className="rounded-2xl border border-forest-600 bg-forest-800/70 p-5">
      <h2 className="mb-3 font-display text-lg font-semibold">Badges — Touched Grass</h2>
      {!isConnected ? (
        <p className="font-mono text-xs text-grass/50">Connect a wallet to view badges.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {BADGES.map((b) => (
            <BadgeCell key={b.threshold} user={address!} threshold={b.threshold} name={b.name} desc={b.desc} />
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeCell({
  user,
  threshold,
  name,
  desc,
}: {
  user: `0x${string}`;
  threshold: number;
  name: string;
  desc: string;
}) {
  // RestBadge encodes tokenId = (user << 32) | threshold, so each (user,threshold)
  // is a deterministic, probeable token.
  const tokenId = (BigInt(user) << 32n) | BigInt(threshold);
  const { data: owner } = useReadContract({
    address: REST_BADGE_ADDRESS,
    abi: REST_BADGE_ABI,
    functionName: "ownerOf",
    args: [tokenId],
    query: { retry: false, refetchInterval: 4000 },
  }) as { data: `0x${string}` | undefined };

  const unlocked = !!owner && owner.toLowerCase() === user.toLowerCase();

  return (
    <div
      className={`rounded-xl border p-4 text-center transition ${
        unlocked ? "border-grass bg-forest-900/80" : "border-forest-600 bg-forest-900/40 opacity-50"
      }`}
    >
      <div
        className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border-2 font-mono text-lg ${
          unlocked ? "border-grass text-grass" : "border-forest-600 text-grass/30"
        }`}
      >
        {threshold}
      </div>
      <div className="font-display text-sm font-semibold text-grass">{name}</div>
      <div className="mt-1 font-mono text-[10px] text-grass/50">{desc}</div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-widest">
        {unlocked ? (
          <span className="text-grass">unlocked</span>
        ) : (
          <span className="text-grass/30">locked</span>
        )}
      </div>
    </div>
  );
}
