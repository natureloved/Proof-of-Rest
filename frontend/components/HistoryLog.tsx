"use client";

import { useEffect, useState } from "react";
import type { AbiEvent } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { MONAD_TESTNET, PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";
import { fmtMon } from "@/lib/format";

// getLogs' `events` option expects event ABI items only. Passing the full ABI
// (functions, errors, constructor) makes viem call encodeEventTopics on every
// item and throw AbiEventNotFoundError on the first non-event.
const POR_EVENTS = PROOF_OF_REST_ABI.filter(
  (item): item is AbiEvent => item.type === "event",
);

type Row = {
  type: "started" | "ended" | "forfeited";
  hash: string;
  block: bigint;
  note: string;
};

const txUrl = (hash: string) =>
  `${MONAD_TESTNET.blockExplorers.default.url}/tx/${hash}`;

export function HistoryLog() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !publicClient) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        // Monad's RPC caps eth_getLogs at a 100-block range, so we can't scan
        // from genesis. Walk backward from the tip in 100-block windows until we
        // have enough activity or hit the lookback cap.
        const WINDOW = 100n;
        const MAX_WINDOWS = 20; // ~2000 blocks of lookback
        const NEEDED = 20;
        const latest = await publicClient.getBlockNumber();
        const logs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
        let toBlock = latest;
        for (let i = 0; i < MAX_WINDOWS && !cancelled; i++) {
          const fromBlock = toBlock > WINDOW ? toBlock - WINDOW + 1n : 0n;
          const chunk = await publicClient.getLogs({
            address: PROOF_OF_REST_ADDRESS,
            events: POR_EVENTS,
            fromBlock,
            toBlock,
          });
          logs.push(...chunk);
          if (logs.length >= NEEDED || fromBlock === 0n) break;
          toBlock = fromBlock - 1n;
        }
        const decoded = logs
          .map((log) => {
            const { eventName: name, args: a } = log as unknown as {
              eventName: string;
              args: Record<string, bigint>;
            };
            let type: Row["type"];
            let note = "";
            if (name === "SessionStarted") {
              type = "started";
              note = `staked ${fmtMon(BigInt(a.stake))} MON`;
            } else if (name === "SessionEnded") {
              type = "ended";
              note = `reclaimed ${fmtMon(BigInt(a.refunded))} MON + ${fmtMon(BigInt(a.poolBonus))} bonus`;
            } else if (name === "SessionForfeited") {
              type = "forfeited";
              note = `overran — kept ${fmtMon(BigInt(a.refunded))} MON, watchdog got ${fmtMon(BigInt(a.watchdogReward))} MON`;
            } else {
              return null;
            }
            return {
              type,
              hash: log.transactionHash as string,
              block: log.blockNumber as bigint,
              note,
            } as Row;
          })
          .filter((r): r is Row => r !== null)
          .sort((a, b) => (b.block > a.block ? 1 : -1))
          .slice(0, 20);
        if (!cancelled) setRows(decoded as Row[]);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 12000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, publicClient]);

  return (
    <div className="rounded-2xl border border-forest-600 bg-forest-800/70 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Live Activity</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-grass/40">
          network-wide
        </span>
      </div>
      {!isConnected ? (
        <p className="font-mono text-xs text-grass/50">Connect a wallet to view activity.</p>
      ) : loading && rows.length === 0 ? (
        <p className="font-mono text-xs text-grass/50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-grass/50">No sessions yet — be the first.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li
              key={`${r.hash}-${i}`}
              className="flex items-center gap-3 rounded-lg border border-forest-600 bg-forest-900/50 px-3 py-2 font-mono text-xs"
            >
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase ${
                  r.type === "ended"
                    ? "bg-grass/15 text-grass"
                    : r.type === "forfeited"
                      ? "bg-danger/15 text-danger"
                      : "bg-amber/15 text-amber"
                }`}
              >
                {r.type}
              </span>
              <span className="flex-1 text-grass/70">{r.note}</span>
              <a
                href={txUrl(r.hash)}
                target="_blank"
                rel="noreferrer"
                aria-label="View transaction on explorer"
                className="shrink-0 text-grass/30 underline-offset-2 transition hover:text-grass hover:underline"
              >
                {r.hash.slice(0, 6)}…
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
