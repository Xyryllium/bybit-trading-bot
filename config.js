import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Exchange API Configuration
  // Supported: binance, binanceus, kucoin, okx, mexc, gateio, bitget, bybit
  exchange: {
    id: process.env.EXCHANGE || "bybit",
    apiKey: process.env.API_KEY,
    secret: process.env.API_SECRET,
    options: {
      defaultType: "spot", // 'spot' or 'linear' (USDT perpetual)
      recvWindow: 10000,
    },
    enableRateLimit: true,
  },

  // Trading Parameters
  trading: {
    symbol: process.env.TRADING_PAIR || "SOL/USDT:USDT", // SOL = +8.71% (ETH = +3.62%)
    timeframe: process.env.TIMEFRAME || "1h", // 1h is optimal for SMC_REFINED
    initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 200,
    backtestDays: parseInt(process.env.BACKTEST_DAYS) || 60, // 60 days for robustness

    // Risk Management - ⭐ WINNING SETUP: +3.62% per 60 days!
    // For SMC_REFINED 1h: Use these settings (PROVEN PROFITABLE!)
    // For RSI_EMA 15m: Change to stopLoss 0.6%, TP 1.5%, maxPosition 8%
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE) || 0.005, // 0.5% risk
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE) || 0.18, // 18% (2x = $36)
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 0.5, // 0.5% stop
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 1.8, // 1.8% target

    // Daily limits
    maxDailyLosses: 3,
    dailyLossLimit: 0.06, // 6% max daily loss

    // Leverage (for futures trading)
    leverage: parseInt(process.env.LEVERAGE) || 2, // 2x leverage default
  },

  // Strategy Selection
  // WINNING: SMC_REFINED + SOL/USDT 1h = +8.71% per 60 days (Profit Factor: 3.12)
  // Alternative: SMC_REFINED + ETH/USDT 1h = +3.62% per 60 days
  // Alternative: RSI_EMA + ETH/USDT 15m = +0.70% per 30 days
  strategyType: process.env.STRATEGY || "SMC_REFINED",

  // Strategy Parameters - RSI + EMA Strategy (ORIGINAL PROFITABLE - DO NOT CHANGE!)
  strategy: {
    rsi: {
      period: 14,
      oversold: 30, // Original setting
      overbought: 70, // Original setting
    },
    ema: {
      fastPeriod: 9,
      slowPeriod: 21,
    },
    volume: {
      multiplier: 1.5, // Original setting
      period: 20,
    },
    // Minimum profit target to avoid fees eating profits
    minProfitPercent: 0.5, // Original setting
  },

  // Smart Money Concepts (SMC) Strategy Parameters
  smcStrategy: {
    // Basic SMC - OPTIMIZED FOR PROFITABILITY
    minScore: 6, // Selective but not too strict (sweet spot)
    fvgLookback: 50, // Focus on recent FVGs only
    obLookback: 100, // Focus on recent Order Blocks
    obThreshold: 0.02, // Stricter OB confirmation (stronger zones)
    swingLength: 5, // Longer swings = clearer structure
    premiumDiscountLookback: 50, // Recent zones more relevant
    liquidityTolerance: 0.002, // Tighter liquidity zones
    minProfitPercent: 0.4, // Quick exits to lock profits

    // Refined SMC (Advanced) - BALANCED with improved penalties
    refined: {
      minScore: 3.5, // Sweet spot between 3 and 4
      minRiskReward: 2.0, // 2:1 minimum
      minOrderBlockAge: 2, // Very fresh OBs
      maxOrderBlockAge: 220, // Allow moderate age
      trailingStopPercent: 0.5, // Tight trailing
      deepDiscountThreshold: 30, // Standard deep discount
      confluenceThreshold: 0.01, // Moderate confluence
      volumeHighMultiplier: 1.45, // Moderate volume
      volumeVeryHighMultiplier: 1.9, // Moderate high volume
    },
  },

  // Scalping Strategy Parameters
  scalpingStrategy: {
    // Can be overridden by env vars
    fastEMA: parseInt(process.env.SCALP_FAST_EMA) || 5,
    mediumEMA: parseInt(process.env.SCALP_MEDIUM_EMA) || 9,
    slowEMA: parseInt(process.env.SCALP_SLOW_EMA) || 21,
    rsiPeriod: parseInt(process.env.SCALP_RSI_PERIOD) || 7,
    volumePeriod: parseInt(process.env.SCALP_VOLUME_PERIOD) || 10,
    stopLossPercent: parseFloat(process.env.SCALP_STOP_LOSS) || 0.4,
    takeProfitPercent: parseFloat(process.env.SCALP_TAKE_PROFIT) || 0.8,
    minScore: parseInt(process.env.SCALP_MIN_SCORE) || 4,
    riskPerTrade: parseFloat(process.env.SCALP_RISK) || 0.015,
    maxPositionSize: parseFloat(process.env.SCALP_MAX_POSITION) || 0.2,
    breakEvenTrigger: parseFloat(process.env.SCALP_BREAKEVEN) || 0.3,
    patternCooldown: parseInt(process.env.SCALP_COOLDOWN) || 10,
    doubleTolerance: parseFloat(process.env.SCALP_DOUBLE_TOLERANCE) || 0.003,
  },

  // Bot Settings
  bot: {
    dryRun: process.env.DRY_RUN !== "false",
    checkInterval: parseInt(process.env.CHECK_INTERVAL) || 60000, // 1 minute
    logLevel: process.env.LOG_LEVEL || "info",
  },

  // Fee structure (varies by exchange)
  // Binance: 0.1% maker/taker | Bybit: 0.1% | KuCoin: 0.1% | OKX: 0.08%
  fees: {
    maker: 0.001, // 0.1%
    taker: 0.001, // 0.1%
  },
};

export default config;
