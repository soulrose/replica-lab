@echo off
rem Start the Replica Lab helper (127.0.0.1:18091) if it is not running. start.cmd and OffLab run this.
rem Helper output: builder\helper.log (why it stopped the stack, builds, launches)
rem Node: the copy in node\ (full package) or the one installed on this PC
netstat -ano | findstr /r /c:"127.0.0.1:18091 .*LISTENING" >nul && exit /b 0
set "RLNODE=%~dp0node\node.exe"
if exist "%RLNODE%" goto run
set "RLNODE=node"
where node >nul 2>nul || (echo Node.js is not installed: the app window and build-local are unavailable & exit /b 0)
:run
powershell -NoProfile -Command "Start-Process '%RLNODE%' -ArgumentList 'builder\builder.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden -RedirectStandardOutput '%~dp0builder\helper.log' -RedirectStandardError '%~dp0builder\helper.err.log'"
