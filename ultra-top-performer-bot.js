import dotenv from "dotenv";

// Load ultra-scalping environment FIRST
dotenv.config({ path: "./env.ultra-scalping" });

import { config } from "./config.js";
import { UltraScalpingStrategy } from "./ultra-scalping-strategy.js";
import logger from "./logger.js";
import ccxt from "ccxt";

class UltraTopPerformerBot {
  constructor() {
    this.config = config;
    this.exchange = null;
    this.scalpingStrategy = null;

    // Debug: Check what environment variables are loaded
    console.log("🔍 Environment Debug:", {
      SCALP_INITIAL_BALANCE: process.env.SCALP_INITIAL_BALANCE,
      SCALP_LEVERAGE: process.env.SCALP_LEVERAGE,
      SCALP_MARGIN_MODE: process.env.SCALP_MARGIN_MODE,
      INITIAL_BALANCE: process.env.INITIAL_BALANCE, // From .env (SMC)
      LEVERAGE: process.env.LEVERAGE, // From .env (SMC)
      configInitialBalance: config.trading.initialBalance,
      configLeverage: config.trading.leverage,
      configMarginMode: config.trading.marginMode,
    });

    // Bot parameters - Use scalping-specific environment variables
    this.initialBalance = parseFloat(process.env.SCALP_INITIAL_BALANCE) || 100;
    this.leverage = parseInt(process.env.SCALP_LEVERAGE) || 10;
    this.marginMode = process.env.SCALP_MARGIN_MODE || "cross";
    this.balance = this.initialBalance;
    this.effectiveBalance = this.initialBalance * this.leverage;

    // Symbols to monitor - will be dynamically fetched
    this.monitoredSymbols = [];
    this.currentPosition = null;
    this.currentTopPerformer = null;

    // Risk management
    this.dailyLossLimit = 0.02; // 2% daily loss limit
    this.maxDailyTrades = 10;
    this.dailyTrades = 0;
    this.dailyStartBalance = this.initialBalance;

    logger.info("🚀 Ultra-Optimized Top Performer Scalping Bot Initialized", {
      initialBalance: this.initialBalance,
      leverage: this.leverage + "x",
      marginMode: this.marginMode,
      effectiveBalance: this.effectiveBalance,
    });
  }

  async initialize() {
    try {
      // Initialize exchange
      this.exchange = new ccxt[this.config.exchange.id]({
        apiKey: this.config.exchange.apiKey,
        secret: this.config.exchange.secret,
        options: this.config.exchange.options,
        enableRateLimit: this.config.exchange.enableRateLimit,
      });

      // Initialize strategy
      this.scalpingStrategy = new UltraScalpingStrategy(this.config);

      // Fetch available symbols
      await this.fetchAvailableSymbols();

      logger.info("✅ Ultra-scalping bot initialized successfully");
      return true;
    } catch (error) {
      logger.error("Failed to initialize ultra-scalping bot", {
        error: error.message,
      });
      return false;
    }
  }

