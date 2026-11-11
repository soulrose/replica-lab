# Shared by run-local.ps1 / stop-local.ps1: which app runs now and what to remember about it.
# Per app, config\state\<app>.json keeps the image, replica count and host port in use, so the next start brings
# back the same setup (also after the image or port was changed on the page).

function Get-StateFile([string]$app) { Join-Path $PSScriptRoot "config\state\$app.json" }

function Read-AppState([string]$app) {
    $f = Get-StateFile $app
    if (Test-Path $f) { try { return Get-Content $f -Raw | ConvertFrom-Json } catch { } }
    return $null
}

function Write-AppState([string]$app, $image, $replicas, $hostPort) {
    $f = Get-StateFile $app
    New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null
    $o = [ordered]@{ image = "$image".Split("@")[0]; replicas = [int]$replicas; hostPort = [int]$hostPort; savedAt = (Get-Date -Format s) }
    [IO.File]::WriteAllText($f, ($o | ConvertTo-Json))
}

# The app service running now (or $null): name from its label, image, replicas, host port.
# JSON, not a Go template with quotes: PowerShell 5.1 strips embedded quotes from native arguments.
function Get-RunningApp([string]$stack) {
    $json = docker service inspect "${stack}_app" --format "{{json .Spec}}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $spec = ($json -join "") | ConvertFrom-Json
    $n = [int]$spec.Mode.Replicated.Replicas
    $last = $spec.Labels.'rama.scaler.last-replicas'
    if ($n -eq 0 -and $last -match '^\d+$') { $n = [int]$last }    # stopped on the page: remember the count it would start with
    return [pscustomobject]@{
        name     = $spec.TaskTemplate.ContainerSpec.Labels.'rama.lab.app', $spec.Labels.'rama.lab.app' | Where-Object { $_ } | Select-Object -First 1
        image    = "$($spec.TaskTemplate.ContainerSpec.Image)".Split("@")[0]
        replicas = $n
        hostPort = @($spec.EndpointSpec.Ports)[0].PublishedPort
    }
}

function Save-RunningApp([string]$stack) {
    $r = Get-RunningApp $stack
    if ($r -and $r.name) { Write-AppState $r.name $r.image $r.replicas $r.hostPort; return $r }
    return $null
}
