"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther } from "viem";
import { PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";
import { fmtMon, useNow } from "@/lib/format";

// The chain can't be scanned from genesis (Monad caps eth_getLogs at 100
// blocks), so we remember which beneficiaries this wallet has sponsored in
// localStorage and read each one's live contribution back from the contract.
const lsKey = (sponsor: string) => `por:sponsorships:${sponsor.toLowerCase()}`;

function loadTracked(sponsor: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(lsKey(sponsor)) ?? "[]");
  } catch {
    return [];
  }
}

function addTracked(sponsor: string, beneficiary: string) {
  if (typeof window === "undefined") return;
  const set = new Set(loadTracked(sponsor).map((a) => a.toLowerCase()));
  set.add(beneficiary.toLowerCase());
  window.localStorage.setItem(lsKey(sponsor), JSON.stringify([...set]));
}

export function SponsorPanel() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [beneficiary, setBeneficiary] = useState("");
  const [amount, setAmount] = useState("0.05");
  const [tracked, setTracked] = useState<string[]>([]);

  useEffect(() => {
    if (address) setTracked(loadTracked(address));
  }, [address]);

  const {
    writeContract,
    data: hash,
    isPending,
    error,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries();
      if (address) setTracked(loadTracked(address));
    }
  }, [isSuccess, queryClient, address]);

  const validBeneficiary = /^0x[a-fA-F0-9]{40}$/.test(beneficiary);

  const sponsor = () => {
    if (!validBeneficiary || !address) return;
    let wei: bigint;
    try {
      wei = parseEther(amount.trim());
    } catch {
      return;
    }
    if (wei <= 0n) return;
    addTracked(address, beneficiary);
    setTracked(loadTracked(address));
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: "sponsorSession",
      args: [beneficiary as `0x${string}`],
      value: wei,
    });
  };

  const busy = isPending || isConfirming;

  return (
    <div className="rounded-2xl border border-forest-600 bg-forest-800/70 p-5">
      <h2 className="mb-1 font-display text-lg font-semibold">Sponsor a Friend</h2>
      <p className="mb-3 font-mono text-[11px] text-grass/50">
        Fund someone else&apos;s rest stake. They start a session without spending their own MON.
      </p>
      {!isConnected ? (
        <p className="font-mono text-xs text-grass/50">Connect a wallet to sponsor.</p>
      ) : (
        <div className="space-y-2">
          <input
            placeholder="beneficiary address (0x…)"
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            aria-label="Beneficiary address"
            className={`w-full rounded-xl border bg-forest-900 px-3 py-2 font-mono text-xs text-grass outline-none ${
              beneficiary && !validBeneficiary
                ? "border-danger focus:border-danger"
                : "border-forest-600 focus:border-grass"
            }`}
          />
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Sponsor amount in MON"
              className="w-32 rounded-xl border border-forest-600 bg-forest-900 px-3 py-2 font-mono text-sm text-grass outline-none focus:border-grass"
            />
            <button
              onClick={sponsor}
              disabled={busy || !validBeneficiary}
              className="flex-1 rounded-xl bg-amber py-2 font-display text-sm font-bold text-forest-900 transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Sponsor"}
            </button>
          </div>
          {hash && (
            <p className="break-all font-mono text-[10px] text-grass/50">
              tx: {hash} {isSuccess ? "✓" : isConfirming ? "…" : ""}
            </p>
          )}
          {error && (
            <p className="font-mono text-xs text-danger">{error.message.slice(0, 120)}</p>
          )}

          {tracked.length > 0 && address && (
            <div className="mt-3 border-t border-forest-600 pt-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-grass/50">
                Your sponsorships
              </div>
              <ul className="space-y-2">
                {tracked.map((b) => (
                  <SponsorshipRow key={b} sponsor={address} beneficiary={b as `0x${string}`} busy={busy} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SponsorshipRow({
  sponsor,
  beneficiary,
  busy,
}: {
  sponsor: `0x${string}`;
  beneficiary: `0x${string}`;
  busy: boolean;
}) {
  const now = useNow(true);

  const { data: contribution } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sponsorContribution",
    args: [beneficiary, sponsor],
  });
  const { data: since } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sponsorSince",
    args: [beneficiary, sponsor],
  });
  const { data: delay } = useReadContract({
    address: PROOF_OF_REST_ADDRESS,
    abi: PROOF_OF_REST_ABI,
    functionName: "sponsorshipReclaimDelay",
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const amount = (contribution as bigint) ?? 0n;
  const unlockAt = since && delay ? Number(since) + Number(delay) : 0;
  const secsLeft = Math.max(0, unlockAt - now);
  const reclaimable = amount > 0n && secsLeft === 0;
  const rowBusy = busy || isPending || isConfirming;

  // Consumed / already reclaimed — nothing to show.
  if (amount === 0n) return null;

  const reclaim = () => {
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: "reclaimSponsorship",
      args: [beneficiary],
    });
  };

  const short = `${beneficiary.slice(0, 6)}…${beneficiary.slice(-4)}`;
  const hrsLeft = Math.ceil(secsLeft / 3600);

  return (
    <li className="flex items-center gap-2 rounded-lg border border-forest-600 bg-forest-900/50 px-3 py-2 font-mono text-xs">
      <span className="flex-1 truncate text-grass/70">
        {short} · <span className="text-grass">{fmtMon(amount)} MON</span>
      </span>
      {reclaimable ? (
        <button
          onClick={reclaim}
          disabled={rowBusy}
          className="shrink-0 rounded-lg border border-grass/60 bg-grass/10 px-2 py-1 text-[10px] font-bold uppercase text-grass transition hover:bg-grass/20 disabled:opacity-50"
        >
          {rowBusy ? "…" : "Reclaim"}
        </button>
      ) : (
        <span className="shrink-0 text-[10px] uppercase text-grass/30">
          locked {hrsLeft}h
        </span>
      )}
    </li>
  );
}
