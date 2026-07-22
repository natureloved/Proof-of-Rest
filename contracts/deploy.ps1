# Deploy Proof of Rest to Monad Testnet and wire the two contracts together.
#
# Two ways to authenticate the deployer:
#
#   A) Keystore (recommended for keys you reuse):
#        $env:CAST_UNSAFE_PASSWORD = "<keystore password>"
#        .\deploy.ps1 -Account monad-deployer
#
#   B) Raw private key (simplest for a throwaway testnet key):
#        .\deploy.ps1 -PrivateKey 0xabc123...
#      or, to keep it out of shell history, set it in the environment first:
#        $env:DEPLOYER_PK = "0xabc123..."
#        .\deploy.ps1
#
# The deployer must be funded from https://faucet.monad.xyz first.
param(
    [string]$Account = "monad-deployer",
    [string]$PrivateKey = ""
)

$ErrorActionPreference = "Stop"

# Put foundry on PATH. Prefer the monad-specific toolchain if present, else the
# default install location.
$monadVer = "$env:USERPROFILE\.foundry\versions\v1.7.1-monad-v1.0.0"
if (Test-Path $monadVer) { $env:PATH += ";$monadVer" }
$env:PATH += ";$env:USERPROFILE\.foundry\bin"

$rpc = "https://testnet-rpc.monad.xyz"

# Fall back to $env:DEPLOYER_PK if -PrivateKey wasn't passed.
if (-not $PrivateKey -and $env:DEPLOYER_PK) { $PrivateKey = $env:DEPLOYER_PK }

# Build the auth flags used by both forge create and cast send.
if ($PrivateKey) {
    if ($PrivateKey -notmatch '^0x[0-9a-fA-F]{64}$') {
        throw "PrivateKey must be a 0x-prefixed 32-byte hex string."
    }
    $authArgs = @("--private-key", $PrivateKey)
    Write-Host "==> Authenticating with a raw private key" -ForegroundColor Yellow
} else {
    $authArgs = @("--account", $Account)
    Write-Host "==> Authenticating with keystore account '$Account'"
    if (-not $env:CAST_UNSAFE_PASSWORD) {
        Write-Host "    (set `$env:CAST_UNSAFE_PASSWORD to avoid the password prompt)" -ForegroundColor DarkGray
    }
}

function Deploy([string]$contract, [string]$name) {
    Write-Host "==> Deploying $name ..."
    $out = forge create $contract @authArgs --broadcast --rpc-url $rpc 2>&1
    $out | Out-String | Write-Host
    $m = [regex]::Match(($out -join "`n"), "Deployed to:\s*(0x[0-9a-fA-F]{40})")
    if (-not $m.Success) { throw "Could not parse deployed address for $name" }
    return $m.Groups[1].Value
}

$badge = Deploy "src/RestBadge.sol:RestBadge" "RestBadge"
$por   = Deploy "src/ProofOfRest.sol:ProofOfRest" "ProofOfRest"

Write-Host "==> Wiring contracts ..."
cast send $por "setRestBadgeContract(address)" $badge @authArgs --rpc-url $rpc | Out-Null
cast send $badge "setAuthorizedMinter(address)" $por @authArgs --rpc-url $rpc | Out-Null

Write-Host ""
Write-Host "Deployed & wired. Paste these into frontend/.env.local:" -ForegroundColor Green
Write-Host "NEXT_PUBLIC_PROOF_OF_REST_ADDRESS=$por"
Write-Host "NEXT_PUBLIC_REST_BADGE_ADDRESS=$badge"
