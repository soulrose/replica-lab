@echo off
rem Build ramaservice from your local code (uncommitted changes too) and switch the swarm to it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-local.ps1" %*
pause
