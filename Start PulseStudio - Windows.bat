@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PULSESTUDIO_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PULSESTUDIO_POWERSHELL%" (
  echo Windows PowerShell could not be found on this computer.
  exit /b 1
)
if not exist "%~dp0app\launch-windows.ps1" (
  start "" "%PULSESTUDIO_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Extract the complete PulseStudio ZIP, then open this launcher from the extracted folder.', 'PulseStudio launcher is missing')"
  exit /b 1
)
start "" "%PULSESTUDIO_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app\launch-windows.ps1"
if errorlevel 1 (
  start "" "%PULSESTUDIO_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('PulseStudio could not open its launcher. Extract the complete ZIP, then try again.', 'PulseStudio could not start')"
  exit /b 1
)
endlocal
exit /b 0
