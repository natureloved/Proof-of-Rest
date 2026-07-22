"use client";

import { useEffect, useState } from "react";
import type { AbiEvent } from "viem";
import { usePublicClient } from "wagmi";
import { PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";

const STARTED_EVENT = PROOF_OF_REST_ABI.find(
  (i): i is AbiEvent => i.type === "event" && i.name === "SessionStarted",
);

/**
 * Best-effort discovery of recent participant addresses by scanning
 * `SessionStarted` logs. Monad caps eth_getLogs at 100 blocks, so we can only
 * walk back a bounded window — this is NOT a complete history. Consumers should
 * present the result as "recent activity", not "all users". A subgraph/indexer
 * is the real fix for full coverage.
 */
export function useParticipants(windows = 20) {
  const publicClient = usePublicClient();
  const [addresses, setAddresses] = useState<`0x${string}`[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!publicClient || !STARTED_EVENT) return;
    let cancelled = false;

    const scan = async () => {
      setScanning(true);
      try {
        const WINDOW = 100n;
        const latest = await publicClient.getBlockNumber();
        const found = new Set<string>();
        let toBlock = latest;
        for (let i = 0; i < windows && !cancelled; i++) {
          const fromBlock = toBlock > WINDOW ? toBlock - WINDOW + 1n : 0n;
          const logs = await publicClient.getLogs({
            address: PROOF_OF_REST_ADDRESS,
            event: STARTED_EVENT,
            fromBlock,
            toBlock,
          });
          for (const log of logs) {
            const user = (log as unknown as { args?: { user?: string } }).args?.user;
            if (user) found.add(user.toLowerCase());
          }
          if (fromBlock === 0n) break;
          toBlock = fromBlock - 1n;
        }
        if (!cancelled) setAddresses([...found] as `0x${string}`[]);
      } catch {
        /* transient RPC error — keep whatever we had */
      } finally {
        if (!cancelled) setScanning(false);
      }
    };

    scan();
    const id = setInterval(scan, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicClient, windows]);

  return { addresses, scanning };
}
