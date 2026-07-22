"use client";

import { useEffect } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { MONAD_TESTNET } from "@/lib/contracts";

export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (isConnected && chainId !== MONAD_TESTNET.id) {
      // Prompt the user to switch to Monad Testnet.
      switchChain({ chainId: MONAD_TESTNET.id });
    }
  }, [isConnected, chainId, switchChain]);

  return null;
}
