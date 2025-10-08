@echo off
REM Test connection to Bybit API with Google DNS

echo ============================================================
echo Connection Test with Google DNS
echo ============================================================
echo.
echo Testing connection to Bybit API using Google DNS
echo This is the same DNS your Brave browser uses.
echo.
echo ============================================================
echo.

REM Set environment variable to use Google DNS
set USE_GOOGLE_DNS=true

REM Run the test
node test-connection.js

echo.
pause

