import porAbi from "./ProofOfRest.abi.json";
import badgeAbi from "./RestBadge.abi.json";
import type { Abi } from "viem";

export const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "MonadVision",
      url: "https://testnet.monadvision.com",
    },
  },
  testnet: true,
} as const;

// Deployed addresses — override via .env.local (NEXT_PUBLIC_PROOF_OF_REST_ADDRESS,
// NEXT_PUBLIC_REST_BADGE_ADDRESS). Fallback placeholders are replaced at deploy time.
export const PROOF_OF_REST_ADDRESS = (process.env.NEXT_PUBLIC_PROOF_OF_REST_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const REST_BADGE_ADDRESS = (process.env.NEXT_PUBLIC_REST_BADGE_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const PROOF_OF_REST_ABI = porAbi as Abi;
export const REST_BADGE_ABI = badgeAbi as Abi;

export const CONTRACT_URLS = {
  proofOfRest: `${MONAD_TESTNET.blockExplorers.default.url}/address/${PROOF_OF_REST_ADDRESS}`,
  restBadge: `${MONAD_TESTNET.blockExplorers.default.url}/address/${REST_BADGE_ADDRESS}`,
};
