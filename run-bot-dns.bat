@echo off
REM Run trading bot with Google DNS (bypasses ISP blocks)

echo ============================================================
echo Trading Bot - Live Bot with Google DNS
echo ============================================================
echo.
echo Using Google DNS (8.8.8.8, 8.8.4.4) to bypass ISP blocks
echo.
echo ============================================================
echo.

REM Set environment variable to use Google DNS
set USE_GOOGLE_DNS=true

REM Run the bot
node index.js %*

echo.
echo ============================================================
echo Bot stopped
echo ============================================================
pause

