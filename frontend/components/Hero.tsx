"use client";

export function Hero() {
  return (
    <section className="mt-8 text-center sm:mt-10">
      <span className="inline-flex items-center gap-2 rounded-full border border-grass/25 bg-grass/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.3em] text-grass/60">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-grass animate-pulse"
        />
        for builders who overwork
      </span>
      <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight text-grass sm:text-4xl">
        Put your stake where your rest is.
      </h2>
      <p className="mx-auto mt-3 max-w-xl font-mono text-sm leading-relaxed text-grass/60">
        Lock MON to start a work session. Stop in time and reclaim it. Overrun
        and the chain keeps a cut — then makes you take a real break.
      </p>
    </section>
  );
}
