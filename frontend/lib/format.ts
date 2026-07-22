"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";

export function useNow(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function fmtMon(wei: bigint, decimals = 4): string {
  const v = parseFloat(formatUnits(wei, 18));
  return v.toFixed(decimals);
}
