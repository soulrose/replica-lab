# Create a "Replica Lab" icon on the Desktop and in the Start menu that opens the app (start.cmd).
# Run again after moving the program folder.
param([switch]$Quiet)
$dir = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$places = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "")
)
foreach ($place in $places) {
    $lnk = $shell.CreateShortcut((Join-Path $place "Replica Lab.lnk"))
    $exe = Join-Path $dir "Replica Lab.exe"
    if (Test-Path $exe) {
        # the launcher exe: no console window at all
        $lnk.TargetPath = $exe; $lnk.Arguments = ""; $lnk.IconLocation = "$exe,0"; $lnk.WindowStyle = 1
    } else {
        $lnk.TargetPath = "$env:SystemRoot\System32\cmd.exe"
        $lnk.Arguments = "/c `"`"$dir\start.cmd`"`""
        $lnk.IconLocation = "$dir\assets\replica-lab.ico,0"
        $lnk.WindowStyle = 7        # minimized: the console only flashes in the taskbar, the app window opens
    }
    $lnk.WorkingDirectory = $dir
    $lnk.Description = "Replica Lab: run an app as several Docker Swarm replicas"
    $lnk.Save()
    Write-Host "created $(Join-Path $place 'Replica Lab.lnk')"
}
if (-not $Quiet) { & (Join-Path $dir "notice.ps1") shortcut }
