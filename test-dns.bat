@echo off
REM Test which DNS provider works best for Bybit

echo ============================================================
echo DNS Provider Comparison Test
echo ============================================================
echo.
echo Testing Google DNS, Cloudflare DNS, and Quad9 DNS
echo to find the best option for accessing Bybit API
echo.
echo ============================================================
echo.

node dns-setup.js api.bybit.com

echo.
pause

