@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ZOLA STYLISH MANAGEMENT SYSTEM - Setup
cd /d "%~dp0"

echo.
echo  ==========================================================
echo     ZOLA STYLISH MANAGEMENT SYSTEM  -  first-time setup
echo  ==========================================================
echo.

rem ---- 1. Node.js -------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js was not found.
  echo  Install Node.js 20 LTS or newer from https://nodejs.org ^(keep the default options^),
  echo  then double-click setup.bat again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 20 (
  echo  Node.js 20 or newer is required. You have:
  node -v
  pause
  exit /b 1
)
echo  [OK] Node.js
node -v

rem ---- 2. Settings file (.env) ---------------------------------------------------
echo.
node scripts\configure-env.js
if errorlevel 2 (
  echo.
  echo  Notepad will open the settings file. Fill in at least:
  echo    DATABASE_PASSWORD  - the MySQL password for the DATABASE_USER account
  echo    ADMIN_NAME         - the owner's name ^(the dashboard greets you by it^)
  echo    ADMIN_EMAIL        - the owner's sign-in email
  echo    ADMIN_PASSWORD     - a first password ^(8+ characters, with letters and numbers^)
  echo  Save the file, close Notepad, and setup will continue.
  echo.
  notepad .env
  node scripts\configure-env.js
  if errorlevel 2 (
    echo  Some settings are still missing. Edit .env and run setup.bat again.
    pause
    exit /b 1
  )
)

rem ---- 3. Dependencies and web app build ---------------------------------------------
echo.
echo  Installing the server components (this can take a few minutes)...
call npm --prefix backend ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo  Installing and building the web application...
call npm --prefix frontend ci --no-audit --no-fund
if errorlevel 1 goto :failed
call npm --prefix frontend run build
if errorlevel 1 goto :failed

rem ---- 4. Database ------------------------------------------------------------------
echo.
echo  Creating the database tables and the administrator account...
call npm --prefix backend run setup:db
if errorlevel 1 (
  echo.
  echo  The database step failed. Check that MySQL is running and that DATABASE_USER /
  echo  DATABASE_PASSWORD in .env are correct. See README.md, "Database setup".
  pause
  exit /b 1
)

echo.
echo  ==========================================================
echo   Setup complete!
echo   Double-click start.bat to run ZOLA STYLISH MANAGEMENT SYSTEM.
echo   To use it from other salon computers, run firewall.bat once
echo   as administrator.
echo  ==========================================================
pause
exit /b 0

:failed
echo.
echo  Installation failed. Check your internet connection and try again.
pause
exit /b 1
