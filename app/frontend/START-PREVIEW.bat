@echo off
setlocal
cd /d "%~dp0"
echo ======================================
echo       ABYX - NOVUS Frontend Preview
echo ======================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 20.19+ or 22.12+ from https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing frontend dependencies. This may take a few minutes...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
call npm run dev -- --host 127.0.0.1
pause
