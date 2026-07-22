"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { MONAD_TESTNET } from "@/lib/contracts";

export function Header() {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const wrongNetwork = isConnected && chainId !== MONAD_TESTNET.id;

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-forest-600 pb-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-grass/40 bg-grass/10 font-mono text-lg text-grass"
        >
          ⏾
        </span>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-grass">
            Proof of Rest
          </h1>
          <p className="font-mono text-xs text-grass/70">
            onchain commitment device · Monad Testnet
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {wrongNetwork && (
          <span className="rounded border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-xs text-amber">
            switch to Monad Testnet
          </span>
        )}
        <ConnectButton />
      </div>
    </header>
  );
}
