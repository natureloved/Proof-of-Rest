"use client";

const STEPS = [
  {
    n: "01",
    title: "Stake MON",
    body: "Lock a stake to open a work session. The chain starts the clock.",
    accent: "text-grass",
  },
  {
    n: "02",
    title: "End in time",
    body: "Close within the limit to reclaim your stake plus a cut of the reward pool. Streak +1.",
    accent: "text-amber",
  },
  {
    n: "03",
    title: "Or forfeit",
    body: "Run past the limit and a slice is forfeited to the pool. A cooldown is then enforced onchain.",
    accent: "text-danger",
  },
];

export function HowItWorks() {
  return (
    <section
      aria-label="How it works"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {STEPS.map((s) => (
        <div
          key={s.n}
          className="rounded-2xl border border-forest-600 bg-forest-800/50 p-4"
        >
          <div className={`font-mono text-xs font-bold ${s.accent}`}>{s.n}</div>
          <div className="mt-1 font-display text-base font-semibold text-grass">
            {s.title}
          </div>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-grass/60">
            {s.body}
          </p>
        </div>
      ))}
    </section>
  );
}
