# Started by the helper right after an update was copied in: wait for the old helper to exit, start the new one,
# then redeploy the page of the current app (rebuilds the Replica Lab page image with the new code).
# Progress goes line by line to builder\update.log (UTF-8, this run only): the new helper serves it on /update/status
# and the page turns the "== step" lines into its progress bar.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot "builder\update.log"
function Say([string]$m) { Add-Content -Path $log -Value $m -Encoding UTF8 }
Set-Content -Path $log -Value "== restarting helper" -Encoding UTF8
for ($i = 0; $i -lt 30; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort 18091 -State Listen -ErrorAction SilentlyContinue)) { break }
    Start-Sleep 1
}
& cmd /c "$PSScriptRoot\helper.cmd"
# 1.1.2+: the icon lives on the Desktop only; an older version also put one in the Start menu
$oldIcon = Join-Path ([Environment]::GetFolderPath("Programs")) "Replica Lab.lnk"
if (Test-Path $oldIcon) { Remove-Item $oldIcon -Force -ErrorAction SilentlyContinue }
Say "== helper started, redeploying the page"
try {
    & (Join-Path $PSScriptRoot "run-local.ps1") *>&1 | ForEach-Object { Say "$_" }
    if ($LASTEXITCODE -ne 0) { Say "== restart failed (exit $LASTEXITCODE): see the lines above" }
    else { Say "== restart done" }
} catch {
    Say "== restart failed: $($_.Exception.Message)"
}
