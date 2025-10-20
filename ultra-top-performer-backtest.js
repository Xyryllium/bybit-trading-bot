#!/usr/bin/env node

import ccxt from "ccxt";
import dotenv from "dotenv";
import config from "./config.js";
import logger from "./logger.js";
import UltraScalpingStrategy from "./ultra-scalping-strategy.js";
import Indicators from "./indicators.js";

// Load ultra-scalping environment variables
dotenv.config({ path: "./env.ultra-scalping" });

/**
 * Ultra-Optimized Top Performer Scalping Bot Backtest
 *
 * Features maximum win rates through:
 * - Ultra-strict entry filtering
 * - Multi-pattern confirmation
 * - Advanced market condition analysis
 * - Ultra-conservative risk management
 * - Momentum-based filtering
 */
class UltraTopPerformerBacktest {
  constructor() {
    this.config = config;
    this.exchange = null;
    this.scalpingStrategy = null;

    // Backtest parameters
    this.initialBalance = config.trading.initialBalance || 1000;
    this.leverage = config.trading.leverage || 1;
    this.marginMode = config.trading.marginMode || "isolated";
    this.balance = this.initialBalance; // Actual balance (for risk management)
    this.effectiveBalance = this.initialBalance * this.leverage; // Leveraged balance (for position sizing)
    this.days = 3; // Limited by Bybit's 1000 candle limit (3.5 days of 5m data)
    this.timeframe = "5m"; // 5-minute candles for better scalping

    // Symbols to monitor - will be dynamically fetched from Bybit
    this.monitoredSymbols = [];

    // Performance tracking
    this.trades = [];
    this.currentPosition = null;
    this.currentTopPerformer = null;
    this.topPerformerHistory = [];

    // Ultra-enhanced statistics
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      maxDrawdown: 0,
      maxBalance: this.initialBalance,
      winRate: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      totalFees: 0,
      sharpeRatio: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      avgTradeDuration: 0,
      profitableDays: 0,
      losingDays: 0,
      ultraQualityTrades: 0,
      patternConfluenceTrades: 0,
    };

    // Ultra-conservative risk management (Tighter for profitability)
    this.dailyLossLimit = 0.02; // 2% daily loss limit (more conservative)
    this.maxDailyTrades = 10; // Fewer trades for better quality
    this.dailyTrades = 0;
    this.dailyStartBalance = this.initialBalance;

