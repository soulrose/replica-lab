@echo off
rem Build the one-file installer from a package zip:  build-setup.cmd <package.zip> <out.exe>
rem make-package.ps1 calls this after it made the zip. Uses the C# compiler that ships with Windows (.NET Framework 4).
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /codepage:65001 /win32icon:"%~dp0..\assets\replica-lab.ico" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /resource:"%~1",payload.zip /out:"%~2" "%~dp0Setup.cs"
