# Shared by run-local.ps1: the network this PC is on (sites\<name>.json: DNS for the containers, image registry, base
# image of the Replica Lab page) and the secret key of the Replica Lab page.

# config\site.txt remembers the choice. First run picks it:
#   1. site.txt next to this file (the team package carries one)
#   2. a copy that already ran before 1.5 has no config\site.txt: it only worked in the hospital network -> rama
#   3. this PC uses the DNS servers of a site
#   4. default (the public internet)
# A PC that was "default" moves to a site once it uses that site's DNS servers.
function Get-Site([string]$Root = $PSScriptRoot) {
    $sitesDir = Join-Path $Root "sites"
    $file = Join-Path $Root "config\site.txt"
    $known = @(Get-ChildItem $sitesDir -Filter *.json | ForEach-Object { $_.BaseName })
    $name = ""
    if (Test-Path $file) { $name = "$(Get-Content $file -Raw)".Trim() }
    if ($known -notcontains $name) { $name = "" }
    if (-not $name -or $name -eq "default") {
        $pick = ""
        $shipped = Join-Path $Root "site.txt"
        if (Test-Path $shipped) { $pick = "$(Get-Content $shipped -Raw)".Trim() }
        if (-not $pick -and -not $name -and (Test-Path (Join-Path $Root "config\current-app.txt"))) { $pick = "rama" }
        if (-not $pick) { $pick = Find-SiteByDns $sitesDir }
        if ($known -contains $pick) { $name = $pick } elseif (-not $name) { $name = "default" }
        New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
        [IO.File]::WriteAllText($file, $name)
    }
    return Get-Content (Join-Path $sitesDir "$name.json") -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Find-SiteByDns([string]$SitesDir) {
    $mine = @()
    try { $mine = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object { $_.ServerAddresses }) } catch { }
    foreach ($f in Get-ChildItem $SitesDir -Filter *.json) {
        $s = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($d in @($s.dns)) { if ($d -and $mine -contains $d) { return $f.BaseName } }
    }
    return ""
}

# The page holds docker.sock, so its API answers only to a caller with this key. The page gets it from the helper,
# which listens on 127.0.0.1 only: other machines on the network cannot use the page.
function Get-PageKey([string]$Root = $PSScriptRoot) {
    $file = Join-Path $Root "config\page-key.txt"
    $key = ""
    if (Test-Path $file) { $key = "$(Get-Content $file -Raw)".Trim() }
    if ($key -notmatch '^[0-9a-f]{64}$') {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes); $rng.Dispose()
        $key = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
        New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
        [IO.File]::WriteAllText($file, $key)
    }
    return $key
}