    logger.info(
      "🚀 Ultra-Optimized Top Performer Scalping Backtest Initialized",
      {
        initialBalance: this.initialBalance,
        leverage: this.leverage + "x",
        marginMode: this.marginMode,
        effectiveBalance: this.effectiveBalance,
        days: this.days,
        symbols: "Dynamic (will be fetched from Bybit)",
        timeframe: this.timeframe,
      }
    );
  }

  /**
   * Initialize the ultra-optimized backtest
   */
  async initialize() {
    try {
      logger.info("=".repeat(80));
      logger.info(
        "🚀 ULTRA-OPTIMIZED TOP PERFORMER SCALPING BACKTEST STARTING"
      );
      logger.info("=".repeat(80));

      // Initialize exchange
      this.exchange = new ccxt[this.config.exchange.id]({
        enableRateLimit: true,
      });

      // Fetch all available perpetual futures symbols from Bybit
      await this.fetchAvailableSymbols();

      // Initialize ultra-optimized scalping strategy
      this.scalpingStrategy = new UltraScalpingStrategy(this.config);

      logger.info("✅ Ultra-optimized backtest initialized successfully");
      logger.info("=".repeat(80));
    } catch (error) {
      logger.error("Failed to initialize ultra-optimized backtest", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Fetch all available perpetual futures symbols from Bybit
   */
  async fetchAvailableSymbols() {
    try {
      logger.info(
        "🔍 Fetching all available perpetual futures symbols from Bybit..."
      );

      // Load all markets
      const markets = await this.exchange.loadMarkets();

      // Filter for USDT perpetual futures
      const perpSymbols = Object.keys(markets).filter((symbol) => {
        const market = markets[symbol];
        return (
          market.type === "swap" && // Perpetual futures
          market.quote === "USDT" && // USDT quoted
          market.active === true && // Active trading
          market.settle === "USDT" // USDT settled
        );
      });

      // Sort by market cap/volume (approximate by symbol name length and common tokens first)
      const sortedSymbols = perpSymbols.sort((a, b) => {
        // Prioritize major tokens
        const majorTokens = [
          "BTC",
          "ETH",
          "SOL",
          "BNB",
          "ADA",
          "DOT",
          "LINK",
          "UNI",
          "ATOM",
          "MATIC",
          "AVAX",
          "NEAR",
          "FTM",
          "ALGO",
          "XRP",
          "LTC",
          "BCH",
          "ETC",
          "TRX",
          "DOGE",
        ];

        const aBase = a.split("/")[0];
        const bBase = b.split("/")[0];

        const aIndex = majorTokens.indexOf(aBase);
        const bIndex = majorTokens.indexOf(bBase);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex; // Major tokens first
        } else if (aIndex !== -1) {
          return -1; // a is major, b is not
        } else if (bIndex !== -1) {
          return 1; // b is major, a is not
        } else {
          return a.length - b.length; // Shorter names first (usually more established)
        }
      });

      // Limit to top symbols for better focus and profitability
      this.monitoredSymbols = sortedSymbols.slice(0, 15); // Top 15 symbols (more focused)

      logger.info(
        `✅ Found ${perpSymbols.length} perpetual futures symbols, using top ${this.monitoredSymbols.length}`,
        {
          totalSymbols: perpSymbols.length,
          selectedSymbols: this.monitoredSymbols.length,
          symbols:
            this.monitoredSymbols.slice(0, 10).join(", ") +
            (this.monitoredSymbols.length > 10 ? "..." : ""),
        }
      );
    } catch (error) {
      logger.error("Failed to fetch available symbols", {
        error: error.message,
      });

      // Fallback to default symbols
      this.monitoredSymbols = [
        "BTC/USDT:USDT",
        "ETH/USDT:USDT",
        "SOL/USDT:USDT",
        "ADA/USDT:USDT",
        "DOT/USDT:USDT",
        "LINK/USDT:USDT",
        "UNI/USDT:USDT",
        "ATOM/USDT:USDT",
      ];

      logger.warn("Using fallback symbols", {
        symbols: this.monitoredSymbols,
      });
    }
  }

  /**
   * Run the ultra-optimized backtest
   */
  async runBacktest() {
    try {
      logger.info(
        "🚀 Starting Ultra-Optimized Top Performer Scalping Backtest..."
      );

      const startTime = Date.now();

      // Calculate date range (limited by Bybit's 1000 candle limit)
      const endDate = new Date();
      const startDate = new Date(
        endDate.getTime() - 4 * 24 * 60 * 60 * 1000 // 4 days to ensure we have data
      );

      logger.info("Data Range", {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        days: this.days,
      });

      // Fetch historical data
      logger.info("📊 Fetching historical data for all symbols...");
      const historicalData = await this.fetchHistoricalData(startDate, endDate);

      if (!historicalData || Object.keys(historicalData).length === 0) {
        throw new Error("No historical data available");
      }

      logger.info("✅ Historical data fetched", {
        symbolsWithData: Object.keys(historicalData).length,
        totalCandles: Object.values(historicalData).reduce(
          (sum, candles) => sum + candles.length,
          0
        ),
      });

      // Process backtest day by day
      await this.processBacktestDays(historicalData);

      // Calculate final statistics
      this.calculateFinalStatistics();

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      logger.info("🎯 Ultra-optimized backtest completed", {
        duration: duration.toFixed(2) + "s",
        totalTrades: this.stats.totalTrades,
        finalBalance: this.balance.toFixed(2),
        totalReturn:
          (
            ((this.balance - this.initialBalance) / this.initialBalance) *
            100
          ).toFixed(2) + "%",
        winRate: this.stats.winRate.toFixed(2) + "%",
      });

      // Display ultra-enhanced results
      this.displayUltraResults();
    } catch (error) {
      logger.error("Ultra-optimized backtest failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch historical data with ultra-enhanced error handling
   * Bybit has a 1000 candle limit, so we'll fetch the most recent 1000 candles
   */
  async fetchHistoricalData(startDate, endDate) {
    const historicalData = {};

    logger.info("Fetching data for each symbol...", {
      candlesPerSymbol: 1000, // Bybit limit
      totalSymbols: this.monitoredSymbols.length,
      note: "Using Bybit's 1000 candle limit",
    });

    for (const symbol of this.monitoredSymbols) {
      try {
        logger.info(`Fetching data for ${symbol}...`);

        // Fetch the most recent 1000 candles (Bybit limit)
        const candles = await this.exchange.fetchOHLCV(
          symbol,
          this.timeframe,
          undefined,
          1000
        );

        if (candles && candles.length > 0) {
          // Use all candles since we're limited to 1000
          historicalData[symbol] = candles;
          logger.info(`✅ ${symbol}: ${candles.length} candles (Bybit limit)`);
        } else {
          logger.warn(`⚠️  No data for ${symbol}`);
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        logger.error(`Failed to fetch data for ${symbol}`, {
          error: error.message,
        });
      }
    }

    return historicalData;
  }

  /**
   * Process backtest day by day with ultra-enhanced logic
   * Limited by Bybit's 1000 candle constraint
   */
  async processBacktestDays(historicalData) {
    const days = this.days;

    // Get the actual date range from the historical data
    const allCandles = Object.values(historicalData).flat();
    if (allCandles.length === 0) {
      logger.warn("No historical data available for processing");
      return;
    }

    const earliestCandle = Math.min(...allCandles.map((c) => c[0]));
    const latestCandle = Math.max(...allCandles.map((c) => c[0]));

    const startDate = new Date(earliestCandle);
    const endDate = new Date(latestCandle);

    logger.info("Processing with actual data range", {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      totalCandles: allCandles.length,
    });

    for (let day = 0; day < days; day++) {
      // Reset daily counters
      this.dailyTrades = 0;
      this.dailyStartBalance = this.balance;

      const dayStart = startDate.getTime() + day * 24 * 60 * 60 * 1000;
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;

      logger.info(`📅 Processing Day ${day + 1}/${days}`, {
        date: new Date(dayStart).toISOString().split("T")[0],
        dayStart: new Date(dayStart).toISOString(),
        dayEnd: new Date(dayEnd).toISOString(),
      });

      // Calculate daily performances
      const dailyPerformances = this.calculateDailyPerformances(
        historicalData,
        dayStart,
        dayEnd
      );

      if (dailyPerformances.length === 0) {
        logger.warn(`No performance data for day ${day + 1}`, {
          date: new Date(dayStart).toISOString().split("T")[0],
          symbolsWithData: Object.keys(historicalData).length,
          totalCandles: Object.values(historicalData).reduce(
            (sum, candles) => sum + candles.length,
            0
          ),
        });
        continue;
      }

      // Find top performer
      const topPerformer = dailyPerformances.sort(
        (a, b) => b.dailyChangePercent - a.dailyChangePercent
      )[0];

      this.topPerformerHistory.push({
        date: new Date(dayStart).toISOString().split("T")[0],
        symbol: topPerformer.symbol,
        performance: topPerformer.dailyChangePercent,
        price: topPerformer.currentPrice,
      });

      logger.info(`🏆 Day ${day + 1} Top Performer`, {
        symbol: topPerformer.symbol,
        performance: topPerformer.dailyChangePercent.toFixed(2) + "%",
        price: topPerformer.currentPrice.toFixed(4),
      });

      // Check if we should switch to this top performer
      if (this.shouldSwitchTopPerformer(topPerformer, dayStart)) {
        await this.switchToTopPerformer(topPerformer, dayStart);
      }

      // Run ultra-optimized scalping strategy
      if (this.currentTopPerformer) {
        await this.runUltraScalpingStrategy(
          historicalData[this.currentTopPerformer.symbol],
          dayStart,
          dayEnd
        );
      }

      // Check daily loss limit
      const dailyReturn =
        (this.balance - this.dailyStartBalance) / this.dailyStartBalance;
      if (dailyReturn < -this.dailyLossLimit) {
        logger.warn(
          `🚨 Daily loss limit reached: ${(dailyReturn * 100).toFixed(2)}%`
        );
        // Close any open position
        if (this.currentPosition) {
          await this.closePosition("Daily loss limit reached");
        }
      }

      // Update daily statistics
      if (dailyReturn > 0) {
        this.stats.profitableDays++;
      } else if (dailyReturn < 0) {
        this.stats.losingDays++;
      }

      // Progress update
      if ((day + 1) % 5 === 0) {
        logger.info(`📊 Progress Update (Day ${day + 1}/${days})`, {
          balance: this.balance.toFixed(2),
          trades: this.stats.totalTrades,
          return:
            (
              ((this.balance - this.initialBalance) / this.initialBalance) *
              100
            ).toFixed(2) + "%",
          winRate: this.stats.winRate.toFixed(2) + "%",
        });
      }
    }
  }

  /**
   * Calculate daily performances with ultra-enhanced filtering
   */
  calculateDailyPerformances(historicalData, dayStart, dayEnd) {
    const performances = [];

    for (const [symbol, candles] of Object.entries(historicalData)) {
      try {
        // Find candles within the day range with tolerance
        const dayCandles = candles.filter((candle) => {
          const candleTime = candle[0];
          const tolerance = 60 * 60 * 1000; // 1 hour tolerance
          return (
            candleTime >= dayStart - tolerance &&
            candleTime <= dayEnd + tolerance
          );
        });

        // Debug logging
        logger.info(
          `Day ${new Date(dayStart).toISOString().split("T")[0]} - ${symbol}: ${
            dayCandles.length
          } candles found`,
          {
            dayStart: new Date(dayStart).toISOString(),
            dayEnd: new Date(dayEnd).toISOString(),
            firstCandle:
              dayCandles.length > 0
                ? new Date(dayCandles[0][0]).toISOString()
                : "none",
            lastCandle:
              dayCandles.length > 0
                ? new Date(dayCandles[dayCandles.length - 1][0]).toISOString()
                : "none",
          }
        );

        if (dayCandles.length < 3) {
          logger.debug(
            `Insufficient candles for ${symbol} on ${
              new Date(dayStart).toISOString().split("T")[0]
            }: ${dayCandles.length}`
          );
          continue;
        }

        // Sort candles by timestamp
        dayCandles.sort((a, b) => a[0] - b[0]);

        const openPrice = dayCandles[0][1];
        const closePrice = dayCandles[dayCandles.length - 1][4];
        const dailyChange = closePrice - openPrice;
        const dailyChangePercent = (dailyChange / openPrice) * 100;

        // Calculate additional metrics for ultra-filtering
        const highs = dayCandles.map((c) => c[2]);
        const lows = dayCandles.map((c) => c[3]);
        const closes = dayCandles.map((c) => c[4]);
        const volumes = dayCandles.map((c) => c[5]);

        const volatility = Indicators.calculateVolatility(
          closes,
          closes.length
        );
        const avgVolume = Indicators.calculateAverageVolume(
          volumes,
          volumes.length
        );
        const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);
        const volumeRatio =
          avgVolume > 0 ? totalVolume / (avgVolume * volumes.length) : 1;

        // Calculate momentum score
        const bullishCandles = dayCandles.filter((c) => c[4] > c[1]).length;
        const momentumScore = bullishCandles / dayCandles.length;

        // Ultra-enhanced filtering - only include symbols with strong performance
        if (
          Math.abs(dailyChangePercent) > 0.5 &&
          volumeRatio > 0.8 &&
          momentumScore > 0.4
        ) {
          performances.push({
            symbol,
            currentPrice: closePrice,
            dailyChange,
            dailyChangePercent,
            volume: totalVolume,
            volumeRatio,
            volatility: volatility || 0,
            momentumScore,
            candles: dayCandles,
          });

          logger.debug(
            `Performance calculated for ${symbol}: ${dailyChangePercent.toFixed(
              2
            )}% (${dayCandles.length} candles)`
          );
        }
      } catch (error) {
        logger.debug(`Error calculating performance for ${symbol}`, {
          error: error.message,
        });
      }
    }

    logger.debug(
      `Total performances calculated: ${performances.length} for ${
        new Date(dayStart).toISOString().split("T")[0]
      }`
    );
    return performances;
  }

  /**
   * Check if we should switch to a new top performer
   */
  shouldSwitchTopPerformer(newTopPerformer, currentTime) {
    if (!this.currentTopPerformer) {
      return true;
    }

    if (!newTopPerformer) {
      return false;
    }

    // Ultra-enhanced switching logic
    const performanceDifference =
      newTopPerformer.dailyChangePercent -
      this.currentTopPerformer.dailyChangePercent;
    const minSwitchThreshold = 1.5; // Require 1.5% better performance

    // Don't switch too frequently
    const timeSinceLastSwitch = currentTime - this.lastTopPerformerSwitch;
    const minSwitchInterval = 3 * 60 * 60 * 1000; // 3 hours minimum

    if (timeSinceLastSwitch < minSwitchInterval) {
      return false;
    }

    // Only switch if significantly better
    if (performanceDifference > minSwitchThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Switch to new top performer
   */
  async switchToTopPerformer(newTopPerformer, currentTime) {
    logger.info("🔄 Switching to new top performer", {
      from: this.currentTopPerformer?.symbol || "None",
      to: newTopPerformer.symbol,
      performance: newTopPerformer.dailyChangePercent.toFixed(2) + "%",
    });

    // Close current position if exists
    if (this.currentPosition) {
      await this.closePosition("Switching to top performer");
    }

    // Update current top performer
    this.currentTopPerformer = newTopPerformer;
    this.lastTopPerformerSwitch = currentTime;

    logger.info("✅ Successfully switched to top performer", {
      symbol: newTopPerformer.symbol,
      performance: newTopPerformer.dailyChangePercent.toFixed(2) + "%",
      price: newTopPerformer.currentPrice.toFixed(4),
    });
  }

  /**
   * Run ultra-optimized scalping strategy
   */
  async runUltraScalpingStrategy(candles, dayStart, dayEnd) {
    if (!candles || candles.length < 150) return;

    // Filter candles for the current day
    const dayCandles = candles.filter((candle) => {
      const candleTime = candle[0];
      return candleTime >= dayStart && candleTime < dayEnd;
    });

    if (dayCandles.length < 30) return;

    // Run ultra-optimized scalping strategy on each candle
    for (let i = 30; i < dayCandles.length; i++) {
      // Check daily trade limit
      if (this.dailyTrades >= this.maxDailyTrades) {
        logger.warn("🚨 Daily trade limit reached");
        break;
      }

      const currentCandles = candles.slice(
        0,
        candles.findIndex((c) => c[0] >= dayStart) + i + 1
      );

      if (currentCandles.length < 150) continue;

      const signal = this.scalpingStrategy.analyze(
        currentCandles,
        this.currentPosition
      );

      if (signal.action === "BUY" && !this.currentPosition) {
        await this.openPosition(signal, dayCandles[i][4], dayCandles[i][0]);
        this.dailyTrades++;
      } else if (signal.action === "SELL" && this.currentPosition) {
        await this.closePosition(
          signal.reason,
          dayCandles[i][4],
          dayCandles[i][0]
        );
        this.dailyTrades++;
      }
    }
  }

  /**
   * Open a position with ultra-enhanced risk management
   */
  async openPosition(signal, price, timestamp) {
    try {
      const { stopLoss, takeProfit } =
        this.scalpingStrategy.calculateExitPrices(price);
      const positionSize = this.scalpingStrategy.calculatePositionSize(
        this.effectiveBalance, // Use leveraged balance for position sizing
        price,
        stopLoss
      );

      // Dynamic minimum position based on effective balance (5% of effective balance, min $5)
      const minPositionValue = Math.max(this.effectiveBalance * 0.05, 5);
      if (positionSize.positionValue < minPositionValue) {
        logger.debug("Position too small", {
          positionValue: positionSize.positionValue.toFixed(2),
          minRequired: minPositionValue.toFixed(2),
          effectiveBalance: this.effectiveBalance.toFixed(2),
          leverage: this.leverage,
        });
        return;
      }

      this.currentPosition = {
        symbol: this.currentTopPerformer.symbol,
        entryPrice: price,
        quantity: positionSize.quantity,
        stopLoss,
        takeProfit,
        timestamp,
        positionValue: positionSize.positionValue,
        signal: signal,
      };

      // With cross margin: Don't subtract position value, just track the position
      // Balance only changes when position is closed (via net profit/loss)
      if (this.marginMode === "isolated") {
        this.balance -= positionSize.positionValue; // Only subtract for isolated margin
      }
      // For cross margin, balance remains unchanged until position closes

      logger.info("Ultra position opened", {
        symbol: this.currentPosition.symbol,
        entryPrice: price.toFixed(4),
        quantity: positionSize.quantity.toFixed(6),
        positionValue: positionSize.positionValue.toFixed(2),
        stopLoss: stopLoss.toFixed(4),
        takeProfit: takeProfit.toFixed(4),
        score: signal.score,
        setup: signal.setup,
        leverage: positionSize.leverage,
        marginMode: positionSize.marginMode,
        effectiveBalance: positionSize.effectiveBalance.toFixed(2),
        actualRisk: positionSize.actualRisk.toFixed(2),
        debug: positionSize.debug,
      });
    } catch (error) {
      logger.error("Failed to open ultra position", { error: error.message });
    }
  }

  /**
   * Close a position with ultra-enhanced tracking
   */
  async closePosition(reason, exitPrice = null, timestamp = null) {
    if (!this.currentPosition) return;

    try {
      const actualExitPrice = exitPrice || this.currentPosition.stopLoss;
      const actualTimestamp = timestamp || Date.now();

      const profit =
        (actualExitPrice - this.currentPosition.entryPrice) *
        this.currentPosition.quantity;
      const profitPercent =
        ((actualExitPrice - this.currentPosition.entryPrice) /
          this.currentPosition.entryPrice) *
        100;

      const fees = this.currentPosition.positionValue * 0.002;
      const netProfit = profit - fees;

      // With leverage: only add net profit to actual balance
      this.balance += netProfit;
      this.effectiveBalance = this.balance * this.leverage; // Update effective balance

      const trade = {
        symbol: this.currentPosition.symbol,
        entryPrice: this.currentPosition.entryPrice,
        exitPrice: actualExitPrice,
        quantity: this.currentPosition.quantity,
        profit: netProfit,
        profitPercent,
        fees,
        reason,
        entryTime: this.currentPosition.timestamp,
        exitTime: actualTimestamp,
        duration: actualTimestamp - this.currentPosition.timestamp,
        signal: this.currentPosition.signal,
      };

      this.trades.push(trade);
      this.stats.totalTrades++;

      // Track ultra-quality trades
      if (this.currentPosition.signal?.score >= 15) {
        this.stats.ultraQualityTrades++;
      }

      // Update consecutive win/loss tracking
      if (netProfit > 0) {
        this.stats.winningTrades++;
        this.stats.consecutiveWins++;
        this.stats.consecutiveLosses = 0;
        this.stats.largestWin = Math.max(this.stats.largestWin, netProfit);
        this.stats.maxConsecutiveWins = Math.max(
          this.stats.maxConsecutiveWins,
          this.stats.consecutiveWins
        );
      } else {
        this.stats.losingTrades++;
        this.stats.consecutiveLosses++;
        this.stats.consecutiveWins = 0;
        this.stats.largestLoss = Math.min(this.stats.largestLoss, netProfit);
        this.stats.maxConsecutiveLosses = Math.max(
          this.stats.maxConsecutiveLosses,
          this.stats.consecutiveLosses
        );
      }

      if (this.balance > this.stats.maxBalance) {
        this.stats.maxBalance = this.balance;
      }

      const currentDrawdown =
        ((this.stats.maxBalance - this.balance) / this.stats.maxBalance) * 100;
      this.stats.maxDrawdown = Math.max(
        this.stats.maxDrawdown,
        currentDrawdown
      );

      logger.debug("Ultra position closed", {
        symbol: this.currentPosition.symbol,
        entryPrice: this.currentPosition.entryPrice.toFixed(4),
        exitPrice: actualExitPrice.toFixed(4),
        profit: netProfit.toFixed(2),
        profitPercent: profitPercent.toFixed(2) + "%",
        reason,
        consecutiveWins: this.stats.consecutiveWins,
        consecutiveLosses: this.stats.consecutiveLosses,
      });

      this.currentPosition = null;
    } catch (error) {
      logger.error("Failed to close ultra position", { error: error.message });
    }
  }

  /**
   * Calculate ultra-enhanced final statistics
   */
  calculateFinalStatistics() {
    if (this.stats.totalTrades === 0) return;

    this.stats.winRate =
      (this.stats.winningTrades / this.stats.totalTrades) * 100;

    const winningTrades = this.trades.filter((t) => t.profit > 0);
    const losingTrades = this.trades.filter((t) => t.profit < 0);

    const totalWins = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalLosses = Math.abs(
      losingTrades.reduce((sum, t) => sum + t.profit, 0)
    );

    this.stats.profitFactor =
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    this.stats.avgWin =
      winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    this.stats.avgLoss =
      losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

    // Calculate average trade duration
    const totalDuration = this.trades.reduce((sum, t) => sum + t.duration, 0);
    this.stats.avgTradeDuration = totalDuration / this.trades.length;

    // Calculate Sharpe ratio
    const returns = this.trades.map((t) => t.profitPercent);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);
    this.stats.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    this.stats.totalProfit = this.balance - this.initialBalance;
  }

  /**
   * Display ultra-enhanced results
   */
  displayUltraResults() {
    logger.info("=".repeat(80));
    logger.info("🚀 ULTRA-OPTIMIZED TOP PERFORMER SCALPING BACKTEST RESULTS");
    logger.info("=".repeat(80));

    logger.info("📊 PERFORMANCE SUMMARY", {
      "Initial Balance": "$" + this.initialBalance.toFixed(2),
      "Final Balance": "$" + this.balance.toFixed(2),
      "Total Profit": "$" + this.stats.totalProfit.toFixed(2),
      "Total Return":
        (
          ((this.balance - this.initialBalance) / this.initialBalance) *
          100
        ).toFixed(2) + "%",
      "Max Drawdown": this.stats.maxDrawdown.toFixed(2) + "%",
      "Sharpe Ratio": this.stats.sharpeRatio.toFixed(2),
    });

    logger.info("📈 ULTRA TRADING STATISTICS", {
      "Total Trades": this.stats.totalTrades,
      "Winning Trades": this.stats.winningTrades,
      "Losing Trades": this.stats.losingTrades,
      "Win Rate": this.stats.winRate.toFixed(2) + "%",
      "Profit Factor": this.stats.profitFactor.toFixed(2),
      "Average Win": "$" + this.stats.avgWin.toFixed(2),
      "Average Loss": "$" + this.stats.avgLoss.toFixed(2),
      "Largest Win": "$" + this.stats.largestWin.toFixed(2),
      "Largest Loss": "$" + this.stats.largestLoss.toFixed(2),
      "Max Consecutive Wins": this.stats.maxConsecutiveWins,
      "Max Consecutive Losses": this.stats.maxConsecutiveLosses,
      "Average Trade Duration":
        Math.round(this.stats.avgTradeDuration / 1000) + "s",
      "Ultra Quality Trades": this.stats.ultraQualityTrades,
    });

    logger.info("📅 DAILY PERFORMANCE", {
      "Profitable Days": this.stats.profitableDays,
      "Losing Days": this.stats.losingDays,
      "Win Rate (Days)":
        (
          (this.stats.profitableDays /
            (this.stats.profitableDays + this.stats.losingDays)) *
          100
        ).toFixed(2) + "%",
    });

    logger.info("🏆 TOP PERFORMER ANALYSIS", {
      "Top Performer Switches": this.topPerformerHistory.length,
      "Symbols Traded": [
        ...new Set(this.topPerformerHistory.map((tp) => tp.symbol)),
      ].length,
      "Symbols List": [
        ...new Set(this.topPerformerHistory.map((tp) => tp.symbol)),
      ].join(", "),
    });

    logger.info("📅 TOP PERFORMERS BY DAY");
    this.topPerformerHistory.slice(-10).forEach((tp, index) => {
      logger.info(
        `Day ${index + 1}: ${tp.symbol} (${
          tp.performance > 0 ? "+" : ""
        }${tp.performance.toFixed(2)}%)`
      );
    });

    logger.info("💼 RECENT TRADES");
    this.trades.slice(-5).forEach((trade, index) => {
      const profitColor = trade.profit > 0 ? "🟢" : "🔴";
      logger.info(
        `${profitColor} ${trade.symbol}: ${trade.profitPercent.toFixed(2)}% (${
          trade.reason
        }) - Score: ${trade.signal?.score || "N/A"}`
      );
    });

    logger.info("=".repeat(80));

    const totalReturn =
      ((this.balance - this.initialBalance) / this.initialBalance) * 100;
    let rating = "❌ POOR";

    if (totalReturn > 25 && this.stats.winRate > 65)
      rating = "🌟 ULTRA EXCELLENT";
    else if (totalReturn > 15 && this.stats.winRate > 60)
      rating = "🌟 EXCELLENT";
    else if (totalReturn > 10 && this.stats.winRate > 55) rating = "✅ GOOD";
    else if (totalReturn > 5 && this.stats.winRate > 50) rating = "👍 DECENT";
    else if (totalReturn > 0 && this.stats.winRate > 45) rating = "⚠️ MARGINAL";

    logger.info(
      `🎯 OVERALL RATING: ${rating} (${totalReturn.toFixed(
        2
      )}% return, ${this.stats.winRate.toFixed(2)}% win rate)`
    );
    logger.info("=".repeat(80));
  }
}

// Main execution
(async () => {
  const backtest = new UltraTopPerformerBacktest();

  try {
    await backtest.initialize();
    await backtest.runBacktest();
  } catch (error) {
    logger.error("Ultra-optimized backtest failed", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
})();
