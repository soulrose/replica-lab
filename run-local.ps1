# Run one app on Docker Swarm on this PC (several replicas) + the Replica Lab page.
#   .\run-local.ps1                      # the app used last time (config\current-app.txt), else ramaservice
#   .\run-local.ps1 -App patientprofile  # switch app: the running one is stopped and remembered
#   .\run-local.ps1 -Replicas 3 -Image <image> -Port 18081
# Apps are described in apps\<name>.json (+ apps\<name>.env); the page can add apps from local images.
param(
    [string]$App = "",
    [int]$Replicas = -1,
    [string]$Image = "",
    [int]$Port = 0,           # port to call the app on from this PC (default: the app's profile / last used)
    [string]$Stack = "replicalab",
    [int]$ScalerPort = 18090,
    [int]$Max = 5,
    [switch]$TuneRam          # measure the app's RAM again before deploying (also done when the profile says memoryMb 0 = auto)
)
# Continue, not Stop: PowerShell 5.1 turns any docker stderr line into a fatal error; every docker call checks $LASTEXITCODE instead
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot "state.ps1")
function Step($m) { Write-Host "== $m" -ForegroundColor Cyan }

# 1. Docker: installed? -> running? Not installed = open the download page; installed but stopped = start Docker Desktop and wait.
Step "Docker"
$dockerDownload = "https://www.docker.com/products/docker-desktop/"
$desktopExe = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
$hasCli = [bool](Get-Command docker -ErrorAction SilentlyContinue)
if (-not $desktopExe -and -not $hasCli) {
    Write-Host "Docker Desktop is not installed on this PC. Opening the download page: $dockerDownload" -ForegroundColor Yellow
    Write-Host "Install it, start it once, then open Replica Lab again."
    Start-Process $dockerDownload
    exit 1
}
docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) {
    if (-not $desktopExe) { throw "Docker is not running and Docker Desktop was not found. Start Docker and run this again." }
    Write-Host "   Docker Desktop is not running, starting it (first start can take 1-3 minutes)"
    Start-Process $desktopExe
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {      # up to ~3 minutes
        Start-Sleep 2
        docker info --format "{{.ServerVersion}}" *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        if ($i % 5 -eq 4) { Write-Host "   waiting for Docker ... $([int](($i + 1) * 2)) s" }
    }
    if (-not $ready) { throw "Docker Desktop did not come up in 3 minutes. Check the Docker Desktop window, then run this again." }
    Write-Host "   Docker is ready"
}
$swarm = docker info --format "{{.Swarm.LocalNodeState}}"
if ($swarm -ne "active") {
    Step "docker swarm init (single node)"
    docker swarm init | Out-Null
}

