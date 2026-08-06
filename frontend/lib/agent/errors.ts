// Shared mapping from raw revert/error strings to friendly, human-readable
// messages. Extracted from SessionCard so both the manual UI and the RestGuardian
// agent surface identical, plain-language explanations for the same custom errors.
//
// The contract reverts with named custom errors (see ProofOfRest.sol); viem/wagmi
// surface those names inside the thrown error's message string, so a substring
// match is the pragmatic, version-stable way to recognise them.

type ErrorRule = { match: string; message: string };

// Ordered most-specific first. `friendlyError` returns the first match.
const ERROR_RULES: readonly ErrorRule[] = [
  { match: "CooldownActive", message: "Cooldown active — wait for it to clear." },
  { match: "SessionAlreadyActive", message: "A session is already active." },
  { match: "MinStakeNotMet", message: "Stake is below the minimum." },
  { match: "ZeroStake", message: "Stake must be greater than zero." },
  { match: "SessionStillWithinLimit", message: "That session hasn't overrun yet — nothing to close." },
  { match: "SessionNotActive", message: "No active session." },
  { match: "NoSponsoredStake", message: "No sponsored stake available." },
  { match: "ZeroSponsorAmount", message: "Sponsor amount must be greater than zero." },
  { match: "SponsorshipLocked", message: "Sponsorship is still locked — reclaim isn't available yet." },
  { match: "User rejected", message: "Transaction rejected." },
  { match: "User denied", message: "Transaction rejected." },
  { match: "insufficient funds", message: "Insufficient MON for stake + gas." },
];

/**
 * Turn a raw error message into a short, user-facing explanation. Falls back to
 * a trimmed slice of the original so nothing is ever swallowed silently.
 */
export function friendlyError(raw: string): string {
  for (const rule of ERROR_RULES) {
    if (raw.includes(rule.match)) return rule.message;
  }
  return raw.slice(0, 140);
}