  async fetchAvailableSymbols() {
    try {
      const markets = await this.exchange.loadMarkets();
      const perpetualFutures = Object.values(markets).filter(
        (market) =>
          market.type === "swap" &&
          market.quote === "USDT" &&
          market.active === true &&
          market.settle === "USDT"
      );

      // Sort by priority (major tokens first, then by symbol length)
      const priorityTokens = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "ADA",
        "DOT",
        "LINK",
        "UNI",
        "ATOM",
        "AVAX",
      ];
      perpetualFutures.sort((a, b) => {
        const aPriority = priorityTokens.indexOf(a.base);
        const bPriority = priorityTokens.indexOf(b.base);

        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;

        return a.symbol.length - b.symbol.length;
      });

      this.monitoredSymbols = perpetualFutures
        .slice(0, 15)
        .map((market) => market.symbol);

      logger.info("✅ Found perpetual futures symbols", {
        totalSymbols: perpetualFutures.length,
        selectedSymbols: this.monitoredSymbols.length,
        symbols: this.monitoredSymbols.join(", "),
      });
    } catch (error) {
      logger.error("Failed to fetch symbols, using fallback", {
        error: error.message,
      });
      // Fallback to major symbols
      this.monitoredSymbols = [
        "BTC/USDT:USDT",
        "ETH/USDT:USDT",
        "SOL/USDT:USDT",
        "BNB/USDT:USDT",
        "ADA/USDT:USDT",
        "DOT/USDT:USDT",
        "LINK/USDT:USDT",
        "UNI/USDT:USDT",
        "ATOM/USDT:USDT",
        "AVAX/USDT:USDT",
      ];
    }
  }

  async start() {
    logger.info("🚀 Starting Ultra-Optimized Top Performer Scalping Bot...");

    if (!(await this.initialize())) {
      logger.error("Failed to initialize bot");
      return;
    }

    // Main trading loop
    setInterval(async () => {
      try {
        await this.updateTopPerformer();
        await this.checkForSignals();
        await this.managePosition();
      } catch (error) {
        logger.error("Error in main loop", { error: error.message });
      }
    }, 30000); // Check every 30 seconds

    logger.info("✅ Ultra-scalping bot started successfully");
  }

  async updateTopPerformer() {
    try {
      const performances = {};

      for (const symbol of this.monitoredSymbols) {
        const ticker = await this.exchange.fetchTicker(symbol);
        const change24h = (ticker.change / ticker.last) * 100;
        performances[symbol] = change24h;
      }

      // Find top performer
      const sortedPerformances = Object.entries(performances).sort(
        ([, a], [, b]) => b - a
      );

      const [topSymbol, topPerformance] = sortedPerformances[0];

      // Switch if significantly better performance
      if (
        !this.currentTopPerformer ||
        topPerformance > this.currentTopPerformer.performance + 1.0
      ) {
        logger.info("🔄 Switching to new top performer", {
          from: this.currentTopPerformer?.symbol || "None",
          to: topSymbol,
          performance: topPerformance.toFixed(2) + "%",
        });

        this.currentTopPerformer = {
          symbol: topSymbol,
          performance: topPerformance,
          price: performances[topSymbol],
        };

        // Close current position if switching
        if (this.currentPosition) {
          await this.closePosition("Switching to top performer");
        }
      }
    } catch (error) {
      logger.error("Failed to update top performer", { error: error.message });
    }
  }

  async checkForSignals() {
    if (!this.currentTopPerformer || this.currentPosition) return;

    try {
      const symbol = this.currentTopPerformer.symbol;
      const ohlcv = await this.exchange.fetchOHLCV(
        symbol,
        "5m",
        undefined,
        100
      );

      const signal = this.scalpingStrategy.analyze(symbol, ohlcv);

      // Debug logging for signal analysis
      logger.info("🔍 Signal analysis", {
        symbol: symbol,
        signal: signal,
        minScore: this.scalpingStrategy.minScore,
        currentPrice: ohlcv[ohlcv.length - 1][4],
        candlesLength: ohlcv.length,
        strategyConfig: {
          minVolumeRatio: this.scalpingStrategy.minVolumeRatio,
          maxVolatility: this.scalpingStrategy.maxVolatility,
          minTrendStrength: this.scalpingStrategy.minTrendStrength,
          minMomentumScore: this.scalpingStrategy.minMomentumScore,
          patternCooldown: this.scalpingStrategy.patternCooldown,
        },
      });

      if (
        signal &&
        signal.action === "buy" &&
        signal.score >= this.scalpingStrategy.minScore
      ) {
        logger.info("🎯 Valid buy signal detected", {
          symbol: symbol,
          score: signal.score,
          reason: signal.reason,
          setup: signal.setup,
        });
        await this.openPosition(signal, ohlcv[ohlcv.length - 1][4]); // Use last close price
      } else if (signal && signal.action === "buy") {
        logger.debug("Signal rejected - score too low", {
          symbol: symbol,
          score: signal.score,
          minRequired: this.scalpingStrategy.minScore,
          reason: signal.reason,
        });
      } else {
        logger.debug("No buy signal", {
          symbol: symbol,
          action: signal?.action || "none",
          reason: signal?.reason || "no signal",
        });
      }
    } catch (error) {
      logger.error("Failed to check signals", { error: error.message });
    }
  }

  async openPosition(signal, price) {
    try {
      const { stopLoss, takeProfit } =
        this.scalpingStrategy.calculateExitPrices(price);
      const positionSize = this.scalpingStrategy.calculatePositionSize(
        this.effectiveBalance,
        price,
        stopLoss
      );

      // Check minimum position size
      const minPositionValue = Math.max(this.effectiveBalance * 0.05, 5);
      if (positionSize.positionValue < minPositionValue) {
        logger.debug("Position too small", {
          positionValue: positionSize.positionValue.toFixed(2),
          minRequired: minPositionValue.toFixed(2),
        });
        return;
      }

      // Check daily limits
      if (this.dailyTrades >= this.maxDailyTrades) {
        logger.warn("Daily trade limit reached");
        return;
      }

      // Place order (dry run for now)
      if (this.config.trading.dryRun) {
        logger.info("🔵 DRY RUN: Would open position", {
          symbol: this.currentTopPerformer.symbol,
          entryPrice: price.toFixed(4),
          quantity: positionSize.quantity.toFixed(6),
          positionValue: positionSize.positionValue.toFixed(2),
          stopLoss: stopLoss.toFixed(4),
          takeProfit: takeProfit.toFixed(4),
          score: signal.score,
        });
      } else {
        // Execute actual order placement
        try {
          const order = await this.exchange.createMarketBuyOrder(
            this.currentTopPerformer.symbol,
            positionSize.quantity
          );

          logger.info("🚀 LIVE: Position opened successfully", {
            symbol: this.currentTopPerformer.symbol,
            orderId: order.id,
            entryPrice: order.price || order.average,
            quantity: order.amount,
            positionValue: positionSize.positionValue.toFixed(2),
            stopLoss: stopLoss.toFixed(4),
            takeProfit: takeProfit.toFixed(4),
            score: signal.score,
          });

          // Update position with actual order details
          this.currentPosition.entryPrice = order.price || order.average;
          this.currentPosition.quantity = order.amount;
          this.currentPosition.orderId = order.id;
        } catch (orderError) {
          logger.error("Failed to place order", {
            error: orderError.message,
            symbol: this.currentTopPerformer.symbol,
            quantity: positionSize.quantity,
          });
          return; // Don't create position if order failed
        }
      }

      this.currentPosition = {
        symbol: this.currentTopPerformer.symbol,
        entryPrice: price,
        quantity: positionSize.quantity,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        timestamp: Date.now(),
        positionValue: positionSize.positionValue,
        signal: signal,
      };

      this.dailyTrades++;
    } catch (error) {
      logger.error("Failed to open position", { error: error.message });
    }
  }

  async managePosition() {
    if (!this.currentPosition) return;

    try {
      const ticker = await this.exchange.fetchTicker(
        this.currentPosition.symbol
      );
      const currentPrice = ticker.last;

      // Check stop loss
      if (currentPrice <= this.currentPosition.stopLoss) {
        await this.closePosition("Stop loss");
        return;
      }

      // Check take profit
      if (currentPrice >= this.currentPosition.takeProfit) {
        await this.closePosition("Take profit");
        return;
      }

      // Check for exit signals
      const ohlcv = await this.exchange.fetchOHLCV(
        this.currentPosition.symbol,
        "5m",
        undefined,
        50
      );
      const exitSignal = this.scalpingStrategy.checkExitSignal(
        this.currentPosition,
        ohlcv
      );

      if (exitSignal) {
        await this.closePosition(exitSignal.reason);
      }
    } catch (error) {
      logger.error("Failed to manage position", { error: error.message });
    }
  }

  async closePosition(reason) {
    if (!this.currentPosition) return;

    try {
      const ticker = await this.exchange.fetchTicker(
        this.currentPosition.symbol
      );
      const exitPrice = ticker.last;

      // Execute actual sell order
      if (this.config.trading.dryRun) {
        logger.info("🔵 DRY RUN: Would close position", {
          symbol: this.currentPosition.symbol,
          entryPrice: this.currentPosition.entryPrice.toFixed(4),
          exitPrice: exitPrice.toFixed(4),
          reason: reason,
        });
      } else {
        try {
          const sellOrder = await this.exchange.createMarketSellOrder(
            this.currentPosition.symbol,
            this.currentPosition.quantity
          );

          logger.info("🔴 LIVE: Position closed successfully", {
            symbol: this.currentPosition.symbol,
            orderId: sellOrder.id,
            entryPrice: this.currentPosition.entryPrice.toFixed(4),
            exitPrice: sellOrder.price || sellOrder.average,
            reason: reason,
          });

          // Use actual exit price from order
          const actualExitPrice = sellOrder.price || sellOrder.average;
          const profit =
            (actualExitPrice - this.currentPosition.entryPrice) *
            this.currentPosition.quantity;
          const profitPercent =
            ((actualExitPrice - this.currentPosition.entryPrice) /
              this.currentPosition.entryPrice) *
            100;
          const fees = this.currentPosition.positionValue * 0.002;
          const netProfit = profit - fees;

          // Update balance
          this.balance += netProfit;
          this.effectiveBalance = this.balance * this.leverage;

          logger.info("💰 Trade completed", {
            profit: netProfit.toFixed(2),
            profitPercent: profitPercent.toFixed(2) + "%",
            balance: this.balance.toFixed(2),
          });
        } catch (sellError) {
          logger.error("Failed to close position", {
            error: sellError.message,
            symbol: this.currentPosition.symbol,
            quantity: this.currentPosition.quantity,
          });
          return; // Don't clear position if sell failed
        }
      }

      this.currentPosition = null;
    } catch (error) {
      logger.error("Failed to close position", { error: error.message });
    }
  }
}

// Start the bot
const bot = new UltraTopPerformerBot();
bot.start().catch((error) => {
  logger.error("Failed to start bot", { error: error.message });
  process.exit(1);
});
