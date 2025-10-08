@echo off
REM Install win-ca to fix SSL certificate issues on Windows

echo ============================================================
echo Windows SSL Certificate Fix
echo ============================================================
echo.
echo This script will install win-ca to fix SSL certificate issues
echo when connecting to trading APIs on Windows.
echo.
echo This is the RECOMMENDED solution for Windows users.
echo.
echo ============================================================
echo.

echo Installing win-ca globally...
call npm install -g win-ca

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to install win-ca
    echo Try running this as Administrator
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Installation complete!
echo ============================================================
echo.
echo Testing connection...
echo.

node test-connection.js

echo.
pause

