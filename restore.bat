@echo off
setlocal EnableExtensions
title ZOLA STYLISH MANAGEMENT SYSTEM - Restore
cd /d "%~dp0"

echo.
echo  RESTORE A BACKUP
echo  This replaces ALL current data with the data in the backup.
echo  Close the start.bat window (stop the server) before continuing.
echo.
echo  Backups on this computer (newest first):
dir /b /o-d "backend\storage\backups\*.sql.gz" 2>nul
echo.
set /p BACKUP_FILE= Type the file name to restore (or drag a backup file into this window): 
if "%BACKUP_FILE%"=="" exit /b 0
set BACKUP_FILE=%BACKUP_FILE:"=%

call npm --prefix backend run restore -- "%BACKUP_FILE%"
echo.
echo  If the restore completed, start the system again with start.bat.
pause
