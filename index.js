#!/usr/bin/env node

import ccxt from "ccxt";
import config from "./config.js";
import logger from "./logger.js";
import TradingStrategy from "./strategy.js";
import SMCStrategy from "./smc-strategy.js";
import SMCStrategyRefined from "./smc-strategy-refined.js";
import ScalpingStrategy from "./scalping-strategy.js";
import PositionManager from "./positionManager.js";
import { setupDNS } from "./dns-setup.js";

/**
 * Main Trading Bot Class
 */
class TradingBot {
  constructor() {
    this.config = config;
    this.exchange = null;
    this.strategy = null;
    this.positionManager = null;
    this.isRunning = false;
    this.balance = config.trading.initialBalance;
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      logger.info("=".repeat(60));
      logger.info("🤖 Trading Bot Starting");
      logger.info("=".repeat(60));

      // Initialize exchange
      this.exchange = new ccxt[this.config.exchange.id]({
        apiKey: this.config.exchange.apiKey,
        secret: this.config.exchange.secret,
        options: this.config.exchange.options,
        enableRateLimit: this.config.exchange.enableRateLimit,
      });

      logger.info("Exchange Configuration", {
        exchange: this.config.exchange.id,
        symbol: this.config.trading.symbol,
        timeframe: this.config.trading.timeframe,
        dryRun: this.config.bot.dryRun,
      });

      // Check if API keys are set
      if (!this.config.exchange.apiKey || !this.config.exchange.secret) {
        logger.warn("⚠️  API keys not set - running in DRY RUN mode only");
        this.config.bot.dryRun = true;
      }

      // Test connection
      if (!this.config.bot.dryRun) {
        await this.testConnection();
        await this.fetchBalance();
      } else {
        logger.info("💼 Initial Balance (Simulated)", {
          balance: this.balance.toFixed(2) + " USDT",
        });
      }

      // Initialize strategy and position manager
      if (this.config.strategyType === "SCALPING") {
        this.strategy = new ScalpingStrategy(this.config);
        logger.info("⚡ Strategy: Scalping (High Frequency Trading)");
      } else if (this.config.strategyType === "SMC_REFINED") {
        this.strategy = new SMCStrategyRefined(this.config);
        logger.info("🧠 Strategy: Smart Money Concepts - REFINED (Advanced)");
      } else if (this.config.strategyType === "SMC") {
        this.strategy = new SMCStrategy(this.config);
        logger.info("🧠 Strategy: Smart Money Concepts (Basic)");
      } else {
        this.strategy = new TradingStrategy(this.config);
        logger.info("📈 Strategy: RSI + EMA Crossover");
      }

      this.positionManager = new PositionManager(this.exchange, this.config);

      logger.info("Risk Management", {
        strategy: this.config.strategyType,
        riskPerTrade: this.config.trading.riskPerTrade * 100 + "%",
        maxPositionSize: this.config.trading.maxPositionSize * 100 + "%",
        stopLoss: this.config.trading.stopLossPercent + "%",
        takeProfit: this.config.trading.takeProfitPercent + "%",
        maxDailyLosses: this.config.trading.maxDailyLosses,
        dailyLossLimit: this.config.trading.dailyLossLimit * 100 + "%",
      });

      logger.info("✅ Bot initialized successfully");
      logger.info("=".repeat(60));
    } catch (error) {
      logger.error("Failed to initialize bot", { error: error.message });
      throw error;
    }
  }

  /**
   * Test exchange connection
   */
  async testConnection() {
    try {
      logger.info("Testing exchange connection...");
      await this.exchange.fetchMarkets();
      logger.info("✅ Connection successful");
    } catch (error) {
      logger.error("❌ Connection failed", { error: error.message });
      throw new Error("Failed to connect to exchange: " + error.message);
    }
  }

  /**
   * Fetch account balance
   */
  async fetchBalance() {
    try {
      const balance = await this.exchange.fetchBalance();
      const usdt = balance.USDT || balance.USD || { free: 0 };
      this.balance = usdt.free || 0;

      logger.info("💼 Account Balance", {
        available: this.balance.toFixed(2) + " USDT",
        total: (balance.USDT?.total || 0).toFixed(2) + " USDT",
      });

      if (this.balance < 10) {
        logger.warn(
          "⚠️  Low balance - may not meet minimum order requirements"
        );
      }

      return this.balance;
    } catch (error) {
      logger.error("Failed to fetch balance", { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch market data (candles)
   */
  async fetchCandles(symbol, timeframe, limit = 100) {
    try {
      const candles = await this.exchange.fetchOHLCV(
        symbol,
        timeframe,
        undefined,
        limit
      );
      logger.debug(`Fetched ${candles.length} candles for ${symbol}`);
      return candles;
    } catch (error) {
      logger.error("Failed to fetch candles", {
        symbol,
        timeframe,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Main trading loop
   */
  async runTradingLoop() {
    try {
      const symbol = this.config.trading.symbol;

      // Fetch market data
      const candles = await this.fetchCandles(
        symbol,
        this.config.trading.timeframe,
        100
      );

      if (!candles || candles.length === 0) {
        logger.warn("No candles received");
        return;
      }

      const currentPrice = candles[candles.length - 1][4]; // Close price

      // Update balance if not in dry run
      if (!this.config.bot.dryRun) {
        await this.fetchBalance();
      }

      // Get current position
      const position = this.positionManager.getPosition();

      // Display position status
      if (position) {
        const status = this.positionManager.getPositionStatus(currentPrice);
        logger.info("📊 Position Status", {
          entryPrice: status.entryPrice.toFixed(2),
          currentPrice: status.currentPrice.toFixed(2),
          unrealizedPL: status.unrealizedPL.toFixed(2) + " USDT",
          unrealizedPercent: status.unrealizedPercent.toFixed(2) + "%",
          stopLoss: status.stopLoss.toFixed(2),
          takeProfit: status.takeProfit.toFixed(2),
          duration: status.duration,
        });
      }

      // Analyze market and get trading signal
      const signal = this.strategy.analyze(candles, position);

      logger.debug("Strategy Signal", {
        action: signal.action,
        reason: signal.reason,
      });

      // Execute trading logic
      if (
        signal.action === "BUY" &&
        this.positionManager.canEnterPosition(this.balance)
      ) {
        await this.handleBuySignal(signal, currentPrice);
      } else if (signal.action === "SELL" && position) {
        await this.handleSellSignal(signal, position);
      } else if (signal.action === "HOLD") {
        logger.debug("Holding position or waiting for signal");
      }

      // Display statistics
      const stats = this.positionManager.getStats();
      if (stats.totalTrades > 0) {
        logger.info("📈 Trading Statistics", stats);
      }
    } catch (error) {
      logger.error("Error in trading loop", {
        error: error.message,
        stack: error.stack,
      });

      // If we have a critical error and an open position, consider closing it
      if (error.message.includes("API") || error.message.includes("network")) {
        logger.warn("Network/API error detected - will retry next cycle");
      }
    }
  }

  /**
   * Handle buy signal
   */
  async handleBuySignal(signal, currentPrice) {
    try {
      logger.info("🔵 Processing BUY signal");

      // Calculate exit prices
      const { stopLoss, takeProfit } =
        this.strategy.calculateExitPrices(currentPrice);

      // Calculate position size
      const positionSize = this.strategy.calculatePositionSize(
        this.balance,
        currentPrice,
        stopLoss
      );

      logger.info("Position Sizing", {
        balance: this.balance.toFixed(2) + " USDT",
        positionValue: positionSize.positionValue.toFixed(2) + " USDT",
        quantity: positionSize.quantity.toFixed(6),
        riskAmount: positionSize.riskAmount.toFixed(2) + " USDT",
        riskPercent: positionSize.riskPercent.toFixed(2) + "%",
      });

      // Check minimum order size
      const minOrderValue = 10; // Bybit typical minimum
      if (positionSize.positionValue < minOrderValue) {
        logger.warn("Position size below minimum order value", {
          positionValue: positionSize.positionValue.toFixed(2),
          minimum: minOrderValue,
        });
        return;
      }

      // Execute buy order
      const position = await this.positionManager.executeBuy(
        this.config.trading.symbol,
        positionSize.quantity,
        currentPrice,
        stopLoss,
        takeProfit
      );

      // Update balance in dry run mode
      if (this.config.bot.dryRun) {
        this.balance -= position.positionValue;
        logger.info("💼 Updated Balance (Simulated)", {
          balance: this.balance.toFixed(2) + " USDT",
        });
      }
    } catch (error) {
      logger.error("Failed to handle BUY signal", { error: error.message });
    }
  }

  /**
   * Handle sell signal
   */
  async handleSellSignal(signal, position) {
    try {
      logger.info("🔴 Processing SELL signal");

      // Execute sell order
      const trade = await this.positionManager.executeSell(
        position.symbol,
        position.quantity,
        signal.price,
        signal.reason
      );

      // Update balance in dry run mode
      if (this.config.bot.dryRun && trade) {
        this.balance += trade.quantity * trade.exitPrice;
        const totalPL = trade.profit;

        logger.info("💼 Updated Balance (Simulated)", {
          balance: this.balance.toFixed(2) + " USDT",
          totalPL: totalPL.toFixed(2) + " USDT",
          totalReturn:
            (
              ((this.balance - this.config.trading.initialBalance) /
                this.config.trading.initialBalance) *
              100
            ).toFixed(2) + "%",
        });
      }
    } catch (error) {
      logger.error("Failed to handle SELL signal", { error: error.message });
    }
  }

  /**
   * Start the bot
   */
  async start() {
    this.isRunning = true;

    logger.info(
      "🚀 Bot started - Running every " +
        this.config.bot.checkInterval / 1000 +
        " seconds"
    );
    logger.info("Press Ctrl+C to stop");
    logger.info("=".repeat(60));

    // Initial run
    await this.runTradingLoop();

    // Set up interval
    this.interval = setInterval(async () => {
      if (this.isRunning) {
        logger.info("\n" + "─".repeat(60));
        logger.info("🔄 Running trading cycle");
        await this.runTradingLoop();
      }
    }, this.config.bot.checkInterval);
  }

  /**
   * Stop the bot
   */
  async stop() {
    logger.info("🛑 Stopping bot...");
    this.isRunning = false;

    if (this.interval) {
      clearInterval(this.interval);
    }

    // Close any open positions if requested
    const position = this.positionManager.getPosition();
    if (position) {
      logger.warn("⚠️  Position still open on shutdown");
      // Uncomment to auto-close on shutdown:
      // await this.positionManager.closePositionAtMarket('Bot shutdown');
    }

    logger.info("✅ Bot stopped");
    logger.info("=".repeat(60));
  }
}

// Main execution
(async () => {
  const bot = new TradingBot();

  // Handle shutdown gracefully
  process.on("SIGINT", async () => {
    logger.info("\n📥 Shutdown signal received");
    await bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("\n📥 Termination signal received");
    await bot.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection", {
      reason,
      promise,
    });
  });

  // Setup DNS to bypass ISP blocks (if DNS_PROVIDER env var is set)
  const dnsProvider =
    process.env.DNS_PROVIDER || process.env.USE_GOOGLE_DNS === "true"
      ? "google"
      : null;
  if (dnsProvider) {
    setupDNS(dnsProvider);
  }

  try {
    await bot.initialize();
    await bot.start();
  } catch (error) {
    logger.error("Fatal error", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
})();
