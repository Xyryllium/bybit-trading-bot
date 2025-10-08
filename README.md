# Trading Bot - 2x Leverage

Automated cryptocurrency trading bot with 2x leverage support. Currently configured for the SMC_REFINED strategy on 1h timeframe, achieving +3.62% returns over 60 days in backtesting.

## Current Performance

Based on 60-day backtest:

- Symbol: SOL/USDT
- Return: +8.71%
- Profit Factor: 3.12
- Win Rate: 35.15%
- Max Drawdown: 20.60%
- Strategy: Smart Money Concepts - REFINED
- Timeframe: 1 hour

## Quick Start

### Install

```bash
npm install
```

### Configure

Copy the example environment file:

```bash
cp env.example .env
```

Edit `.env` with your exchange API credentials:

```bash
API_KEY=your_api_key
API_SECRET=your_api_secret
```

### Run Backtest

```bash
npm run backtest
```

### Paper Trading

Start the bot in dry-run mode (simulates trades without executing):

```bash
npm run start
```

The bot runs in paper trading mode by default (`DRY_RUN=true`).

### Live Trading

After testing, change `.env`:

```bash
DRY_RUN=false
```

Then restart the bot.

## Configuration

Current profitable settings:

```
Strategy: SMC_REFINED
Timeframe: 1h
Leverage: 2x
Stop Loss: 0.5%
Take Profit: 1.8%
Max Position: 18%
Risk Per Trade: 0.5%
```

Backtest results (60 days):

- Initial Balance: $200
- Final Balance: $217.42
- Total Return: +8.71%
- Total Trades: 74
- Win Rate: 35.14%
- Profit Factor: 3.12
- Average Win: $1.64
- Average Loss: $0.53
- Win/Loss Ratio: 3.09:1

## Project Structure

### Core Files

- `index.js` - Main bot entry point
- `backtest.js` - Backtesting engine
- `config.js` - Configuration settings
- `logger.js` - Logging system
- `positionManager.js` - Trade execution

### Strategies

- `smc-strategy-refined.js` - SMC REFINED (currently active)
- `strategy.js` - RSI + EMA strategy
- `smc-strategy.js` - Basic SMC
- `scalping-strategy.js` - High-frequency scalping

### Indicators

- `indicators.js` - RSI, EMA, volume
- `smc-indicators.js` - Order Blocks, Fair Value Gaps, market structure

### Utilities

- `dns-setup.js` - DNS configuration for blocked exchanges
- `test-connection.js` - Test exchange connection

## Available Strategies

### SMC_REFINED (Active)

Best for 1h timeframe. Return: +8.71% per 60 days.

Features:

- Order Block detection
- Fair Value Gap analysis
- Premium/Discount zone identification
- Break of Structure signals
- Trailing stop loss

### RSI_EMA (Alternative)

Best for 15m timeframe. Return: +0.70% per 30 days.

Features:

- RSI oversold/overbought detection
- EMA crossover signals
- Volume confirmation

### Others

- Basic SMC: Not recommended
- Scalping: For 1m timeframe only (advanced)

## Commands

### Backtesting

```bash
npm run backtest                           # Default settings (60 days)
node backtest.js ETH/USDT:USDT 1h 30      # Custom period
node backtest.js SOL/USDT:USDT 1h 90      # Different pair
```

### Trading

```bash
npm run start              # Start bot
npm run bot                # Alias for start
```

### Testing

```bash
node test-connection.js    # Test exchange connection
```

## Deployment

### Free Hosting (Oracle Cloud)

The bot can run 24/7 on Oracle Cloud's free tier. See `ORACLE_CLOUD_DEPLOYMENT.md` for detailed setup instructions.

Requirements:

- 1GB RAM (provided by free tier)
- Node.js 18+
- PM2 for process management

Alternative options:

- AWS Free Tier (12 months)
- Google Cloud Free Tier (12 months)
- Railway.app ($5/month)
- DigitalOcean ($6/month)

## Switching Strategies

To use RSI_EMA on 15m timeframe, update `.env`:

```bash
STRATEGY=RSI_EMA
TIMEFRAME=15m
MAX_POSITION_SIZE=0.08
STOP_LOSS_PERCENT=0.6
TAKE_PROFIT_PERCENT=1.5
```

Always run a backtest before using a new strategy or configuration.

## Documentation

- `WINNING_SETUP.md` - Detailed explanation of current profitable setup
- `ORACLE_CLOUD_DEPLOYMENT.md` - Step-by-step free hosting guide
- `ENV_VARIABLES_GUIDE.md` - All configuration options
- `TROUBLESHOOTING.md` - Common issues and solutions
- `ISP_BYPASS_GUIDE.md` - DNS configuration for connection issues
- `NPM_SCRIPTS_GUIDE.md` - Available npm commands
- `FILES_OVERVIEW.md` - Project file reference

