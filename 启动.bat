@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM   FMPS Visualization System - One-Click Launcher
REM   Works on machines without Node.js or with a different version.
REM   Auto-downloads Node.js -> installs dependencies -> starts app.
REM ============================================================

set "ROOT=%~dp0"
set "NODE_VERSION=v22.22.2"
set "RUNTIME_DIR=%ROOT%.runtime"

REM ---------- 1. Detect CPU architecture ----------
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=arm64"

set "NODE_DIST=node-%NODE_VERSION%-win-%ARCH%"
set "NODE_DIR=%RUNTIME_DIR%\%NODE_DIST%"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"
set "ZIP=%RUNTIME_DIR%\%NODE_DIST%.zip"

title FMPS Launcher

echo ============================================
echo    FMPS Visualization System - Launcher
echo ============================================
echo.

REM ---------- 2. Ensure Node.js is ready ----------
if exist "%NODE_EXE%" goto node_ready

echo [1/4] Node.js not found locally. Downloading %NODE_VERSION% (%ARCH%)...
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"

echo   From: https://npmmirror.com/mirrors/node/%NODE_VERSION%/%NODE_DIST%.zip
call :download "https://npmmirror.com/mirrors/node/%NODE_VERSION%/%NODE_DIST%.zip" "%ZIP%"
if errorlevel 1 (
  echo   [Retry] Mirror unavailable, falling back to nodejs.org...
  call :download "https://nodejs.org/dist/%NODE_VERSION%/%NODE_DIST%.zip" "%ZIP%"
)
if errorlevel 1 goto download_fail

echo   Extracting: %NODE_DIST%.zip
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%RUNTIME_DIR%' -Force" 2>nul
if not exist "%NODE_EXE%" (
  echo   [Retry] PowerShell failed, trying system tar...
  tar.exe -xf "%ZIP%" -C "%RUNTIME_DIR%" 2>nul
)
if not exist "%NODE_EXE%" goto download_fail

echo   Node.js ready: %NODE_VERSION%
echo.
goto node_ready

REM ---------- Download helper (curl first, PowerShell fallback) ----------
:download
curl.exe -L --fail --retry 3 -s -o "%~2" "%~1"
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%~1' -OutFile '%~2' -UseBasicParsing" 2>nul
)
if errorlevel 1 exit /b 1
exit /b 0

:download_fail
echo.
echo [Error] Failed to download or extract Node.js. Check your network and retry.
echo         You can also manually download %NODE_DIST%.zip and extract it to:
echo         %NODE_DIR%
echo.
pause
exit /b 1

:node_ready
set "PATH=%NODE_DIR%;%PATH%"
echo [OK] Using Node.js: %NODE_VERSION% (%ARCH%)
echo.

REM ---------- 3. Install dependencies (first run only) ----------
echo [2/4] Checking dependencies...
if not exist "%ROOT%server\node_modules" (
  echo   Installing backend dependencies ^(server^)...
  cd /d "%ROOT%server"
  call "%NPM_CMD%" install --no-audit --no-fund --registry=https://registry.npmmirror.com
  if errorlevel 1 goto install_fail
)
if not exist "%ROOT%web\node_modules" (
  echo   Installing frontend dependencies ^(web^)...
  cd /d "%ROOT%web"
  call "%NPM_CMD%" install --no-audit --no-fund --registry=https://registry.npmmirror.com
  if errorlevel 1 goto install_fail
)
echo   Dependencies ready.
echo.

REM ---------- 4. Start backend & frontend ----------
echo [3/4] Starting backend  http://localhost:3000
start "FMPS-Backend" /D "%ROOT%server" cmd /k "node src/index.js"

echo [4/4] Starting frontend  http://localhost:5173
start "FMPS-Frontend" /D "%ROOT%web" cmd /k "npm run dev"

echo.
echo ============================================
echo    All started!
echo    Frontend:  http://localhost:5173
echo    Backend:   http://localhost:3000
echo.
echo    First run: click "Crawl" in the web UI to fetch data.
echo    Closing this window does NOT stop the services.
echo    Press Ctrl+C in the backend/frontend windows to stop.
echo ============================================
echo.
pause
endlocal
exit /b 0

:install_fail
echo.
echo [Error] Failed to install dependencies. Check your network and retry.
echo.
pause
exit /b 1
