// RestGuardian intent model + deterministic parser.
//
// The agent turns a natural-language request into a structured `ParsedIntent`.
// This parser is the always-available baseline: it needs no API key and runs
// entirely in the browser, so the demo works keyless. The optional LLM path
// (see llm.ts) produces the SAME shape and falls back here on any failure.

export type AgentIntentKind =
  | "end_session"
  | "claim_reward"
  | "start_session"
  | "watchdog_close"
  | "query_state"
  | "sponsor"
  | "reclaim"
  | "unknown";

export interface ParsedIntent {
  kind: AgentIntentKind;
  /** Target address for watchdog/sponsor/reclaim intents, if the user named one. */
  address?: `0x${string}`;
  /** Stake / sponsor amount in MON, if the user named one (e.g. "0.05"). */
  amountMon?: string;
  /** Advisory session length in minutes for start_session (see note below). */
  minutes?: number;
  /** How the intent was derived — surfaced in the UI so the AI story is honest. */
  source: "deterministic" | "llm";
  /** The raw text the user typed, kept for the audit trail. */
  rawText: string;
}

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/;
// "0.05", "1", "2.5 MON", "0.1mon" — capture the number, MON suffix optional.
const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(?:mon\b)?/i;
const MINUTES_RE = /(\d+)\s*(?:min(?:ute)?s?|m)\b/i;

export function extractAddress(text: string): `0x${string}` | undefined {
  const m = text.match(ADDRESS_RE);
  return m ? (m[0] as `0x${string}`) : undefined;
}

export function extractMinutes(text: string): number | undefined {
  const m = text.match(MINUTES_RE);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Extract a MON amount, deliberately ignoring numbers that are actually a
 * minutes phrase ("25 minutes") or part of an address, so "start a 25 minute
 * session" doesn't read 25 as a stake.
 */
export function extractMon(text: string): string | undefined {
  const withoutAddr = text.replace(ADDRESS_RE, " ");
  const withoutMinutes = withoutAddr.replace(MINUTES_RE, " ");
  const m = withoutMinutes.match(AMOUNT_RE);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? m[1] : undefined;
}

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * Deterministic keyword/regex intent parser. Order matters: more specific
 * intents (watchdog, sponsor, reclaim) are checked before the broad
 * end/claim/start buckets so a phrase like "close someone's stale session"
 * isn't mistaken for "close my session".
 *
 * Note on start_session minutes: `maxSessionDuration` is a single contract-wide
 * owner setting, not per-session — so a requested duration is advisory only. The
 * plan builder states the real on-chain limit and flags any mismatch in the
 * receipt rather than silently ignoring the request.
 */
export function parseIntent(rawText: string): ParsedIntent {
  const text = rawText.toLowerCase().trim();
  const address = extractAddress(rawText);
  const base = { source: "deterministic" as const, rawText };

  // Watchdog: closing someone ELSE's overrun session. Checked first so "close"
  // paired with a third-party cue or an explicit address doesn't fall through to
  // end_session (which closes the caller's own session).
  const watchdogCue =
    hasAny(text, ["watchdog", "stale", "overrun", "someone", "somebody", "their session", "else"]) ||
    (hasAny(text, ["close", "end", "force"]) && !!address && !hasAny(text, ["my", "mine", "own"]));
  if (watchdogCue && hasAny(text, ["close", "end", "force", "watchdog", "stale", "overrun"])) {
    return { ...base, kind: "watchdog_close", address };
  }

  if (hasAny(text, ["reclaim", "refund my sponsor", "get my sponsor"])) {
    return { ...base, kind: "reclaim", address };
  }

  if (hasAny(text, ["sponsor", "fund someone", "pay for"])) {
    return { ...base, kind: "sponsor", address, amountMon: extractMon(rawText) };
  }

  if (hasAny(text, ["claim", "reward", "bonus", "collect"])) {
    return { ...base, kind: "claim_reward" };
  }

  if (hasAny(text, ["end", "done", "finish", "stop", "wrap up", "i'm done", "close my", "close it"])) {
    return { ...base, kind: "end_session" };
  }

  if (hasAny(text, ["start", "begin", "new session", "lock", "focus for"])) {
    return {
      ...base,
      kind: "start_session",
      minutes: extractMinutes(rawText),
      amountMon: extractMon(rawText),
    };
  }

  if (hasAny(text, ["pool", "streak", "how much", "status", "state", "balance", "what's my", "whats my"])) {
    return { ...base, kind: "query_state" };
  }

  return { ...base, kind: "unknown" };
}
