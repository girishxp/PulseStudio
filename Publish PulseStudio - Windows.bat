@echo off
setlocal DisableDelayedExpansion
title PulseStudio Publisher
rem Keep the companion PowerShell script beside this file.
rem Bypass applies only to this publisher process; no saved policy is changed.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Publish PulseStudio - Windows.ps1" %*
set "PULSESTUDIO_PUBLISH_EXIT=%ERRORLEVEL%"
echo.
if not "%PULSESTUDIO_PUBLISH_EXIT%"=="0" echo Publishing did not complete. Read the message above before trying again.
pause
exit /b %PULSESTUDIO_PUBLISH_EXIT%
