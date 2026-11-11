# Build a ramaservice image from a local working copy (uncommitted changes included) and switch the
# swarm to it. Easiest: double-click build-local.cmd, press Enter to reuse the last repo.
#   .\build-local.ps1                                   # asks for the repo (Enter = last one), tag from the branch, switches the service
#   .\build-local.ps1 -Repo C:\...\ramaservice           # no question
#   .\build-local.ps1 -Repo ... -Tag 780-local -SkipMaven -NoApply
# Result: image ramaservice:<Tag>; also listed in the Scaler (http://localhost:18090) image picker.
param(
    [string]$Repo = "",
    [string]$Tag = "",
    [switch]$SkipMaven,
    [switch]$NoApply,
    [string]$Stack = "replicalab",
    [string]$Base = "harbor.rama.mahidol.ac.th/newhis/ramaservice:master"
)
$ErrorActionPreference = "Continue"
function Step($m) { Write-Host "== $m" -ForegroundColor Cyan }

# 1. Which working copy (remembered in config\last-repo.txt)
$lastFile = Join-Path $PSScriptRoot "config\last-repo.txt"
$last = if (Test-Path $lastFile) { (Get-Content $lastFile -Raw).Trim() } else { "" }
if (-not $Repo) {
    $prompt = if ($last) { "ramaservice folder (Enter = $last)" } else { "ramaservice folder (e.g. C:\Users\<you>\IdeaProjects\ramaservice)" }
    $Repo = (Read-Host $prompt).Trim().Trim('"')
    if (-not $Repo) { $Repo = $last }
}
if (-not $Repo -or -not (Test-Path (Join-Path $Repo "pom.xml"))) { throw "no pom.xml in '$Repo'" }
$Repo = (Resolve-Path $Repo).Path
New-Item -ItemType Directory -Force (Split-Path $lastFile) | Out-Null
[IO.File]::WriteAllText($lastFile, $Repo)

# 2. Tag from the branch: local-<branch>
$branch = (git -C $Repo branch --show-current) 2>$null
if (-not $Tag) {
    $name = if ($branch) { $branch } else { "detached" }
    $Tag = ("local-" + ($name -replace '[^A-Za-z0-9._-]', '-')).Substring(0, [Math]::Min(80, ("local-" + $name).Length)).TrimEnd('-', '.')
}
$dirty = @((git -C $Repo status --porcelain) 2>$null).Count
Write-Host "repo   $Repo"
Write-Host "branch $branch ($dirty changed files)"
Write-Host "image  ramaservice:$Tag"

# 3. Maven
if (-not $SkipMaven) {
    Step "mvnw package -DskipTests (a few minutes)"
    Push-Location $Repo
    & .\mvnw.cmd -q -B package -DskipTests "-Drevision=$Tag"
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { throw "maven build failed" }
}
$jar = Get-ChildItem (Join-Path $Repo "target") -Filter *.jar | Where-Object { $_.Name -notlike "*original*" -and $_.Name -notlike "*sources*" } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $jar) { throw "no jar in $Repo\target" }

# 4. Image (exploded jar on top of the Harbor master image)
Step "docker build ramaservice:$Tag from $($jar.Name) ($([math]::Round($jar.Length / 1MB)) MB)"
$ctx = Join-Path $env:TEMP "ramaservice-local-image-$Tag"
if (Test-Path $ctx) { Remove-Item -Recurse -Force $ctx }
New-Item -ItemType Directory $ctx | Out-Null
# .NET unzip, not tar: from Git Bash the tar on PATH is GNU tar, which reads "C:" as a remote host
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($jar.FullName, $ctx)
docker image inspect $Base *> $null
if ($LASTEXITCODE -ne 0) { docker pull $Base }
docker build -q -t "ramaservice:$Tag" --build-arg "BASE=$Base" `
    --label "rama.branch=$branch" --label "rama.built=$(Get-Date -Format s)" `
    -f (Join-Path $PSScriptRoot "local-image\Dockerfile") $ctx | Out-Null
$code = $LASTEXITCODE
Remove-Item -Recurse -Force $ctx
if ($code -ne 0) { throw "docker build failed" }

# 5. Switch the swarm service to it (rolling, one replica at a time) - only while ramaservice is the running app
. (Join-Path $PSScriptRoot "state.ps1")
$svc = "${Stack}_app"
$running = Get-RunningApp $Stack
if ($NoApply -or -not $running -or $running.name -ne "ramaservice") {
    Write-Host ""
    Write-Host "image ramaservice:$Tag ready" -ForegroundColor Green
    if (-not $NoApply) {
        if ($running) { Write-Host "ramaservice is not the running app: switch to it on the page, then pick this image" }
        else { Write-Host "Replica Lab is not running: open it, then pick this image" }
    }
} else {
    Step "switch $svc to ramaservice:$Tag"
    # --force: same tag rebuilt = same name, so make Swarm restart the tasks anyway
    docker service update --detach --force --image "ramaservice:$Tag" $svc | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "service update failed" }
    Write-Host ""
    Write-Host "ramaservice:$Tag is rolling out" -ForegroundColor Green
    if ($running.replicas -eq 0) { Write-Host "the app is stopped: press Start on the page" }
}
Write-Host "Replica Lab http://localhost:18090"
