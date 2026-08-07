# Proof of Rest

An **onchain commitment device for solo builders who overwork**, built on
**Monad Testnet** (chain ID 10143). Shipped for **Monad Playground** with **RestGuardian**, a safe onchain agent.

Lock a MON stake to start a work session. End the session within the time limit
and reclaim your stake (plus a slice of the community reward pool). Run past the
limit and a percentage is automatically forfeited into the pool. A cooldown
period after every session is **enforced by the contract itself** — no
notification, no snooze button.

- 🟢 **Tier 1** — Core stake / cooldown / penalty contract, deployed & verified, with a working frontend (start/end, live cooldown timer, stats).
- 🏅 **Tier 2** — Soulbound "Touched Grass" streak badges (ERC-721).
- 🤝 **Tier 3 (committed)** — Sponsor-a-session is live in the contract + UI, with reclaimable sponsorships.
- 🤖 **Playground add** — **RestGuardian**, an AI agent that turns plain English into verified, ready-to-sign transactions. It **builds and verifies unsigned transactions and never signs or sends them** (the [Moss](https://github.com/nishuzumi/moss) pattern). See below.

Also live: desktop notifications + tab-title countdown as the limit nears, a
watchdog panel to close others' overrun sessions for a reward, a recent-streak
leaderboard, and a `minStake` floor so watchdog rewards reliably beat gas.

## RestGuardian — a safe onchain agent (Moss pattern)

RestGuardian is a minimal, trustworthy onchain agent that makes on-chain actions
**safer and clearer**. Type what you want ("I'm done, end my session", "claim my
reward", "start a 25 minute session", "close a stale overrun session for the
watchdog reward", "what's in the pool and my streak?") and the agent mirrors Moss's
**discover → load → action → simulate** flow:

1. **discover / load** — reads your current on-chain state via `eth_call`.
2. **action** — builds the exact calldata / parameters for the intended action.
3. **simulate** — verifies the unsigned transaction with `simulateContract`
   (`eth_call` against live state) so it knows the outcome *before* signing.
4. **receipt** — shows a human-readable summary of the consequence
   ("You'll end your session and reclaim 0.05 MON, +0.01 MON pool bonus. Streak → 6.")
   plus a ✓/⚠ verification badge, and logs an **"explain, then do" audit trail**.

The agent **builds and verifies unsigned transactions and never signs or sends
them** — signing stays entirely in your wallet. That is the "clearer & safer" story
the Moss direction emphasizes.

**On Moss:** we adopt Moss as our *reference architecture* and borrow its vocabulary,
but we do **not** depend on the Moss package. Moss currently targets Monad **mainnet
(chain ID 143)** with a fixed set of protocol packages (WMON, ERC-20/721/1155, Kuru);
Proof of Rest is a **custom protocol on testnet (10143)**, so a real Moss package would
be extra scope. The safe-agent *pattern* is what matters, and that is what we ship.

**AI is optional.** With no API key the agent uses a deterministic keyword/regex
parser that runs entirely in the browser — the demo always works keyless. Set
`NEXT_PUBLIC_OPENAI_API_KEY` (see `frontend/.env.local.example`) to enable free-form
LLM phrasing; on any failure it falls back to the deterministic parser. The LLM only
classifies intent — **all transaction building, simulation, and signing stay in
deterministic code; the model never touches funds or calldata.**

## How it works

| Action | What happens |
| --- | --- |
| `startSession()` | Stake MON. Reverts if a session is active or you're still in cooldown. |
| `endSession()` (within limit) | Reclaim stake + a `successBonusBps` cut of the `rewardPool`. Streak +1. |
| `forceEndOverrunSession(user)` | Anyone may close an overrun session and earn the `watchdogBps` reward. |
| overrun (self or watchdog) | `penaltyBps` forfeited: 95% tops up `rewardPool`, 5% pays the closer. Streak resets. |

Forfeited MON feeds `rewardPool` **inside the contract** — no external beneficiary
needed. Successful sessions are paid back from the pool, which acts as an implicit
leaderboard: the more you respect your breaks, the more you collect.

## Contracts (Monad Testnet, chain ID 10143)

Deployed & **verified on Sourcify / MonadVision**:

- **ProofOfRest**: `0x01BEB2CB254A09f698E1E0Cbd8624B7d4f67586A`
  https://testnet.monadvision.com/address/0x01BEB2CB254A09f698E1E0Cbd8624B7d4f67586A
- **RestBadge** ("Touched Grass"): `0x0994E3D4E6cEEfE171f0d45aDd45B0f9F9C1DfED`
  https://testnet.monadvision.com/address/0x0994E3D4E6cEEfE171f0d45aDd45B0f9F9C1DfED

- `ProofOfRest.sol` — core engine
- `RestBadge.sol` — soulbound ERC-721 badges ("Touched Grass")
- ABIs + addresses live in `frontend/lib/contracts.ts`

## Local development

```bash
# 1. Contracts
cd contracts
foundryup            # monad fork
forge test           # all passing
forge build

# 2. Frontend
cd ../frontend
cp .env.local.example .env.local   # add deployed addresses + WalletConnect id
npm install
npm run dev
```

## Deploy & verify (Monad Testnet)

```bash
cd contracts

# import a deployer key (never put a raw key in .env)
cast wallet import monad-deployer --private-key <PK>
# fund it at https://faucet.monad.xyz/

forge create src/RestBadge.sol:RestBadge \
  --account monad-deployer --broadcast
forge create src/ProofOfRest.sol:ProofOfRest \
  --account monad-deployer --broadcast

# wire the two contracts to each other
cast send <PROOF_OF_REST> "setRestBadgeContract(address)" <BADGE> --account monad-deployer
cast send <BADGE> "setAuthorizedMinter(address)" <PROOF_OF_REST> --account monad-deployer

# verify (Sourcify)
forge verify-contract <PROOF_OF_REST> src/ProofOfRest.sol:ProofOfRest \
  --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
forge verify-contract <BADGE> src/RestBadge.sol:RestBadge \
  --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/

# paste the deployed addresses into frontend/.env.local
```

## Network

Core contract is **live on Monad Testnet (10143)** as the current demo surface,
with a clear **mainnet upgrade path**. Monad is EVM-equivalent, so the contracts
port to mainnet (143) with no code changes — a fresh `forge create` with a funded
key, updating `frontend/lib/contracts.ts` + RPC to the new addresses, and
re-verifying (~1-day task). Testnet is the honest, standard surface for a live
hackathon demo: free MON, no funds at risk.

## Known limitations

- History and the leaderboard/watchdog scan `getLogs` over a bounded recent
  window (Monad's RPC caps `eth_getLogs` at a 100-block range), so they surface
  *recent* activity rather than full history. A subgraph/indexer is the upgrade
  path. The watchdog panel also accepts a pasted address to check any session directly.
- RestGuardian's `start_session` duration is **advisory** — `maxSessionDuration` is
  a single contract-wide owner setting, so the agent states the real limit and flags
  any mismatch rather than pretending to set a per-session length.
