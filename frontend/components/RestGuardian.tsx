"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { PROOF_OF_REST_ADDRESS, PROOF_OF_REST_ABI } from "@/lib/contracts";
import { classifyIntent, llmEnabled } from "@/lib/agent/llm";
import { buildPlan, type AgentPlan } from "@/lib/agent/plan";
import { useParticipants } from "@/lib/useParticipants";

// A single audit-trail entry: the "explain, then do" record of what the agent
// proposed and whether the user ultimately signed it.
interface LogEntry {
  id: number;
  text: string;
  intent: string;
  source: "deterministic" | "llm";
  action: string;
  simulation: AgentPlan["simulation"];
  signed: "not-signed" | "signing" | "signed" | "failed";
}

const EXAMPLES = [
  "I'm done working, end my session",
  "claim my reward",
  "start a 25 minute session",
  "what's in the reward pool and my streak?",
  "close a stale overrun session for the watchdog reward",
];

export function RestGuardian() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { addresses } = useParticipants();

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logSeq, setLogSeq] = useState(1);
  const [activeLogId, setActiveLogId] = useState<number | null>(null);

  const aiActive = useMemo(() => llmEnabled(), []);

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // On confirmation, refresh every read on the page and mark the audit entry signed.
  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries();
      setLog((prev) =>
        prev.map((e) => (e.id === activeLogId ? { ...e, signed: "signed" } : e)),
      );
    }
  }, [isSuccess, queryClient, activeLogId]);

  useEffect(() => {
    if (writeError && activeLogId !== null) {
      setLog((prev) =>
        prev.map((e) => (e.id === activeLogId ? { ...e, signed: "failed" } : e)),
      );
    }
  }, [writeError, activeLogId]);

  const busy = isPending || isConfirming;

  const submit = async (text: string) => {
    if (!text.trim() || !publicClient || !address) return;
    setThinking(true);
    setPlan(null);
    resetWrite();

    // discover → parse intent (LLM or deterministic) …
    const intent = await classifyIntent(text);
    console.info("[RestGuardian] intent", intent);

    // … → load state → build action → simulate → receipt
    const built = await buildPlan(
      intent,
      publicClient as PublicClient,
      address,
      PROOF_OF_REST_ADDRESS,
      PROOF_OF_REST_ABI,
    );
    console.info("[RestGuardian] plan", built);

    const id = logSeq;
    setLogSeq((n) => n + 1);
    setActiveLogId(id);
    setLog((prev) => [
      {
        id,
        text,
        intent: intent.kind,
        source: intent.source,
        action: built.action ? `${built.action.functionName}(${built.action.args.join(", ")})` : "—",
        simulation: built.simulation,
        signed: "not-signed",
      },
      ...prev,
    ]);

    setPlan(built);
    setThinking(false);
  };

  const sign = () => {
    if (!plan?.action) return;
    resetWrite();
    setLog((prev) =>
      prev.map((e) => (e.id === activeLogId ? { ...e, signed: "signing" } : e)),
    );
    console.info("[RestGuardian] user signing", plan.action);
    writeContract({
      address: PROOF_OF_REST_ADDRESS,
      abi: PROOF_OF_REST_ABI,
      functionName: plan.action.functionName,
      args: plan.action.args as readonly unknown[],
      value: plan.action.value,
    });
  };

  return (
    <div className="rounded-2xl border border-grass/40 bg-forest-800/70 p-5 shadow-[0_0_28px_-10px_rgba(124,252,155,0.45)]">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">
          RestGuardian <span className="text-grass">·</span>{" "}
          <span className="font-mono text-xs font-normal text-grass/60">safe onchain agent</span>
        </h2>
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
            aiActive
              ? "border-grass/50 bg-grass/10 text-grass"
              : "border-forest-600 bg-forest-900/60 text-grass/50"
          }`}
          title={
            aiActive
              ? "LLM parsing active (NEXT_PUBLIC_OPENAI_API_KEY set)"
              : "Deterministic parser — no API key needed"
          }
        >
          {aiActive ? "AI: LLM" : "AI: rules"}
        </span>
      </div>
      <p className="mb-3 font-mono text-[11px] text-grass/50">
        Tell me what you want in plain English. I build &amp; verify the transaction and show you
        exactly what it does — but I <span className="text-grass">never sign or send</span>. You review
        and sign in your own wallet.
      </p>

      {!isConnected ? (
        <p className="font-mono text-xs text-grass/50">Connect a wallet to talk to the agent.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !thinking) {
                  submit(input);
                }
              }}
              placeholder="e.g. I'm done, end my session"
              aria-label="Ask the RestGuardian agent"
              className="flex-1 rounded-xl border border-forest-600 bg-forest-900 px-3 py-2.5 font-mono text-sm text-grass outline-none focus:border-grass"
            />
            <button
              onClick={() => submit(input)}
              disabled={thinking || !input.trim()}
              className="shrink-0 rounded-xl bg-grass px-4 py-2.5 font-display text-sm font-bold text-forest-900 transition hover:brightness-110 disabled:opacity-50"
            >
              {thinking ? "Thinking…" : "Ask"}
            </button>
          </div>

          {/* Example prompts — one click to populate + run. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setInput(ex);
                  submit(ex);
                }}
                disabled={thinking}
                className="rounded-full border border-forest-600 bg-forest-900/60 px-2.5 py-1 font-mono text-[10px] text-grass/60 transition hover:border-grass/40 hover:text-grass disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Discovered overrun addresses — one click to draft a watchdog close. */}
          {addresses.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-grass/40">recent:</span>
              {addresses.slice(0, 4).map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    const t = `close overrun session ${a} for the watchdog reward`;
                    setInput(t);
                    submit(t);
                  }}
                  disabled={thinking}
                  className="rounded-full border border-forest-600 bg-forest-900/60 px-2 py-0.5 font-mono text-[10px] text-grass/50 transition hover:border-danger/40 hover:text-danger disabled:opacity-50"
                >
                  {a.slice(0, 6)}…{a.slice(-4)}
                </button>
              ))}
            </div>
          )}

          {/* Receipt card — the Moss-style verified summary. */}
          {plan && <Receipt plan={plan} busy={busy} onSign={sign} />}

          {hash && (
            <p className="mt-3 break-all font-mono text-[10px] text-grass/50">
              tx: {hash} {isSuccess ? "✓" : isConfirming ? "…" : ""}
            </p>
          )}

          {/* Audit trail — "explain, then do". */}
          {log.length > 0 && (
            <div className="mt-4 border-t border-forest-600 pt-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-grass/40">
                Audit trail
              </div>
              <ul className="space-y-1.5">
                {log.slice(0, 6).map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg border border-forest-600 bg-forest-900/40 px-3 py-2 font-mono text-[10px] text-grass/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-grass/80">“{e.text}”</span>
                      <span className={signedColor(e.signed)}>{signedLabel(e.signed)}</span>
                    </div>
                    <div className="mt-0.5 text-grass/40">
                      {e.intent} · {e.source} · {e.action} · sim:{e.simulation}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Receipt({
  plan,
  busy,
  onSign,
}: {
  plan: AgentPlan;
  busy: boolean;
  onSign: () => void;
}) {
  const badge = simulationBadge(plan.simulation, plan.revertReason);

  return (
    <div className="mt-3 rounded-xl border border-forest-600 bg-forest-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-sm font-semibold text-grass">{plan.summary}</span>
        <span className={`font-mono text-[10px] font-bold ${badge.color}`}>{badge.label}</span>
      </div>

      <ul className="space-y-1 font-mono text-xs text-grass/80">
        {plan.receipt.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      {plan.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-[11px] text-amber">
          {plan.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {plan.simulation === "will_revert" && plan.revertReason && (
        <p className="mt-2 font-mono text-[11px] text-danger">
          Would revert: {plan.revertReason}
        </p>
      )}

      {plan.canSign ? (
        <button
          onClick={onSign}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-grass py-2.5 font-display text-sm font-bold text-forest-900 transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Confirming…" : "Review & Sign in your wallet"}
        </button>
      ) : (
        plan.action && (
          <p className="mt-3 text-center font-mono text-[10px] text-grass/40">
            Nothing to sign — the agent won&apos;t send a transaction that would fail.
          </p>
        )
      )}
    </div>
  );
}

function simulationBadge(
  sim: AgentPlan["simulation"],
  reason?: string,
): { label: string; color: string } {
  switch (sim) {
    case "ok":
      return { label: "✓ VERIFIED — WILL SUCCEED", color: "text-grass" };
    case "will_revert":
      return { label: `⚠ WOULD REVERT`, color: "text-danger" };
    case "read_only":
      return { label: "READ-ONLY", color: "text-grass/60" };
    case "skipped":
    default:
      return { label: reason ? "⚠ CANNOT BUILD" : "—", color: "text-amber" };
  }
}

function signedLabel(s: LogEntry["signed"]): string {
  switch (s) {
    case "signed":
      return "SIGNED ✓";
    case "signing":
      return "SIGNING…";
    case "failed":
      return "FAILED";
    case "not-signed":
    default:
      return "NOT SIGNED";
  }
}

function signedColor(s: LogEntry["signed"]): string {
  switch (s) {
    case "signed":
      return "text-grass";
    case "signing":
      return "text-amber";
    case "failed":
      return "text-danger";
    case "not-signed":
    default:
      return "text-grass/40";
  }
}