# 2. Which app, and its profile
$running = Get-RunningApp $Stack
$currentFile = Join-Path $PSScriptRoot "config\current-app.txt"
$appsDir = Join-Path $PSScriptRoot "apps"
New-Item -ItemType Directory -Force $appsDir | Out-Null
$profiles = @(Get-ChildItem $appsDir -Filter *.json | Where-Object { $_.Name -notlike "*.tests.json" } | ForEach-Object { $_.BaseName })
if (-not $App) {
    if ($running -and $running.name) { $App = $running.name }
    elseif (Test-Path $currentFile) { $App = (Get-Content $currentFile -Raw).Trim() }
    if ($App -and $profiles -notcontains $App) { $App = "" }          # the last app was deleted
    if (-not $App -and $profiles) { $App = $profiles[0] }
}
if (-not $App) {
    # a fresh copy has no app yet: bring up only the Replica Lab page, where the team adds its first app
    # (from a local image or a project folder). The page shows an empty state until then.
    Step "no app yet: Replica Lab page only"
    $ver = if (Test-Path (Join-Path $PSScriptRoot "VERSION")) { (Get-Content (Join-Path $PSScriptRoot "VERSION") -Raw).Trim() } else { "dev" }
    if ($running -and $running.name) { Save-RunningApp $Stack | Out-Null }
    docker build -q -t replica-lab-scaler:local .\scaler | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
    $scalerId = (docker image inspect replica-lab-scaler:local --format "{{.Id}}").Split(":")[1].Substring(0, 12)
    docker tag replica-lab-scaler:local "replica-lab-scaler:$scalerId"
    $yml = @"
# written by run-local.ps1: no app profile in apps\ yet, so only the Replica Lab page
version: "3.8"
services:
  scaler:
    image: replica-lab-scaler:$scalerId
    environment:
      TARGET_SERVICE: "${Stack}_app"
      APP_NONE: "true"
      RL_VERSION: "$ver"
      SCALER_MAX: "$Max"
    ports:
      - { target: 8090, published: $ScalerPort, protocol: tcp, mode: ingress }
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks: [net]
    deploy:
      replicas: 1
      placement: { constraints: [node.role == manager] }
      resources: { limits: { cpus: "0.5", memory: 128M } }
networks:
  net: { driver: overlay, attachable: true }
"@
    $ymlFile = Join-Path $PSScriptRoot "config\stack-empty.yml"
    New-Item -ItemType Directory -Force (Split-Path $ymlFile) | Out-Null
    [IO.File]::WriteAllText($ymlFile, $yml)
    for ($try = 1; $try -le 10; $try++) {
        docker stack deploy -c $ymlFile --resolve-image never --prune $Stack
        if ($LASTEXITCODE -eq 0) { break }
        if ($try -eq 10) { throw "stack deploy failed" }
        Write-Host "   previous stack still shutting down, retry in 3 s ($try/10)"
        Start-Sleep 3
    }
    Write-Host ""
    Write-Host "Replica Lab http://localhost:$ScalerPort   (no app yet: add one on the page)" -ForegroundColor Green
    exit 0
}
$profileFile = Join-Path $PSScriptRoot "apps\$App.json"
if (-not (Test-Path $profileFile)) { throw "no app profile apps\$App.json" }
$p = Get-Content $profileFile -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = if (Test-Path (Join-Path $PSScriptRoot "VERSION")) { (Get-Content (Join-Path $PSScriptRoot "VERSION") -Raw).Trim() } else { "dev" }

