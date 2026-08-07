"use client";

import { ReactNode, useEffect, useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  coinbaseWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { MONAD_TESTNET } from "@/lib/contracts";

const queryClient = new QueryClient();

// A real WalletConnect Cloud project id is required for the WalletConnect
// transport. Without one, WalletConnect's Explorer API returns 400/401 and its
// modal crashes with `Object.values(undefined)` while preloading wallet
// listings. Treat the placeholder / empty value as "no id" and fall back to
// injected (browser-extension) wallets, which don't need WalletConnect at all.
const RAW_WC_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;
const HAS_VALID_WC_ID =
  !!RAW_WC_ID && RAW_WC_ID !== "proof-of-rest-demo" && RAW_WC_ID.length >= 16;

// Client-only lazy singleton. getDefaultConfig / the connectors eagerly touch
// browser globals (indexedDB), so this must NOT run at module scope on the
// server. Built once, on first client use.
type WagmiConfig = ReturnType<typeof getDefaultConfig>;
let configSingleton: WagmiConfig | undefined;
function getConfig(): WagmiConfig {
  if (configSingleton) return configSingleton;

  if (HAS_VALID_WC_ID) {
    // Full wallet set, including WalletConnect (QR / mobile).
    configSingleton = getDefaultConfig({
      appName: "Proof of Rest",
      projectId: RAW_WC_ID!,
      chains: [MONAD_TESTNET],
      // Retry throttled reads with backoff — the public RPC caps at 15 req/sec
      // and a transient 429 shouldn't fail the whole request on first try.
      transports: { [MONAD_TESTNET.id]: http(undefined, { retryCount: 4, retryDelay: 400 }) },
      // Aggregate eth_call reads through Multicall3 to stay under the cap; the
      // 16ms wait lets bursts (the Leaderboard fans out ~48 reads) coalesce
      // into a single request instead of racing the limiter.
      batch: { multicall: { wait: 16 } },
      ssr: true,
    });
    return configSingleton;
  }

  // No valid WalletConnect id — build a config with only injected wallets so
  // the app is fully usable with a browser extension (MetaMask, etc.) and never
  // hits the WalletConnect Explorer API. connectorsForWallets still wants a
  // projectId argument; a dummy is safe here because none of these connectors
  // call WalletConnect.
  const connectors = connectorsForWallets(
    [
      {
        groupName: "Installed",
        wallets: [injectedWallet, metaMaskWallet, coinbaseWallet],
      },
    ],
    { appName: "Proof of Rest", projectId: "unused" },
  );

  configSingleton = createConfig({
    connectors,
    chains: [MONAD_TESTNET],
    // Retry throttled reads with backoff — the public RPC caps at 15 req/sec
    // and a transient 429 shouldn't fail the whole request on first try.
    transports: { [MONAD_TESTNET.id]: http(undefined, { retryCount: 4, retryDelay: 400 }) },
    // Aggregate eth_call reads through Multicall3 to stay under the cap; the
    // 16ms wait lets bursts (the Leaderboard fans out ~48 reads) coalesce
    // into a single request instead of racing the limiter.
    batch: { multicall: { wait: 16 } },
    ssr: true,
  }) as unknown as WagmiConfig;
  return configSingleton;
}

export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Render nothing until mounted on the client. Returning `null` (rather than
  // the children) ensures the app tree never renders outside WagmiProvider —
  // rendering children early made wagmi's store call Object.values on an
  // uninitialized state. The app is already client-only (page.tsx loads it via
  // dynamic ssr:false), so no SSR content is lost.
  if (!mounted) return null;

  return (
    <WagmiProvider config={getConfig()}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7CFC9B",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
          appInfo={{ appName: "Proof of Rest" }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
