"use client";

import { useEffect, useRef } from "react";

/**
 * The point of Proof of Rest is that you lose track of time — so the app has to
 * reach you even when the tab is backgrounded. This hook drives two nudges while
 * a session is active:
 *
 *  1. The browser tab title becomes a live countdown (⏳ mm:ss) so a glance at
 *     the tab strip tells you where you stand.
 *  2. A desktop Notification fires once when you cross the warning threshold
 *     (default 90% of the limit) and again the moment you overrun.
 *
 * Notifications are best-effort: permission is requested lazily and silence is
 * fine if the user declines. The title is always restored on cleanup.
 */
export function useSessionAlerts({
  active,
  remainingSeconds,
  limitSeconds,
  overrun,
  warnRatio = 0.9,
}: {
  active: boolean;
  remainingSeconds: number;
  limitSeconds: number;
  overrun: boolean;
  warnRatio?: number;
}) {
  const warnedRef = useRef(false);
  const overrunNotifiedRef = useRef(false);
  const baseTitleRef = useRef<string>("");

  // Capture the document's original title once so we can restore it.
  useEffect(() => {
    if (typeof document !== "undefined" && !baseTitleRef.current) {
      baseTitleRef.current = document.title || "Proof of Rest";
    }
  }, []);

  // Ask for notification permission the first time a session goes active — not
  // on page load, which browsers penalise as an unsolicited prompt.
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [active]);

  // Reset the one-shot flags whenever a new session begins.
  useEffect(() => {
    if (active) {
      warnedRef.current = false;
      overrunNotifiedRef.current = false;
    }
  }, [active]);

  const notify = (title: string, body: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, tag: "proof-of-rest-session" });
    } catch {
      /* some browsers require a ServiceWorker for Notification; ignore */
    }
  };

  useEffect(() => {
    const base = baseTitleRef.current || "Proof of Rest";

    if (!active) {
      if (typeof document !== "undefined") document.title = base;
      return;
    }

    const mmss = (secs: number) => {
      const s = Math.max(0, Math.floor(secs));
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    if (typeof document !== "undefined") {
      document.title = overrun
        ? `🔴 OVERRUN · ${base}`
        : `⏳ ${mmss(remainingSeconds)} · ${base}`;
    }

    // Warn once as the deadline approaches.
    const elapsedRatio =
      limitSeconds > 0 ? (limitSeconds - remainingSeconds) / limitSeconds : 0;
    if (!overrun && !warnedRef.current && elapsedRatio >= warnRatio) {
      warnedRef.current = true;
      notify(
        "Rest deadline approaching",
        `About ${mmss(remainingSeconds)} left before your stake is at risk. Wrap up and reclaim it.`,
      );
    }

    // Fire once at the moment of overrun.
    if (overrun && !overrunNotifiedRef.current) {
      overrunNotifiedRef.current = true;
      notify(
        "You've overrun ⏰",
        "End the session now to stop the penalty from growing, and take your enforced break.",
      );
    }

    return () => {
      if (typeof document !== "undefined") document.title = base;
    };
  }, [active, remainingSeconds, limitSeconds, overrun, warnRatio]);
}
