@echo off
rem Stop the swarm stack (replicas + Scaler) and remember its image/replicas. OffLab runs this on "close all" instead of killing Docker.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-local.ps1"
