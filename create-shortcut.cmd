@echo off
rem Create the "Replica Lab" icon on the Desktop (run once after unzipping / moving the folder)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
