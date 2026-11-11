# Replica Lab updater. Updates are git tags vMAJOR.MINOR.PATCH on the GitHub repo in update.json.
#   .\update.ps1 -Check            -> JSON: current, latest, newer, notes (the CHANGELOG section of that version)
#   .\update.ps1 -Apply v1.1.0     -> download that tag, copy it over this folder
# Never touches config\ (this machine) or apps\*.local.env (secrets); in apps\ only files that do not exist yet are added,
# so app profiles the team edited stay as they are. PowerShell (not Node) does the HTTP so the Windows proxy settings apply.
param([switch]$Check, [string]$Apply = "")
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$proxy = [Net.WebRequest]::GetSystemWebProxy(); $proxy.Credentials = [Net.CredentialCache]::DefaultCredentials
[Net.WebRequest]::DefaultWebProxy = $proxy
$root = $PSScriptRoot
$repo = (Get-Content (Join-Path $root "update.json") -Raw | ConvertFrom-Json).repo
$headers = @{ "User-Agent" = "replica-lab-updater"; "Accept" = "application/vnd.github+json" }
$tokenFile = Join-Path $root "config\github-token.txt"
if (Test-Path $tokenFile) { $t = (Get-Content $tokenFile -Raw).Trim(); if ($t) { $headers["Authorization"] = "Bearer $t" } }
$current = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()

function Get-Api([string]$path) { Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/$path" -Headers $headers -UseBasicParsing }
function Get-Ver([string]$v) { $m = [regex]::Match($v, '^v?(\d+)\.(\d+)\.(\d+)$'); if ($m.Success) { [version]"$($m.Groups[1]).$($m.Groups[2]).$($m.Groups[3])" } else { $null } }
function Out-Json($o) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $o | ConvertTo-Json -Depth 4 -Compress }

if ($Check) {
    try {
        # PowerShell 5.1 hands a JSON array from Invoke-RestMethod down the pipe as ONE item; store it first so it is enumerated
        $all = Get-Api "tags?per_page=100"
        $tags = @($all | ForEach-Object { $_ } | Where-Object { Get-Ver ([string]$_.name) })
        if (-not $tags) { Out-Json @{ current = $current; latest = $null; newer = $false; error = "ยังไม่มี tag เวอร์ชันใน repo" }; exit 0 }
        $latest = ($tags | Sort-Object { Get-Ver $_.name } -Descending | Select-Object -First 1).name
        $newer = (Get-Ver $latest) -gt (Get-Ver $current)
        $notes = ""
        if ($newer) {
            try {
                $c = Get-Api "contents/CHANGELOG.md?ref=$latest"
                $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($c.content -replace '\s', '')))
                $v = $latest.TrimStart("v")
                $m = [regex]::Match($text, "(?ms)^## $([regex]::Escape($v))\b.*?(?=^## |\z)")
                $notes = if ($m.Success) { $m.Value.Trim() } else { "" }
            } catch { }
        }
        Out-Json @{ current = $current; latest = $latest.TrimStart("v"); tag = $latest; newer = $newer; notes = $notes }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        $msg = if ($code -eq 404 -or $code -eq 401) { "เข้า repo บน GitHub ไม่ได้ (ถ้าเป็น repo ส่วนตัว ใส่ GitHub token ที่หน้า About)" } else { "เช็คอัปเดตไม่ได้: $($_.Exception.Message)" }
        Out-Json @{ current = $current; latest = $null; newer = $false; error = $msg }
    }
    exit 0
}

if ($Apply) {
    if (-not (Get-Ver $Apply)) { throw "bad version tag: $Apply" }
    $tag = if ($Apply.StartsWith("v")) { $Apply } else { "v$Apply" }
    $tmp = Join-Path $env:TEMP "replica-lab-update"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory $tmp | Out-Null
    $zip = Join-Path $tmp "update.zip"
    Write-Host "downloading $tag"
    Invoke-WebRequest -Uri "https://api.github.com/repos/$repo/zipball/$tag" -Headers $headers -OutFile $zip -UseBasicParsing
    Write-Host "unpacking"
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "x")
    $top = Get-ChildItem (Join-Path $tmp "x") -Directory | Select-Object -First 1
    if (-not $top -or -not (Test-Path (Join-Path $top.FullName "VERSION"))) { throw "the download does not look like Replica Lab" }
    $copied = 0; $kept = 0
    Get-ChildItem $top.FullName -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($top.FullName.Length + 1)
        if ($rel -like "config\*" -or $rel -like "*.local.env") { return }
        $dest = Join-Path $root $rel
        if ($rel -like "apps\*" -and (Test-Path $dest)) { $kept++; return }     # keep the team's own app profiles
        New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
        Copy-Item $_.FullName $dest -Force
        $copied++
    }
    Remove-Item -Recurse -Force $tmp
    Write-Host "updated to ${tag}: $copied files copied, $kept app files kept"
    exit 0
}
Write-Host "use -Check or -Apply <tag>"
