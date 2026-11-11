# Started by the helper right after an update was copied in: wait for the old helper to exit, start the new one,
# then redeploy the page of the current app (rebuilds the Replica Lab page image with the new code).
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
for ($i = 0; $i -lt 30; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort 18091 -State Listen -ErrorAction SilentlyContinue)) { break }
    Start-Sleep 1
}
& cmd /c "$PSScriptRoot\helper.cmd"
& (Join-Path $PSScriptRoot "run-local.ps1") *>> (Join-Path $PSScriptRoot "builder\update.log")
