@echo off
setlocal EnableExtensions
title ZOLA STYLISH MANAGEMENT SYSTEM - Backup
cd /d "%~dp0"

echo  Backing up the database...
call npm --prefix backend run backup
if errorlevel 1 (
  echo  The backup failed. Check that MySQL is running.
  pause
  exit /b 1
)

rem Uploaded files (logo, photos, expense receipts) are copied next to the backups.
for /f "usebackq delims=" %%t in (`node -e "const d=new Date(),p=n=>String(n).padStart(2,'0');console.log(d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes()))"`) do set STAMP=%%t
if exist "backend\storage\uploads" (
  robocopy "backend\storage\uploads" "backend\storage\backups\uploads-%STAMP%" /E /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo  Copying uploaded files failed.
  ) else (
    echo  Uploaded files copied to backend\storage\backups\uploads-%STAMP%
  )
)

echo.
echo  Done. Copy the folder backend\storage\backups to a USB drive or cloud storage regularly.
pause
