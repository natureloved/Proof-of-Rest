# Deploy Proof of Rest to Monad Testnet and wire the two contracts together.
# Requires: `monad-deployer` cast keystore imported + funded from the faucet.
#
# Usage (powershell):
#   $env:CAST_UNSAFE_PASSWORD = "<keystore password>"
#   .\deploy.ps1
param()

$ErrorActionPreference = "Stop"
$env:PATH += ";$env:USERPROFILE\.foundry\versions\v1.7.1-monad-v1.0.0"
$account = "monad-deployer"
$rpc = "https://testnet-rpc.monad.xyz"

function Deploy([string]$contract, [string]$name) {
    Write-Host "==> Deploying $name ..."
    $out = forge create $contract `
        --account $account --broadcast --rpc-url $rpc 2>&1
    $out | Out-String | Write-Host
    # parse "Deployed to: 0x...."
    $m = [regex]::Match(($out -join "`n"), "Deployed to:\s*(0x[0-9a-fA-F]{40})")
    if (-not $m.Success) { throw "Could not parse deployed address for $name" }
    return $m.Groups[1].Value
}

$badge = Deploy "src/RestBadge.sol:RestBadge" "RestBadge"
$por   = Deploy "src/ProofOfRest.sol:ProofOfRest" "ProofOfRest"

Write-Host "==> Wiring contracts ..."
cast send $por "setRestBadgeContract(address)" $badge --account $account --rpc-url $rpc | Out-Null
cast send $badge "setAuthorizedMinter(address)" $por --account $account --rpc-url $rpc | Out-Null

Write-Host ""
Write-Host "PROOF_OF_REST_ADDRESS=$por"
Write-Host "REST_BADGE_ADDRESS=$badge"
