@echo off
rem Replica Lab as its own window (like Hyperion API): start the helper, open the app window on the launch page.
rem The launch page checks Docker, deploys the current app and moves on to the Replica Lab page.
rem Closing the window stops everything (image / replicas / port of the app are remembered).
cd /d "%~dp0"
where node >nul 2>nul || goto nonode
call "%~dp0helper.cmd"
rem wait until the helper listens (up to ~10 s)
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',18091);break}catch{Start-Sleep -Milliseconds 250}}"
start "" msedge --app=http://localhost:18091/launch --window-size=1440,960
exit /b 0

:nonode
rem Node.js is needed for the app window and the helper: open its download page and say so
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0notice.ps1" node
exit /b 1