# An app with "attach": a swarm service that already runs on this PC (made by hand or by another stack).
# Nothing is created or copied: the stack holds only the Replica Lab page, which joins the service's network
# and scales / restarts that service in place. Closing Replica Lab leaves the service running as it is.
if ("$($p.attach)") {
    $svc = "$($p.attach)"
    Step "attach to swarm service $svc"
    $json = docker service inspect $svc --format "{{json .Spec}}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw "swarm service $svc is not on this PC any more: start it again, or delete the app $App" }
    $spec = ($json -join "") | ConvertFrom-Json
    if (-not $spec.Mode.Replicated) { throw "$svc runs in global mode (one per node): its replicas cannot be set" }
    if ($running -and $running.name) {
        Write-Host "   stopping $($running.name) (remembered for next time)"
        Save-RunningApp $Stack | Out-Null
    }
    [IO.File]::WriteAllText($currentFile, $App)
    # the page reaches each replica over a network it shares with the service
    $names = @()
    foreach ($n in @($spec.TaskTemplate.Networks | ForEach-Object { $_.Target } | Where-Object { $_ })) {
        $nm = docker network inspect $n --format "{{.Name}}" 2>$null
        if ($LASTEXITCODE -eq 0 -and $nm -and "$nm" -ne "ingress") { $names += "$nm" }
    }
    if (-not $names) {
        $link = "replicalab_link"
        docker network inspect $link *> $null
        if ($LASTEXITCODE -ne 0) { docker network create -d overlay --attachable $link | Out-Null }
        Write-Host "   $svc has no network of its own: adding $link to it (its replicas restart once)"
        docker service update --detach --network-add $link $svc | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "cannot add network $link to $svc" }
        $names = @($link)
    }
    Step "Replica Lab page image"
    docker build -q -t replica-lab-scaler:local .\scaler | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
    $scalerId = (docker image inspect replica-lab-scaler:local --format "{{.Id}}").Split(":")[1].Substring(0, 12)
    docker tag replica-lab-scaler:local "replica-lab-scaler:$scalerId"
    $health = "$($p.health)"; if (-not $health.StartsWith("/")) { $health = "/$health" }
    $maxR = [Math]::Max($Max, [int]$spec.Mode.Replicated.Replicas)
    $netRefs = ($names | ForEach-Object -Begin { $i = 0 } -Process { "n$i"; $i++ }) -join ", "
    $netDefs = ($names | ForEach-Object -Begin { $i = 0 } -Process { "  n${i}: { external: true, name: `"$_`" }"; $i++ }) -join "`n"
    $yml = @"
# written by run-local.ps1 for the attached app $App (swarm service $svc): only the Replica Lab page
version: "3.8"
services:
  scaler:
    image: replica-lab-scaler:$scalerId
    environment:
      TARGET_SERVICE: "$svc"
      TARGET_PORT: "$([int]$p.port)"
      APP_NAME: "$App"
      APP_KIND: "$($p.kind)"
      APP_HEALTH: "$health"
      APP_TEST: "$($p.test)"
      APP_BUILD_LOCAL: "false"
      APP_MEMORY: "0"
      APP_ATTACHED: "true"
      RL_VERSION: "$ver"
      SCALER_MAX: "$maxR"
    ports:
      - { target: 8090, published: $ScalerPort, protocol: tcp, mode: ingress }
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks: [$netRefs]
    deploy:
      replicas: 1
      placement: { constraints: [node.role == manager] }
      resources: { limits: { cpus: "0.5", memory: 128M } }
      labels: { rama.lab.app: "$App", rama.lab.attach: "$svc" }
networks:
$netDefs
"@
    $ymlFile = Join-Path $PSScriptRoot "config\stack-attach.yml"
    [IO.File]::WriteAllText($ymlFile, $yml)
    Step "docker stack deploy $Stack (page only, controls $svc on network $($names -join ', '))"
    for ($try = 1; $try -le 10; $try++) {
        docker stack deploy -c $ymlFile --resolve-image never --prune $Stack     # --prune: our own app service goes
        if ($LASTEXITCODE -eq 0) { break }
        if ($try -eq 10) { throw "stack deploy failed" }
        Write-Host "   previous stack still shutting down, retry in 3 s ($try/10)"
        Start-Sleep 3
    }
    Write-Host ""
    Write-Host "Replica Lab http://localhost:$ScalerPort   (controls swarm service $svc)" -ForegroundColor Green
    exit 0
}
$envRel = "apps/$App.env"
if (-not (Test-Path (Join-Path $PSScriptRoot $envRel))) { [IO.File]::WriteAllText((Join-Path $PSScriptRoot $envRel), "# environment for $App (KEY=value per line)`n") }
# this machine only (tokens / passwords): not in git, never overwritten by an update
$localRel = "apps/$App.local.env"
if (-not (Test-Path (Join-Path $PSScriptRoot $localRel))) { [IO.File]::WriteAllText((Join-Path $PSScriptRoot $localRel), "# secrets for $App on this machine only (KEY=value per line, not in git)`n") }
if ((Get-Content (Join-Path $PSScriptRoot $envRel) -Raw) -match "SPRING_CLOUD_VAULT_URI" -and
    -not ((Get-Content (Join-Path $PSScriptRoot $localRel) -Raw) -match "SPRING_CLOUD_VAULT_TOKEN=\S")) {
    Write-Host "   warning: no SPRING_CLOUD_VAULT_TOKEN in $localRel - the app cannot read vault (ask the team for the token)" -ForegroundColor Yellow
}
Step "app $App ($($p.kind))"

# another app runs now: remember it before it is replaced (one app at a time)
if ($running -and $running.name -and $running.name -ne $App) {
    Write-Host "   stopping $($running.name) (remembered for next time)"
    Save-RunningApp $Stack | Out-Null
}

# 3. Image / replicas / host port: given -> saved; else the running one (same app), the saved one, the profile
$saved = Read-AppState $App
$same = $running -and $running.name -eq $App
if (-not $Image)   { $Image = if ($same) { $running.image } elseif ($saved) { $saved.image } else { $p.image } }
if ($Replicas -lt 0) { $Replicas = if ($same) { $running.replicas } elseif ($saved) { $saved.replicas } else { 2 } }
if ($Port -le 0)   { $Port = if ($same -and $running.hostPort) { $running.hostPort } elseif ($saved -and $saved.hostPort) { $saved.hostPort } else { $p.hostPort } }
if ($Port -lt 1024 -or $Port -gt 65535 -or $Port -eq $ScalerPort) { throw "port must be 1024-65535 and not $ScalerPort" }
Write-AppState $App $Image $Replicas $Port
[IO.File]::WriteAllText($currentFile, $App)

# Docker Desktop keeps routing the old published port when a running service is updated to a new one, so a
# different app or a different host port means: remove the app service first, deploy then creates it fresh.
if ($running -and (($running.name -ne $App) -or ([int]$running.hostPort -ne [int]$Port))) {
    Write-Host "   recreating the app service (new app or new port)"
    docker service rm "${Stack}_app" | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        docker service inspect "${Stack}_app" *> $null
        if ($LASTEXITCODE -ne 0) { break }
        Start-Sleep 1
    }
    Start-Sleep 3     # let the old published port go
}

