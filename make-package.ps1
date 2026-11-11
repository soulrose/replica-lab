# Make a zip to give the team: everything except this machine's own state (config\), logs and the listed apps.
#   .\make-package.ps1                         -> ..\replica-lab-team.zip
#   .\make-package.ps1 -ExcludeApps tomcat-demo
param([string]$Out = (Join-Path (Split-Path $PSScriptRoot) "replica-lab-team.zip"), [string[]]$ExcludeApps = @())
$ExcludeApps = @($ExcludeApps | ForEach-Object { "$_" -split "," } | Where-Object { $_ })   # -File passes "a,b" as one string
$src = $PSScriptRoot
$tmp = Join-Path $env:TEMP "replica-lab-package"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory "$tmp\replica-lab" | Out-Null
Get-ChildItem $src -Force | Where-Object { $_.Name -notin @("config", ".git") } | ForEach-Object {
    Copy-Item $_.FullName "$tmp\replica-lab" -Recurse -Force
}
Get-ChildItem "$tmp\replica-lab\builder" -Filter *.log -ErrorAction SilentlyContinue | Remove-Item -Force
foreach ($a in $ExcludeApps) { Get-ChildItem "$tmp\replica-lab\apps" -Filter "$a.*" | Remove-Item -Force }
if (Test-Path $Out) { Remove-Item -Force $Out }
Compress-Archive -Path "$tmp\replica-lab" -DestinationPath $Out
Remove-Item -Recurse -Force $tmp
Write-Host "package: $Out ($([math]::Round((Get-Item $Out).Length / 1KB)) KB)"
