@echo off
rem Build "Replica Lab.exe" (in the replica-lab folder) from launcher\ReplicaLab.cs with the C# compiler that ships with Windows.
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /codepage:65001 /win32icon:"%~dp0..\assets\replica-lab.ico" /reference:System.Windows.Forms.dll /out:"%~dp0..\Replica Lab.exe" "%~dp0ReplicaLab.cs"
