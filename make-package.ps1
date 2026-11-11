# Make the files to hand out, next to this folder (..\):
#   team (this PC's app profiles + secrets, for the team only; never on GitHub):
#     replica-lab-team.zip, ReplicaLab-Setup-<ver>-team.exe
#   bare (the program only, no app, no token; fine to publish, users add their own apps):
#     replica-lab-<ver>.zip, ReplicaLab-Setup-<ver>.exe
#   ReplicaLab-Uninstall.exe (removes a copy a Setup installed)
#   .\make-package.ps1 -ExcludeApps tomcat-demo     # leave some apps out of the team package
param([string]$OutDir = (Split-Path $PSScriptRoot), [string[]]$ExcludeApps = @())
$ExcludeApps = @($ExcludeApps | ForEach-Object { "$_" -split "," } | Where-Object { $_ })   # -File passes "a,b" as one string
$src = $PSScriptRoot
$ver = (Get-Content (Join-Path $src "VERSION") -Raw).Trim()
$kb = { param($f) "$([math]::Round((Get-Item $f).Length / 1KB)) KB" }

function New-Package([string]$zip, [bool]$withApps) {
    $tmp = Join-Path $env:TEMP "replica-lab-package"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory "$tmp\replica-lab" | Out-Null
    # never: this machine's state, git, maintainer notes
    Get-ChildItem $src -Force | Where-Object { $_.Name -notin @("config", ".git", "docs") } | ForEach-Object {
        Copy-Item $_.FullName "$tmp\replica-lab" -Recurse -Force
    }
    Get-ChildItem "$tmp\replica-lab\builder" -Filter *.log -ErrorAction SilentlyContinue | Remove-Item -Force
    $apps = "$tmp\replica-lab\apps"
    New-Item -ItemType Directory -Force $apps | Out-Null
    if ($withApps) { foreach ($a in $ExcludeApps) { Get-ChildItem $apps -Filter "$a.*" | Remove-Item -Force } }
    else { Get-ChildItem $apps -Force | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force }
    if (-not (Test-Path "$apps\.gitkeep")) { New-Item -ItemType File "$apps\.gitkeep" | Out-Null }   # keep the empty folder in the zip
    if (Test-Path $zip) { Remove-Item -Force $zip }
    Compress-Archive -Path "$tmp\replica-lab" -DestinationPath $zip
    Remove-Item -Recurse -Force $tmp
    if (-not $withApps) {
        # a bare package must not carry anything of this PC
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        # PowerShell 5.1 writes the entry names with backslashes
        $bad = @($z.Entries | Where-Object { $_.FullName -match '(^|[\\/])apps[\\/].+' -and $_.Name -ne ".gitkeep" -or $_.FullName -match '\.local\.env$|(^|[\\/])config[\\/]' })
        $z.Dispose()
        if ($bad) { Remove-Item -Force $zip; throw "bare package has app files: $($bad.FullName -join ', ')" }
    }
}

function New-Setup([string]$zip, [string]$exe) {
    & cmd /c "`"$src\launcher\build-setup.cmd`" `"$zip`" `"$exe`""
    if ($LASTEXITCODE -eq 0 -and (Test-Path $exe)) { Write-Host "  setup:  $exe ($(& $kb $exe))" }
    else { Write-Host "  setup exe was not built (see the compiler output above)" -ForegroundColor Yellow }
}

Write-Host "team (app profiles + secrets, do not publish):"
$teamZip = Join-Path $OutDir "replica-lab-team.zip"
New-Package $teamZip $true
Write-Host "  zip:    $teamZip ($(& $kb $teamZip))"
New-Setup $teamZip (Join-Path $OutDir "ReplicaLab-Setup-$ver-team.exe")

Write-Host "bare (program only, users add their own apps):"
$bareZip = Join-Path $OutDir "replica-lab-$ver.zip"
New-Package $bareZip $false
Write-Host "  zip:    $bareZip ($(& $kb $bareZip))"
New-Setup $bareZip (Join-Path $OutDir "ReplicaLab-Setup-$ver.exe")

$uninst = Join-Path $OutDir "ReplicaLab-Uninstall.exe"
& cmd /c "`"$src\launcher\build-uninstall.cmd`" `"$uninst`""
if ($LASTEXITCODE -eq 0 -and (Test-Path $uninst)) { Write-Host "uninstall: $uninst ($(& $kb $uninst))" }
else { Write-Host "uninstall exe was not built (see the compiler output above)" -ForegroundColor Yellow }
