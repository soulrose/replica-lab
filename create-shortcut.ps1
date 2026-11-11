# Create the "Replica Lab" icon on the Desktop that opens the app (start.cmd). Desktop only: no Start menu entry
# (an icon an older version put in the Start menu is removed). Run again after moving the program folder.
param([switch]$Quiet)
$dir = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Replica Lab.lnk"))
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
Write-Host "created $($lnk.FullName)"
$old = Join-Path ([Environment]::GetFolderPath("Programs")) "Replica Lab.lnk"
if (Test-Path $old) { Remove-Item $old -Force; Write-Host "removed the Start menu icon $old" }
if (-not $Quiet) { & (Join-Path $dir "notice.ps1") shortcut }
