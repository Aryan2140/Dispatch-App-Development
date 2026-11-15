@echo off
title Allow Aimex Dispatch on Warehouse Wi-Fi (Port 3000)
echo ======================================================================
echo   AIMEX DISPATCH - WINDOWS FIREWALL RULE FOR LOCAL WI-FI (PORT 3000)
echo ======================================================================
echo.
echo Adding Windows Firewall rule to allow devices on your local Wi-Fi
echo to access the Aimex Dispatch Web App on TCP port 3000...
echo (Note: Right-click this file and select "Run as administrator" if prompted)
echo.

netsh advfirewall firewall delete rule name="Aimex Dispatch Web App (Port 3000)" >nul 2>nul
netsh advfirewall firewall add rule name="Aimex Dispatch Web App (Port 3000)" dir=in action=allow protocol=TCP localport=3000 profile=private,domain

if %ERRORLEVEL% EQU 0 (
    color 0A
    echo [SUCCESS] Windows Firewall port 3000 is now open for local Wi-Fi devices!
) else (
    color 0E
    echo [NOTICE] Please right-click "allow-windows-firewall-port.bat" and choose "Run as administrator".
)
echo.
pause
