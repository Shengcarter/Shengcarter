@echo off
setlocal EnableExtensions
title ZOLA STYLISH MANAGEMENT SYSTEM
cd /d "%~dp0"

if not exist ".env" (
  echo  Settings file not found. Run setup.bat first.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo  The web application has not been built. Run setup.bat first.
  pause
  exit /b 1
)

cd backend
for /f "usebackq delims=" %%p in (`node -e "require('dotenv').config({path:'../.env',quiet:true});console.log(process.env.PORT||5000)"`) do set APP_PORT=%%p
set NODE_ENV=production

echo.
echo  ZOLA STYLISH MANAGEMENT SYSTEM is starting...
echo  Keep this window open while the salon is using the system.
echo  On this computer:   http://localhost:%APP_PORT%
echo  Other computers:    http://^<this computer's IP address^>:%APP_PORT%
echo.

rem Open the browser a few seconds after the server starts.
start "" /min cmd /c "timeout /t 5 >nul & start http://localhost:%APP_PORT%"
node src\server.js

echo.
echo  The server has stopped.
pause
