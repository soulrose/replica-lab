@echo off
rem OffLab button "build-local": build your local code into an image and switch the swarm to it, in its own window.
start "ramaservice build-local" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-local.ps1"
