@echo off
title Aimex Warehouse Dispatch Server
color 0B

echo ======================================================================
echo   AIMEX AUSTRALIA - WAREHOUSE DISPATCH WEB APP LAUNCHER
echo ======================================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Node.js is not installed or not in your system PATH.
    echo Please download and install Node.js LTS from: https://nodejs.org/
    echo After installing Node.js, double-click this file again!
    echo.
    pause
    exit /b 1
)

:: Ensure Git is in PATH if installed in common Windows directories
where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
    if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "PATH=%ProgramFiles(x86)%\Git\cmd;%PATH%"
    if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
    if exist "%ProgramW6432%\Git\cmd\git.exe" set "PATH=%ProgramW6432%\Git\cmd;%PATH%"
)

where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [NOTE] Git is not installed or not in PATH.
    echo        The dispatch app will run normally, but remote one-click updates
    echo        via GitHub require Git for Windows: https://git-scm.com/download/win
    echo.
)

echo Starting Aimex Dispatch Server on port 3000...
echo Opening http://localhost:3000 in your default browser...
echo.
start "" "http://localhost:3000"

node "%~dp0server.js"
pause
