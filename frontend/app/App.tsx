"use client";

import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { SessionCard } from "@/components/SessionCard";
import { RestGuardian } from "@/components/RestGuardian";
import { StatsPanel } from "@/components/StatsPanel";
import { BadgeGallery } from "@/components/BadgeGallery";
import { HistoryLog } from "@/components/HistoryLog";
import { SponsorPanel } from "@/components/SponsorPanel";
import { WatchdogPanel } from "@/components/WatchdogPanel";
import { Leaderboard } from "@/components/Leaderboard";
import { NetworkGuard } from "@/components/NetworkGuard";
import { CONTRACT_URLS } from "@/lib/contracts";

export default function App() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <NetworkGuard />
      <Header />

      <Hero />

      <div className="mt-6">
        <HowItWorks />
      </div>

      <div className="mt-6">
        <RestGuardian />
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SessionCard />
          <StatsPanel />
          <Leaderboard />
        </div>
        <div className="space-y-4">
          <BadgeGallery />
          <SponsorPanel />
          <WatchdogPanel />
          <HistoryLog />
        </div>
      </section>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-forest-600 pt-4 font-mono text-[10px] text-grass/40">
        <span>
          Proof of Rest · Monad Playground ·{" "}
          <a className="underline hover:text-grass" href={CONTRACT_URLS.proofOfRest} target="_blank" rel="noreferrer">
            contract
          </a>{" "}
          ·{" "}
          <a className="underline hover:text-grass" href={CONTRACT_URLS.restBadge} target="_blank" rel="noreferrer">
            badges
          </a>
        </span>
        <span>a safe onchain agent builds &amp; verifies — you sign</span>
      </footer>
    </main>
  );
}
