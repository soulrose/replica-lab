@echo off
rem Build the uninstaller for copies installed by ReplicaLab-Setup:  build-uninstall.cmd <out.exe>
rem make-package.ps1 calls this. Uses the C# compiler that ships with Windows (.NET Framework 4).
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /codepage:65001 /win32icon:"%~dp0..\assets\replica-lab.ico" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /out:"%~1" "%~dp0Uninstall.cs"
