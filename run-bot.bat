@echo off
echo ============================================
echo    Starting Trading Bot
echo ============================================
echo.

if not exist .env (
    echo ERROR: .env file not found!
    echo.
    echo Please run setup-env.bat first to create the configuration file.
    echo.
    pause
    exit /b 1
)

echo Starting bot...
echo Press Ctrl+C to stop
echo.
npm start