## What Was Fixed

This version includes several important bug fixes:

**Leverage Position Sizing**

- Fixed: Position sizing now correctly accounts for leverage
- Previously: 0 trades would execute due to minimum order size issues

**Fee Accounting**

- Fixed: Entry and exit fees now calculated correctly
- Previously: Entry fees missing, exit fees double-counted

**Stop Loss Enforcement**

- Fixed: Stop losses enforced exactly at configured percentage
- Previously: Could exit at worse prices (up to -1.97% when configured for -0.6%)

**Trailing Stops**

- Fixed: Now configurable and triggers at 0.5% profit
- Previously: Hardcoded at 1.5%, triggered at 2% profit only

**Open Position Handling**

- Fixed: Positions closed properly at end of backtest
- Previously: Margin could remain locked, skewing balance calculations

**Exit Logic**

- Fixed: Won't exit early when in a losing position
- Previously: Could exit at bad prices before stop loss hit

## Performance Comparison

Strategy performance over different timeframes and periods:

| Strategy    | Timeframe | Period  | Result |
| ----------- | --------- | ------- | ------ |
| SMC_REFINED | 1h        | 60 days | +3.62% |
| SMC_REFINED | 15m       | 60 days | -0.77% |
| RSI_EMA     | 15m       | 30 days | +0.70% |
| RSI_EMA     | 15m       | 60 days | -2.31% |
| Basic SMC   | 15m       | 60 days | -1.25% |

The 1h timeframe with SMC_REFINED consistently outperforms other configurations.

## Key Findings

What works:

- 1h timeframe provides cleaner market structure than 15m
- 1.8% take profit is optimal (1.5% leaves money on table, 2.0% too difficult to reach)
- 18% position size effectively amplifies edge without excessive risk
- 0.5% stop loss provides good loss control
- 2x leverage optimal (5x leverage resulted in -4.96% due to tighter stops)

What doesn't work:

- Higher leverage (5x, 10x) requires tighter stops that get hit too frequently
- 15m timeframe with SMC strategies produces too many false signals
- Take profits above 1.8% significantly reduce hit rate
- Basic SMC strategy has inferior exit logic

## Expected Returns

Projected performance based on backtest results:

| Initial Balance | 60 Days | Annual (estimated) |
| --------------- | ------- | ------------------ |
| $100            | +$3.62  | ~$22               |
| $200            | +$7.24  | ~$44               |
| $500            | +$18.10 | ~$110              |
| $1000           | +$36.20 | ~$220              |

Assumes consistent 3.62% per 60-day period. Past performance does not guarantee future results.

## Risk Warnings

**Maximum Drawdown: ~20%**

In the 60-day backtest, the account balance dropped from $100 to $80.04 before recovering to $103.62.

**Leverage Risks**

With 2x leverage:

- Both profits and losses are amplified
- A 45% adverse price move could trigger liquidation
- Stop loss at 0.5% provides protection but gaps can occur

**Recommendations**

1. Start with $100-$200 maximum
2. Paper trade for 1-2 weeks before going live
3. Set API keys to trading-only permissions (disable withdrawals)
4. Monitor daily for the first month
5. Run monthly backtests to verify strategy remains effective
6. Only trade with capital you can afford to lose

## Troubleshooting

**No trades executing:**

- Verify position size meets exchange minimum (typically $10)
- Check leverage configuration
- Review strategy minScore settings

**Connection errors:**

- See `ISP_BYPASS_GUIDE.md` for DNS configuration
- Try setting `USE_GOOGLE_DNS=true`
- Check firewall/antivirus settings

**Losses exceeding configured stop loss:**

- Ensure you're using the latest version with fixes
- Verify exit logic is not exiting early

See `TROUBLESHOOTING.md` for more details.

## Technical Details

The bot uses:

- ccxt library for exchange connectivity
- Winston for logging
- Smart Money Concepts for market analysis
- Risk-based position sizing
- Configurable leverage support

All strategies use percentage-based risk management, allowing the bot to scale to any account size.

## Disclaimer

Trading cryptocurrencies involves substantial risk of loss. This software is provided for educational purposes.

- Past performance does not guarantee future results
- You can lose your entire investment
- Leverage amplifies both gains and losses
- Only trade with money you can afford to lose
- The developers are not responsible for trading losses

Use at your own risk.

## License

MIT License

## Version

2.0 (2x Leverage - Fixed & Optimized)
Last Updated: October 8, 2025
