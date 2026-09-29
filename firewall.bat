@echo off
setlocal EnableExtensions
title ZOLA STYLISH MANAGEMENT SYSTEM - Network access
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo  Please right-click firewall.bat and choose "Run as administrator".
  pause
  exit /b 1
)

set APP_PORT=5000
if exist "backend\node_modules\dotenv" (
  for /f "usebackq delims=" %%p in (`node -e "require('./backend/node_modules/dotenv').config({path:'.env',quiet:true});console.log(process.env.PORT||5000)"`) do set APP_PORT=%%p
)

rem Allow other computers on the salon (private) network to reach the system.
netsh advfirewall firewall delete rule name="ZOLA STYLISH MANAGEMENT SYSTEM" >nul 2>&1
netsh advfirewall firewall add rule name="ZOLA STYLISH MANAGEMENT SYSTEM" dir=in action=allow protocol=TCP localport=%APP_PORT% profile=private
if errorlevel 1 (
  echo  Could not add the firewall rule.
  pause
  exit /b 1
)

echo.
echo  Done. Other computers on the salon network can open:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r /c:"IPv4"') do echo     http:%%a:%APP_PORT%
echo.
echo  Make sure the salon Wi-Fi/network is set to "Private" in Windows settings.
pause
