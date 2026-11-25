@echo off
title ATLAS Design Engine
cd /d "%~dp0"
echo.
echo === ATLAS Design Engine ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo Install the LTS version from https://nodejs.org and then double-click this file again.
  pause
  exit /b 1
)
echo Node.js version:
node -v
echo.
rem Always check the app's parts are installed and up to date. Fast when nothing changed.
echo Checking the app's parts (the first time takes a few minutes)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Install failed. See the messages above.
  pause
  exit /b 1
)
echo.
echo Starting ATLAS. Your browser will open http://localhost:3000 in a moment.
echo Keep this window open while you use the app. Close it to stop the app.
echo.
start "" cmd /c "timeout /t 15 /nobreak >nul & start http://localhost:3000"
call npm run dev
pause
