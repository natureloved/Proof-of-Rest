# Proof of Rest

An **onchain commitment device for solo builders who overwork**, built for
**BuildAnything: Spark** on **Monad Testnet**.

Lock a MON stake to start a work session. End the session within the time limit
and reclaim your stake (plus a slice of the community reward pool). Run past the
limit and a percentage is automatically forfeited into the pool. A cooldown
period after every session is **enforced by the contract itself** — no
notification, no snooze button.

- 🟢 **Tier 1** — Core stake / cooldown / penalty contract, deployed & verified, with a working frontend (start/end, live cooldown timer, stats).
- 🏅 **Tier 2** — Soulbound "Touched Grass" streak badges (ERC-721).
- 🤝 **Tier 3 (committed)** — Sponsor-a-session is live in the contract + UI, with reclaimable sponsorships.

Also live: desktop notifications + tab-title countdown as the limit nears, a
watchdog panel to close others' overrun sessions for a reward, a recent-streak
leaderboard, and a `minStake` floor so watchdog rewards reliably beat gas.

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
forge test           # 12 tests, all passing
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

## Known limitations

- History and the leaderboard/watchdog scan `getLogs` over a bounded recent
  window (Monad's RPC caps `eth_getLogs` at a 100-block range), so they surface
  *recent* activity rather than full history. A subgraph/indexer is the upgrade
  path. The watchdog panel also accepts a pasted address to check any session directly.
