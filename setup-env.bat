@echo off
echo ============================================
echo    Trading Bot - Environment Setup
echo ============================================
echo.

if exist .env (
    echo .env file already exists!
    echo.
    choice /C YN /M "Do you want to overwrite it"
    if errorlevel 2 goto :end
)

echo Creating .env file...
echo.

(
echo # Bybit API Credentials
echo # Get your API keys from: https://www.bybit.com/app/user/api-management
echo API_KEY=your_api_key_here
echo API_SECRET=your_api_secret_here
echo.
echo # Trading Configuration
echo TRADING_PAIR=BTC/USDT
echo INITIAL_BALANCE=100
echo RISK_PER_TRADE=0.02
echo MAX_POSITION_SIZE=0.15
echo STOP_LOSS_PERCENT=2
echo TAKE_PROFIT_PERCENT=3
echo LEVERAGE=1
echo.
echo # Bot Settings
echo DRY_RUN=true
echo LOG_LEVEL=info
echo CHECK_INTERVAL=60000
) > .env

echo ✓ .env file created successfully!
echo.
echo CONFIGURATION:
echo - Mode: DRY RUN (Paper Trading)
echo - Balance: $100 (Simulated)
echo - Pair: BTC/USDT
echo - Risk: 2%% per trade
echo.
echo NEXT STEPS:
echo 1. Run: npm run backtest
echo 2. Then: npm start
echo.
echo To enable live trading:
echo 1. Edit .env file
echo 2. Add your Bybit API credentials
echo 3. Set DRY_RUN=false
echo.

:end
pause

