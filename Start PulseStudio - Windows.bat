@echo off
setlocal EnableExtensions
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "RUNTIME_DIR=%APP_DIR%\.pulsestudio-runtime-windows"
set "RUNTIME_VERSION_FILE=%RUNTIME_DIR%\version.txt"

if not exist "%APP_DIR%\package.json" (
  echo The application folder is missing.
  echo Extract the complete ZIP again before launching PulseStudio.
  echo See README.md in the PulseStudio folder for help.
  pause
  exit /b 1
)

cd /d "%APP_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the current Node.js LTS release, then run this launcher again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not available. Reinstall Node.js LTS and try again.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APP_VERSION=%%V"
if not defined APP_VERSION (
  echo Unable to read the PulseStudio version.
  pause
  exit /b 1
)

set "PACKAGE_HASH_FILE=node_modules\.pulsestudio-package-hash"
set "PACKAGE_HASH="
for /f "delims=" %%H in ('node -e "const fs=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('package.json')).digest('hex'))"') do set "PACKAGE_HASH=%%H"
set "NEEDS_INSTALL=0"
if defined PACKAGE_HASH (
  set "CACHED_PACKAGE_HASH="
  if exist "%PACKAGE_HASH_FILE%" set /p CACHED_PACKAGE_HASH=<"%PACKAGE_HASH_FILE%"
  if not "%CACHED_PACKAGE_HASH%"=="%PACKAGE_HASH%" set "NEEDS_INSTALL=1"
)
if not exist "node_modules\electron" set "NEEDS_INSTALL=1"
if not exist "node_modules\electron-builder" set "NEEDS_INSTALL=1"
if not exist "node_modules\ffmpeg-static" set "NEEDS_INSTALL=1"
if not exist "node_modules\@huggingface\transformers" set "NEEDS_INSTALL=1"
if not exist "node_modules\uiohook-napi" set "NEEDS_INSTALL=1"
if not exist "node_modules\@sapphi-red\web-noise-suppressor" set "NEEDS_INSTALL=1"

if "%NEEDS_INSTALL%"=="1" (
  echo First launch: preparing PulseStudio. This may take a few minutes...
  call npm install --include=dev
  if errorlevel 1 (
    echo Dependency installation failed.
    echo See README.md in the PulseStudio folder for help.
    pause
    exit /b 1
  )
  if defined PACKAGE_HASH >"%PACKAGE_HASH_FILE%" echo %PACKAGE_HASH%
)

set "BUILDER=%APP_DIR%\node_modules\.bin\electron-builder.cmd"
if not exist "%BUILDER%" (
  echo The PulseStudio app builder is missing.
  echo Run the launcher again while connected to the internet.
  pause
  exit /b 1
)

set "BRANDED_EXE="
set "CACHED_VERSION="
if exist "%RUNTIME_VERSION_FILE%" set /p CACHED_VERSION=<"%RUNTIME_VERSION_FILE%"
if "%CACHED_VERSION%"=="%APP_VERSION%" (
  for /f "delims=" %%F in ('dir /b /s "%RUNTIME_DIR%\PulseStudio.exe" 2^>nul') do if not defined BRANDED_EXE set "BRANDED_EXE=%%F"
)

if not defined BRANDED_EXE (
  echo Preparing the native PulseStudio application...
  if exist "%RUNTIME_DIR%" rmdir /s /q "%RUNTIME_DIR%"
  mkdir "%RUNTIME_DIR%" >nul 2>nul
  set "CSC_IDENTITY_AUTO_DISCOVERY=false"
  call "%BUILDER%" --win dir --publish never "--config.directories.output=%RUNTIME_DIR%"
  if errorlevel 1 (
    echo Unable to prepare the native PulseStudio application.
    pause
    exit /b 1
  )
  for /f "delims=" %%F in ('dir /b /s "%RUNTIME_DIR%\PulseStudio.exe" 2^>nul') do if not defined BRANDED_EXE set "BRANDED_EXE=%%F"
  if not defined BRANDED_EXE (
    echo The native PulseStudio executable was not created.
    pause
    exit /b 1
  )
  >"%RUNTIME_VERSION_FILE%" echo %APP_VERSION%
)

echo Starting PulseStudio...
start "PulseStudio" "%BRANDED_EXE%"
if errorlevel 1 (
  echo Unable to start PulseStudio.
  pause
  exit /b 1
)

echo PulseStudio started. This command window may now be closed.
timeout /t 2 /nobreak >nul
endlocal
exit /b 0
