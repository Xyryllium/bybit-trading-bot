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

    // Bot parameters
    this.initialBalance = config.trading.initialBalance || 100;
    this.leverage = config.trading.leverage || 10;
    this.marginMode = config.trading.marginMode || "cross";
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

      if (
        signal &&
        signal.action === "buy" &&
        signal.score >= this.scalpingStrategy.minScore
      ) {
        await this.openPosition(signal, ohlcv[ohlcv.length - 1][4]); // Use last close price
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
        // TODO: Implement actual order placement
        logger.info("🚀 LIVE: Opening position", {
          symbol: this.currentTopPerformer.symbol,
          entryPrice: price.toFixed(4),
          quantity: positionSize.quantity.toFixed(6),
          positionValue: positionSize.positionValue.toFixed(2),
        });
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

      const profit =
        (exitPrice - this.currentPosition.entryPrice) *
        this.currentPosition.quantity;
      const profitPercent =
        ((exitPrice - this.currentPosition.entryPrice) /
          this.currentPosition.entryPrice) *
        100;
      const fees = this.currentPosition.positionValue * 0.002;
      const netProfit = profit - fees;

      // Update balance
      this.balance += netProfit;
      this.effectiveBalance = this.balance * this.leverage;

      logger.info("🔴 Position closed", {
        symbol: this.currentPosition.symbol,
        entryPrice: this.currentPosition.entryPrice.toFixed(4),
        exitPrice: exitPrice.toFixed(4),
        profit: netProfit.toFixed(2),
        profitPercent: profitPercent.toFixed(2) + "%",
        reason: reason,
        balance: this.balance.toFixed(2),
      });

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
