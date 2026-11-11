# Remove the Replica Lab stack (app replicas + page). The app's image, replica count and port are remembered in
# config\state\<app>.json, so the next start brings back the same setup.
# -KeepHelper: called by the helper itself when the app window closes (it exits on its own afterwards)
param([string]$Stack = "replicalab", [switch]$KeepHelper)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "state.ps1")
$r = Save-RunningApp $Stack
if ($r) { Write-Host "remembered $($r.name): $($r.image) x $($r.replicas), port $($r.hostPort)" }
docker stack rm $Stack

# the helper (builder\builder.mjs on 127.0.0.1:18091)
if (-not $KeepHelper) {
    Get-NetTCPConnection -LocalPort 18091 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
