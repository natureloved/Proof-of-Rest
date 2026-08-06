# Proof of Rest — Monad Playground Submission

## One-line pitch

**Proof of Rest + RestGuardian: an onchain commitment device that makes solo
builders take real breaks — now with a safe onchain agent (built on the Moss
pattern) that turns plain English into verified, ready-to-sign transactions. The
agent builds and verifies unsigned transactions, shows you a human-readable
consequence, and never signs or sends — you review and sign in your own wallet.**

## The problem

Solo builders overwork. Timers get ignored, "just five more minutes" becomes two
hours, and there's no cost to blowing past a break. Proof of Rest makes the break a
**financial commitment enforced by the chain**: stake MON to start a work session,
reclaim it (plus a pool bonus) if you stop in time, forfeit a cut if you overrun —
and a cooldown you can't snooze is enforced by the contract itself.

## What's new for Playground: RestGuardian

The Spark build was the commitment device. For Playground we added **RestGuardian**,
a minimal, trustworthy **onchain agent** that ticks the "AI Agents & on-chain
operation tools" box and directly aligns with the recommended **Moss Onchain Agent**
direction.

RestGuardian mirrors Moss's **discover → load → action → simulate** flow:

| Step | What RestGuardian does |
| --- | --- |
| **discover / load** | Reads your live on-chain state (`sessions`, `streak`, `rewardPool`, penalties…) via `eth_call`. |
| **action** | Builds the exact calldata / value for the intended action. |
| **simulate** | Verifies the *unsigned* tx with `simulateContract` against live state — it knows if it will succeed or revert **before** your wallet sees it. |
| **receipt** | Shows a plain-English consequence + a ✓ VERIFIED / ⚠ WOULD REVERT badge, and records an "explain, then do" audit trail. |

**The safe-agent guarantee (the headline):** RestGuardian **builds and verifies
unsigned transactions and never signs or sends them.** Signing stays entirely in the
user's wallet. The "Review & Sign" button only appears when the simulation says the
action will succeed — the agent refuses to hand you a transaction that would fail.

Type things like:
- *"I'm done working, end my session"* → verified `endSession()`, receipt shows exactly what you reclaim + streak change.
- *"claim my reward"* → same `endSession()` path, framed as the bonus you collect.
- *"start a 25 minute session"* → verified `startSession()` with your stake; receipt states the real contract-wide limit and flags the mismatch honestly.
- *"close a stale overrun session for the watchdog reward"* → drafts `forceEndOverrunSession(user)` for a discovered/typed address and shows the reward you'd earn.
- *"what's in the reward pool and my streak?"* → read-only receipt, nothing to sign.

## Moss alignment (reference architecture, honest scope)

We **adopt Moss as our reference architecture** and borrow its vocabulary
("builds and verifies unsigned transactions; never signs or sends"), but we
**deliberately do not depend on the Moss package**:

- Moss currently targets Monad **mainnet (chain ID 143)** with a fixed set of
  protocol packages (WMON, ERC-20/721/1155, Kuru).
- Proof of Rest is a **custom protocol on testnet (10143)** — a real Moss package
  would need its own protocol package and mainnet deploy, i.e. extra scope and
  deadline risk.
- Judges score the safe-agent story and experience, not whether we imported a
  specific package. So we ship the *pattern*, faithfully, on the surface where our
  contract actually lives.

## Network statement

- **Core contract is live on Monad Testnet (10143)** as the current demo surface —
  the honest, standard choice for a live hackathon demo (free MON, no funds at risk).
- **Mainnet upgrade path is clear (~1 day).** Monad is EVM-equivalent: the contracts
  port to mainnet (143) with no code changes — a fresh `forge create` with a funded
  key, update `frontend/lib/contracts.ts` + RPC to the new addresses, re-verify.
- We'll confirm the network requirement right after registration (the Submission tab
  unlocks then); the core demo does not block on mainnet.

## Deployed & verified (Monad Testnet, 10143)

- **ProofOfRest**: `0x01BEB2CB254A09f698E1E0Cbd8624B7d4f67586A`
- **RestBadge** ("Touched Grass"): `0x0994E3D4E6cEEfE171f0d45aDd45B0f9F9C1DfED`

Both verified on Sourcify / MonadVision.

## Demo script (the review-then-sign moment)

1. Connect a Monad Testnet wallet. The RestGuardian panel sits front-and-center;
   its badge shows **AI: rules** (deterministic, keyless) or **AI: LLM** (key set).
2. Type *"start a 0.05 MON session"* → the receipt shows the stake, the limit, the
   penalty/bonus math, and a **✓ VERIFIED — WILL SUCCEED** badge. Click
   **Review & Sign** → the tx appears in your wallet. **This is the key moment: the
   agent built and verified everything, but the signature is yours.**
3. While active, type *"end my session"* → receipt shows the exact reclaim + streak
   bump, verified, sign.
4. Type *"end my session"* again with no active session → **⚠ WOULD REVERT: No
   active session** and **no sign button** — the agent won't hand you a failing tx.
5. Type *"what's in the pool and my streak?"* → a **READ-ONLY** receipt, nothing to
   sign.
6. Scroll the **Audit trail**: every request is logged as intent → source → action →
   simulation result → signed/not-signed.

## Tech

- **Contracts**: Solidity + Foundry, `ProofOfRest.sol` (stake/cooldown/penalty engine,
  watchdog, sponsor-a-session) + soulbound `RestBadge.sol`. Deployed & verified.
- **Frontend**: Next.js 15 + wagmi/viem + RainbowKit (WalletConnect with injected
  fallback). Agent logic in `frontend/lib/agent/` (`intents.ts` deterministic parser,
  `llm.ts` optional env-gated classifier, `plan.ts` the discover→simulate builder,
  `errors.ts` shared friendly-error map), UI in `components/RestGuardian.tsx`.
- **Safety**: the agent operates through the same signer as the rest of the app; it
  never holds or requests keys. The LLM (if enabled) only classifies intent — all
  calldata, simulation, and signing are deterministic.

## Known limitations

- History / leaderboard / watchdog discovery scan `getLogs` over a bounded window
  (Monad caps `eth_getLogs` at 100 blocks) — *recent* activity, not full history. A
  subgraph/indexer is the upgrade path; the watchdog also accepts a pasted address.
- `start_session` duration is advisory — `maxSessionDuration` is a single
  contract-wide owner setting, so the agent states the real limit and flags mismatch
  rather than faking a per-session length.

## Stretch (deferred, not blocking the demo)

- A reference-only `@themoss/protocol-*`-style package for ProofOfRest to show
  Moss-native extensibility — explicitly experimental, and noting Moss targets
  mainnet (143) while our contract runs on testnet (10143).
