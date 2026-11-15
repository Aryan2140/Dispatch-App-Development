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

echo Starting Aimex Dispatch Server on port 3000...
echo Opening http://localhost:3000 in your default browser...
echo.
start "" "http://localhost:3000"

node "%~dp0server.js"
pause