Step "image $Image"
docker image inspect $Image *> $null
if ($LASTEXITCODE -ne 0) { docker pull $Image; if ($LASTEXITCODE -ne 0) { throw "cannot pull $Image" } }

Step "Replica Lab page image"
docker build -q -t replica-lab-scaler:local .\scaler | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
# unique tag per build, so 'stack deploy' restarts the page when its code changed
$scalerId = (docker image inspect replica-lab-scaler:local --format "{{.Id}}").Split(":")[1].Substring(0, 12)
docker tag replica-lab-scaler:local "replica-lab-scaler:$scalerId"

# 4. Deploy
$health = "$($p.health)"
if (-not $health.StartsWith("/")) { $health = "/$health" }
$url = "http://localhost:$($p.port)$health"
$healthCmd = "curl --noproxy localhost -fs -o /dev/null $url || wget --no-proxy -q -O /dev/null $url || exit 1"

# RAM auto: before the replicas go up, run one trial container without a memory limit, wait until it is healthy,
# watch its RAM for a while and set the limit to 1.5 x the peak (rounded up to 128 MB). The result is kept in the
# profile, so later starts do not measure again until -TuneRam ("จูน RAM ใหม่" on the page).
if ($TuneRam -or [int]$p.memoryMb -le 0) {
    Step "RAM auto: measuring $App in a trial container"
    $trial = "replicalab-ramtune"
    docker rm -f $trial *> $null
    docker run -d --name $trial --env-file $envRel --env-file $localRel --dns $(if ($env:RS_DNS1) { $env:RS_DNS1 } else { "10.6.22.16" }) --dns $(if ($env:RS_DNS2) { $env:RS_DNS2 } else { "10.6.22.15" }) $Image | Out-Null
    $tuned = 0
    if ($LASTEXITCODE -eq 0) {
        $deadline = (Get-Date).AddSeconds([Math]::Max(60, [int]$p.startPeriod) + 60)
        $healthy = $false
        while ((Get-Date) -lt $deadline) {
            docker exec $trial sh -c $healthCmd *> $null
            if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
            $state = docker inspect $trial --format "{{.State.Status}}" 2>$null
            if ($state -ne "running") { break }
            Start-Sleep 3
        }
        if ($healthy) {
            Write-Host "   healthy, watching RAM for 30 s"
            $peak = 0
            for ($i = 0; $i -lt 10; $i++) {
                docker exec $trial sh -c $healthCmd *> $null      # a little traffic, like a health probe
                $u = docker stats --no-stream --format "{{.MemUsage}}" $trial 2>$null
                if ("$u" -match '^\s*([\d.]+)\s*(KiB|MiB|GiB)') {
                    $v = [double]$Matches[1]; $mb = switch ($Matches[2]) { "KiB" { $v / 1024 } "MiB" { $v } "GiB" { $v * 1024 } }
                    if ($mb -gt $peak) { $peak = $mb }
                }
                Start-Sleep 3
            }
            $tuned = [int]([Math]::Ceiling(($peak * 1.5) / 128) * 128)
            $tuned = [Math]::Min(3072, [Math]::Max(384, $tuned))
            Write-Host ("   peak {0:N0} MB -> limit {1} MB per replica" -f $peak, $tuned)
        } else {
            Write-Host "   trial did not become healthy, keeping a default"
            docker logs --tail 15 $trial 2>&1 | ForEach-Object { "   | $_" }
        }
    }
    docker rm -f $trial *> $null
    if ($tuned -le 0) { $tuned = switch ("$($p.kind)") { "spring" { 1200 } "tomcat" { 1024 } default { 512 } } }
    # remember it in the profile (UTF-8 without BOM: the helper reads it with JSON.parse)
    $p | Add-Member -NotePropertyName memoryMb -NotePropertyValue $tuned -Force
    $p | Add-Member -NotePropertyName memoryAuto -NotePropertyValue $true -Force
    $p | Add-Member -NotePropertyName memoryTunedAt -NotePropertyValue (Get-Date -Format s) -Force
    [IO.File]::WriteAllText($profileFile, ($p | ConvertTo-Json -Depth 5))
    $node = docker info --format "{{.MemTotal}}" 2>$null
    if ("$node" -match '^\d+$' -and $tuned * $Replicas -gt ([double]$node / 1MB) * 0.8) {
        Write-Host ("   warning: {0} replicas x {1} MB is more than 80% of the RAM Docker has ({2:N0} MB)" -f $Replicas, $tuned, ([double]$node / 1MB))
    }
}
$mem = [int]$p.memoryMb; if ($mem -lt 256) { $mem = 1024 }
$env:RS_STACK = $Stack
$env:APP_NAME = $App; $env:APP_IMAGE = $Image; $env:APP_ENV_FILE = $envRel; $env:APP_LOCAL_ENV_FILE = $localRel; $env:APP_KIND = "$($p.kind)"
$env:APP_PORT = "$($p.port)"; $env:APP_HOST_PORT = "$Port"; $env:APP_REPLICAS = "$Replicas"
# never through a proxy: some images bake http_proxy into ENV (his-legacy-support), and then even localhost goes to the proxy (407)
$env:APP_HEALTH = $health; $env:APP_HEALTH_CMD = $healthCmd
$env:APP_START_PERIOD = "$([int]$p.startPeriod)"; $env:APP_MEMORY = "$mem"; $env:APP_RESERVE = "$([Math]::Min(768, [int]($mem / 2)))"
$env:APP_TEST = "$($p.test)"; $env:APP_BUILD_LOCAL = "$([bool]$p.buildLocal)".ToLower()
$env:SCALER_PORT = "$ScalerPort"; $env:SCALER_MAX = "$Max"; $env:SCALER_IMAGE = "replica-lab-scaler:$scalerId"
$env:RL_VERSION = if (Test-Path (Join-Path $PSScriptRoot "VERSION")) { (Get-Content (Join-Path $PSScriptRoot "VERSION") -Raw).Trim() } else { "dev" }
Step "docker stack deploy $Stack ($App x $Replicas)"
# --resolve-image never: images are local on this single node. --prune removes services of an older layout.
# Right after a stop (docker stack rm) the old network takes a few seconds to go away and the deploy fails, so retry.
for ($try = 1; $try -le 10; $try++) {
    docker stack deploy -c stack.yml --resolve-image never --prune $Stack
    if ($LASTEXITCODE -eq 0) { break }
    if ($try -eq 10) { throw "stack deploy failed" }
    Write-Host "   previous stack still shutting down, retry in 3 s ($try/10)"
    Start-Sleep 3
}

Write-Host ""
Write-Host "Replica Lab http://localhost:$ScalerPort" -ForegroundColor Green
Write-Host "$App        http://localhost:$Port$health   (replicas need a while to become healthy)"
Write-Host "stop:       .\stop-local.ps1"
