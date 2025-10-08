#!/usr/bin/env node

import ccxt from "ccxt";
import config from "./config.js";
import logger from "./logger.js";
import TradingStrategy from "./strategy.js";
import SMCStrategy from "./smc-strategy.js";
import SMCStrategyRefined from "./smc-strategy-refined.js";
import ScalpingStrategy from "./scalping-strategy.js";
import { setupDNS } from "./dns-setup.js";
import fs from "fs";
import path from "path";

/**
 * Backtesting Module
 */
class Backtester {
  constructor() {
    this.config = config;

    // Select strategy based on config
    if (config.strategyType === "SCALPING") {
      this.strategy = new ScalpingStrategy(config);
      this.strategyName = "Scalping Strategy (High Frequency)";
    } else if (config.strategyType === "SMC_REFINED") {
      this.strategy = new SMCStrategyRefined(config);
      this.strategyName = "Smart Money Concepts - REFINED (Advanced)";
    } else if (config.strategyType === "SMC") {
      this.strategy = new SMCStrategy(config);
      this.strategyName = "Smart Money Concepts (Basic)";
    } else {
      this.strategy = new TradingStrategy(config);
      this.strategyName = "RSI + EMA Crossover";
    }

    // Configure exchange with better error handling and proxy support
    const exchangeOptions = {
      enableRateLimit: true,
      timeout: 30000, // 30 second timeout
      // Add proxy support if needed (set HTTPS_PROXY env variable)
      ...(process.env.HTTPS_PROXY && {
        proxy: process.env.HTTPS_PROXY,
        httpsAgent: process.env.HTTPS_PROXY,
      }),
    };

    // For Windows SSL issues, allow agent options
    if (
      process.platform === "win32" &&
      !process.env.NODE_TLS_REJECT_UNAUTHORIZED
    ) {
      // Log that we're using default SSL settings
      console.log("Using system SSL certificates (Windows)");
    }

    // Use exchange from config (supports multiple exchanges)
    const exchangeId = config.exchange.id || "binance";
    console.log(`Using exchange: ${exchangeId}`);

    if (!ccxt[exchangeId]) {
      throw new Error(
        `Exchange '${exchangeId}' not supported. Available: ${Object.keys(
          ccxt.exchanges
        )
          .slice(0, 10)
          .join(", ")}...`
      );
    }

    this.exchange = new ccxt[exchangeId](exchangeOptions);

    this.results = {
      trades: [],
      balance: config.trading.initialBalance,
      initialBalance: config.trading.initialBalance,
      peakBalance: config.trading.initialBalance,
      maxDrawdown: 0,
    };
  }

  /**
   * Fetch historical candles with multi-batch support
   * Handles the 1000 candle API limit by fetching multiple batches
   */
  async fetchHistoricalCandles(symbol, timeframe, totalCandlesNeeded) {
    const BATCH_SIZE = 1000; // API limit per request
    const timeframeMs = this.getTimeframeInMs(timeframe);

    // If we need 1000 or fewer candles, fetch in one go
    if (totalCandlesNeeded <= BATCH_SIZE) {
      logger.info(`Fetching ${totalCandlesNeeded} candles in single batch...`);
      return await this.fetchCandlesBatch(
        symbol,
        timeframe,
        undefined,
        totalCandlesNeeded
      );
    }

    // Multi-batch fetch for larger datasets
    const batches = Math.ceil(totalCandlesNeeded / BATCH_SIZE);
    logger.info(
      `Fetching ${totalCandlesNeeded} candles in ${batches} batches...`
    );

    let allCandles = [];
    let since = Date.now() - totalCandlesNeeded * timeframeMs;

    for (let i = 0; i < batches; i++) {
      const batchNum = i + 1;
      logger.info(`  Batch ${batchNum}/${batches}...`);

      try {
        const batch = await this.fetchCandlesBatch(
          symbol,
          timeframe,
          since,
          BATCH_SIZE
        );

        if (!batch || batch.length === 0) {
          logger.warn(`  Batch ${batchNum} returned no data, stopping fetch`);
          break;
        }

        allCandles = allCandles.concat(batch);

        // Update 'since' to start after the last candle we got
        since = batch[batch.length - 1][0] + timeframeMs;

        // Small delay to avoid rate limits
        if (i < batches - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        logger.info(
          `  ✓ Got ${batch.length} candles (Total: ${allCandles.length})`
        );

        // Stop if we have enough
        if (allCandles.length >= totalCandlesNeeded) {
          break;
        }
      } catch (error) {
        logger.warn(`  Batch ${batchNum} failed: ${error.message}`);
        if (allCandles.length > 0) {
          logger.info(
            `  Continuing with ${allCandles.length} candles fetched so far`
          );
          break;
        }
        throw error; // If first batch fails, throw error
      }
    }

    // Remove duplicates (sometimes exchanges return overlapping data)
    const uniqueCandles = this.removeDuplicateCandles(allCandles);

    return uniqueCandles.slice(-totalCandlesNeeded); // Return most recent N candles
  }

  /**
   * Fetch a single batch of candles with retry logic
   */
  async fetchCandlesBatch(symbol, timeframe, since, limit) {
    let retries = 3;

    while (retries > 0) {
      try {
        const candles = await this.exchange.fetchOHLCV(
          symbol,
          timeframe,
          since,
          limit
        );
        return candles;
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw error;
        }
        logger.warn(`    Fetch failed, retrying... (${retries} attempts left)`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Remove duplicate candles based on timestamp
   */
  removeDuplicateCandles(candles) {
    const seen = new Set();
    return candles.filter((candle) => {
      const timestamp = candle[0];
      if (seen.has(timestamp)) {
        return false;
      }
      seen.add(timestamp);
      return true;
    });
  }

  /**
   * Get timeframe duration in milliseconds
   */
  getTimeframeInMs(timeframe) {
    const units = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };

    const value = parseInt(timeframe);
    const unit = timeframe.slice(-1);

    return value * (units[unit] || units.m);
  }

  /**
   * Run backtest
   */
  async run(symbol, timeframe, days = 30) {
    logger.info("=".repeat(60));
    logger.info("📊 Starting Backtest");
    logger.info("=".repeat(60));

    logger.info("Backtest Configuration", {
      symbol,
      timeframe,
      days,
      initialBalance: this.results.initialBalance + " USDT",
      leverage: this.config.trading.leverage + "x",
      strategy: this.strategyName,
      strategyType: this.config.strategyType,
    });

    try {
      // Calculate how many candles we need
      const candlesPerDay = this.getCandlesPerDay(timeframe);
      const totalCandlesNeeded = days * candlesPerDay;

      logger.info(
        `Fetching candles for ${days} days (${totalCandlesNeeded} candles needed)...`
      );

      // Fetch historical data (with multi-batch support)
      let candles = await this.fetchHistoricalCandles(
        symbol,
        timeframe,
        totalCandlesNeeded
      );

      if (!candles || candles.length === 0) {
        logger.error("No historical data available");
        return;
      }

      logger.info(`✅ Loaded ${candles.length} candles`);
      logger.info("─".repeat(60));
      logger.info("Running simulation...\n");

      // Run simulation
      this.simulate(candles);

      // Display results
      this.displayResults();
    } catch (error) {
      logger.error("Backtest failed");
      console.error("\n" + "=".repeat(60));
      console.error("❌ CONNECTION ERROR");
      console.error("=".repeat(60));
      console.error("\nError details:", error.message);

      if (
        error.message.includes("fetch failed") ||
        error.message.includes("Network")
      ) {
        console.error("\n🔧 Possible solutions:\n");
        console.error("1. Check your internet connection");
        console.error(
          "2. If behind a proxy, set the HTTPS_PROXY environment variable"
        );
        console.error(
          "3. Temporarily disable antivirus/firewall and try again"
        );
        console.error(
          "4. If on corporate network, API access might be blocked\n"
        );
        console.error("Windows SSL Certificate Fix:");
        console.error("Try running: npm install -g win-ca");
        console.error("Then run: win-ca-update\n");
        console.error(
          "Alternative: Set NODE_TLS_REJECT_UNAUTHORIZED=0 (NOT RECOMMENDED for production)\n"
        );
        console.error(
          "Quick test: set NODE_TLS_REJECT_UNAUTHORIZED=0 && node backtest.js"
        );
        console.error("=".repeat(60));
      }
    }
  }

  /**
   * Simulate trading
   */
  simulate(candles) {
    let position = null;
    let dailyTrades = 0;
    let dailyLoss = 0;
    const maxDailyTrades = this.config.trading.maxDailyLosses;

    // We need enough history for indicators
    const minHistory =
      Math.max(
        this.config.strategy.ema.slowPeriod,
        this.config.strategy.rsi.period
      ) + 10;

    // Progress tracking
    const progressInterval = Math.floor(candles.length / 10); // Log every 10%
    const MAX_TRADES = 500; // Safety limit to prevent runaway

    // Track last candle for closing open positions
    let lastCandle = null;
    let lastTimestamp = null;

    for (let i = minHistory; i < candles.length; i++) {
      // Safety check: stop if too many trades
      if (this.results.trades.length >= MAX_TRADES) {
        logger.warn(
          `\n⚠️  Maximum trade limit (${MAX_TRADES}) reached. Stopping simulation.`
        );
        logger.warn(
          `This usually means the strategy is too aggressive. Consider:`
        );
        logger.warn(`  - Increasing STOP_LOSS_PERCENT`);
        logger.warn(`  - Increasing MIN_SCORE for strategies`);
        logger.warn(`  - Using a larger timeframe (e.g., 1h instead of 15m)`);
        break;
      }

      // Safety check: stop if balance is too low (account blown)
      if (this.results.balance < 10) {
        logger.warn(
          `\n💀 Account balance too low ($${this.results.balance.toFixed(
            2
          )}). Stopping simulation.`
        );
        logger.warn(
          `Account blown due to losses. Check your risk management settings.`
        );
        break;
      }

      // Log progress
      if (i % progressInterval === 0 && i > minHistory) {
        const progress = ((i / candles.length) * 100).toFixed(0);
        logger.info(
          `📊 Progress: ${progress}% (${this.results.trades.length} trades so far)`
        );
      }

      const historicalCandles = candles.slice(0, i + 1);
      const currentCandle = candles[i];
      const currentPrice = currentCandle[4]; // Close price
      const timestamp = new Date(currentCandle[0]);

      // Track last values for end-of-backtest cleanup
      lastCandle = currentCandle;
      lastTimestamp = timestamp;

      // Reset daily counters (simplified - checks if new day)
      if (i > minHistory) {
        const prevTimestamp = new Date(candles[i - 1][0]);
        if (timestamp.getDate() !== prevTimestamp.getDate()) {
          dailyTrades = 0;
          dailyLoss = 0;
        }
      }

      // Check for signals
      const signal = this.strategy.analyze(historicalCandles, position);

      // Execute trades based on signals
      if (
        signal.action === "BUY" &&
        !position &&
        dailyTrades < maxDailyTrades
      ) {
        // Enter position
        const { stopLoss, takeProfit } =
          this.strategy.calculateExitPrices(currentPrice);

        // Calculate position size with leverage consideration
        const leverage = this.config.trading.leverage || 1;
        const effectiveBalance = this.results.balance * leverage;

        const positionSize = this.strategy.calculatePositionSize(
          effectiveBalance,
          currentPrice,
          stopLoss
        );

        // Check minimum position size (notional value should be >= 10)
        if (positionSize.positionValue >= 10) {
          // Calculate margin required (for leveraged positions)
          // Note: leverage was already used above, so use the same value
          const marginRequired = positionSize.positionValue / leverage;

          // Check if we have enough balance for the margin
          if (this.results.balance < marginRequired) {
            logger.warn(
              `⚠️  Insufficient balance for trade. Balance: $${this.results.balance.toFixed(
                2
              )}, Margin needed: $${marginRequired.toFixed(2)}`
            );
            continue; // Skip this trade
          }

          // Calculate entry fee (on the full position value)
          const entryFee = positionSize.positionValue * this.config.fees.maker;

          // Check if we have enough balance for margin + entry fee
          if (this.results.balance < marginRequired + entryFee) {
            logger.warn(
              `⚠️  Insufficient balance for trade + fees. Balance: $${this.results.balance.toFixed(
                2
              )}, Need: $${(marginRequired + entryFee).toFixed(2)}`
            );
            continue; // Skip this trade
          }

          position = {
            entryPrice: currentPrice,
            quantity: positionSize.quantity,
            stopLoss,
            takeProfit,
            entryTime: timestamp,
            positionValue: positionSize.positionValue,
            marginUsed: marginRequired,
            leverage: leverage,
            entryFee: entryFee,
          };

          // Deduct margin + entry fee
          this.results.balance -= marginRequired + entryFee;

          logger.debug("BUY", {
            time: timestamp.toISOString(),
            price: currentPrice.toFixed(2),
            quantity: positionSize.quantity.toFixed(6),
            value: positionSize.positionValue.toFixed(2),
            margin: marginRequired.toFixed(2),
            entryFee: entryFee.toFixed(4),
            leverage: leverage + "x",
          });
        }
      } else if (signal.action === "SELL" && position) {
        // Exit position
        const exitValue = position.quantity * currentPrice;
        const profit = exitValue - position.positionValue;
        const profitPercent = (profit / position.positionValue) * 100;

        // Apply exit fee (taker fee only, entry fee already paid)
        const exitFee = exitValue * this.config.fees.taker;
        const totalFees = position.entryFee + exitFee;

        // Return margin + profit/loss - exit fee
        this.results.balance += position.marginUsed + profit - exitFee;

        const trade = {
          entry: position.entryPrice,
          exit: currentPrice,
          quantity: position.quantity,
          profit: profit - totalFees,
          profitPercent,
          reason: signal.reason,
          entryTime: position.entryTime,
          exitTime: timestamp,
          duration: (timestamp - position.entryTime) / 1000 / 60, // minutes
          fees: totalFees,
        };

        this.results.trades.push(trade);

        if (trade.profit < 0) {
          dailyLoss += Math.abs(trade.profit);
          dailyTrades++;
        }

        logger.debug("SELL", {
          time: timestamp.toISOString(),
          price: currentPrice.toFixed(2),
          profit: trade.profit.toFixed(2),
          profitPercent: profitPercent.toFixed(2) + "%",
          fees: totalFees.toFixed(4),
          reason: signal.reason,
        });

        position = null;
      }

      // Check if we have an open position and it hits stop loss or take profit
      if (position) {
        // Check for liquidation (with leverage)
        const currentValue = position.quantity * currentPrice;
        const unrealizedPnL = currentValue - position.positionValue;
        const liquidationThreshold = -position.marginUsed * 0.9; // 90% of margin lost

        if (unrealizedPnL <= liquidationThreshold) {
          // LIQUIDATED!
          logger.warn(
            `💀 LIQUIDATION at ${currentPrice} (Leverage: ${position.leverage}x)`
          );
          this.results.balance += 0; // Lose all margin

          const trade = {
            entry: position.entryPrice,
            exit: currentPrice,
            quantity: position.quantity,
            profit: -position.marginUsed - position.entryFee,
            profitPercent: -100,
            reason: "LIQUIDATION",
            entryTime: position.entryTime,
            exitTime: timestamp,
            duration: (timestamp - position.entryTime) / 1000 / 60,
            fees: position.entryFee,
          };

          this.results.trades.push(trade);
          position = null;
        } else if (
          currentPrice <= position.stopLoss ||
          currentPrice >= position.takeProfit
        ) {
          // Position would be closed by stop loss or take profit
          const exitPrice =
            currentPrice <= position.stopLoss
              ? position.stopLoss
              : position.takeProfit;
          const exitValue = position.quantity * exitPrice;
          const profit = exitValue - position.positionValue;
          const profitPercent = (profit / position.positionValue) * 100;

          // Apply exit fee (taker fee only, entry fee already paid)
          const exitFee = exitValue * this.config.fees.taker;
          const totalFees = position.entryFee + exitFee;

          // Return margin + profit/loss - exit fee
          this.results.balance += position.marginUsed + profit - exitFee;

          const reason =
            currentPrice <= position.stopLoss ? "Stop Loss" : "Take Profit";

          const trade = {
            entry: position.entryPrice,
            exit: exitPrice,
            quantity: position.quantity,
            profit: profit - totalFees,
            profitPercent,
            reason,
            entryTime: position.entryTime,
            exitTime: timestamp,
            duration: (timestamp - position.entryTime) / 1000 / 60,
            fees: totalFees,
          };

          this.results.trades.push(trade);

          if (trade.profit < 0) {
            dailyLoss += Math.abs(trade.profit);
            dailyTrades++;
          }

          logger.debug("SELL", {
            time: timestamp.toISOString(),
            price: exitPrice.toFixed(2),
            profit: trade.profit.toFixed(2),
            profitPercent: profitPercent.toFixed(2) + "%",
            fees: totalFees.toFixed(4),
            reason,
          });

          position = null;
        }
      }

      // Track drawdown
      if (this.results.balance > this.results.peakBalance) {
        this.results.peakBalance = this.results.balance;
      }

      const drawdown =
        ((this.results.peakBalance - this.results.balance) /
          this.results.peakBalance) *
        100;
      if (drawdown > this.results.maxDrawdown) {
        this.results.maxDrawdown = drawdown;
      }
    }

    // Close any remaining open position at the end of backtest
    if (position && lastCandle) {
      const currentPrice = lastCandle[4];
      logger.warn("⚠️  Closing open position at end of backtest period", {
        entryPrice: position.entryPrice.toFixed(2),
        exitPrice: currentPrice.toFixed(2),
        marginLocked: position.marginUsed.toFixed(2),
      });

      const exitValue = position.quantity * currentPrice;
      const profit = exitValue - position.positionValue;
      const exitFee = exitValue * this.config.fees.taker;
      const totalFees = position.entryFee + exitFee;

      // Return margin + profit/loss - exit fee
      this.results.balance += position.marginUsed + profit - exitFee;

      const trade = {
        entry: position.entryPrice,
        exit: currentPrice,
        quantity: position.quantity,
        profit: profit - totalFees,
        profitPercent: (profit / position.positionValue) * 100,
        reason: "End of backtest period",
        entryTime: position.entryTime,
        exitTime: lastTimestamp,
        duration: (lastTimestamp - position.entryTime) / 1000 / 60,
        fees: totalFees,
      };

      this.results.trades.push(trade);

      logger.info("📌 Position closed at end", {
        profit: trade.profit.toFixed(2),
        balanceAfter: this.results.balance.toFixed(2),
      });

      position = null;
    }
  }

  /**
   * Display backtest results
   */
  displayResults() {
    const trades = this.results.trades;
    const totalTrades = trades.length;

    logger.info(`\n📊 Processing ${totalTrades} trades...`);

    if (totalTrades === 0) {
      logger.warn("No trades executed during backtest period");
      return;
    }

    if (totalTrades > 1000) {
      logger.warn(
        `⚠️  Warning: ${totalTrades} trades detected. This may take a while...`
      );
    }

    const winningTrades = trades.filter((t) => t.profit > 0);
    const losingTrades = trades.filter((t) => t.profit < 0);
    const winRate = (winningTrades.length / totalTrades) * 100;

    const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
    const totalFees = trades.reduce((sum, t) => sum + (t.fees || 0), 0);
    const avgProfit = totalProfit / totalTrades;
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.profit, 0) /
          winningTrades.length
        : 0;
    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.profit, 0) /
          losingTrades.length
        : 0;

    const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
    const finalBalance = this.results.balance;
    const totalReturn =
      ((finalBalance - this.results.initialBalance) /
        this.results.initialBalance) *
      100;

    const avgDuration =
      trades.reduce((sum, t) => sum + t.duration, 0) / totalTrades;

    console.log("\n" + "=".repeat(60));
    console.log("📊 BACKTEST RESULTS");
    console.log("=".repeat(60));

    console.log("\n💰 Performance:");
    console.log(
      `   Initial Balance:    ${this.results.initialBalance.toFixed(2)} USDT`
    );
    console.log(`   Final Balance:      ${finalBalance.toFixed(2)} USDT`);
    console.log(`   Total Profit/Loss:  ${totalProfit.toFixed(2)} USDT`);
    console.log(`   Total Fees Paid:    ${totalFees.toFixed(2)} USDT`);
    console.log(`   Total Return:       ${totalReturn.toFixed(2)}%`);
    console.log(
      `   Max Drawdown:       ${this.results.maxDrawdown.toFixed(2)}%`
    );

    console.log("\n📈 Trade Statistics:");
    console.log(`   Total Trades:       ${totalTrades}`);
    console.log(`   Winning Trades:     ${winningTrades.length}`);
    console.log(`   Losing Trades:      ${losingTrades.length}`);
    console.log(`   Win Rate:           ${winRate.toFixed(2)}%`);
    console.log(`   Profit Factor:      ${profitFactor.toFixed(2)}`);

    console.log("\n💵 Trade Metrics:");
    console.log(`   Average Profit:     ${avgProfit.toFixed(2)} USDT`);
    console.log(`   Average Win:        ${avgWin.toFixed(2)} USDT`);
    console.log(`   Average Loss:       ${avgLoss.toFixed(2)} USDT`);
    console.log(`   Avg Duration:       ${avgDuration.toFixed(0)} minutes`);

    console.log("\n🔝 Best/Worst Trades:");
    const bestTrade = trades.reduce(
      (max, t) => (t.profit > max.profit ? t : max),
      trades[0]
    );
    const worstTrade = trades.reduce(
      (min, t) => (t.profit < min.profit ? t : min),
      trades[0]
    );
    console.log(
      `   Best Trade:         ${bestTrade.profit.toFixed(
        2
      )} USDT (${bestTrade.profitPercent.toFixed(2)}%)`
    );
    console.log(
      `   Worst Trade:        ${worstTrade.profit.toFixed(
        2
      )} USDT (${worstTrade.profitPercent.toFixed(2)}%)`
    );

    console.log("\n" + "=".repeat(60));

    console.log("\n📝 Interpretation:");
    if (totalReturn > 0) {
      console.log(
        `   ✅ Profitable strategy with ${totalReturn.toFixed(2)}% return`
      );
    } else {
      console.log(
        `   ❌ Unprofitable strategy with ${totalReturn.toFixed(2)}% loss`
      );
    }
    console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log("\n" + "=".repeat(60));

    // Save results to file
    this.saveResultsToFile({
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalProfit,
      totalFees,
      avgProfit,
      avgWin,
      avgLoss,
      profitFactor,
      finalBalance,
      totalReturn,
      avgDuration,
      bestTrade,
      worstTrade,
    });
  }

  /**
   * Save backtest results to log file
   */
  saveResultsToFile(metrics) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logDir = path.join(process.cwd(), "logs");
      const logFile = path.join(logDir, "backtest-results.log");

      // Create summary object
      const result = {
        timestamp: new Date().toISOString(),
        strategy: this.strategyName,
        strategyType: this.config.strategyType,
        config: {
          symbol: process.argv[2] || this.config.trading.symbol,
          timeframe: process.argv[3] || this.config.trading.timeframe,
          days: parseInt(process.argv[4]) || this.config.trading.backtestDays,
          initialBalance: this.results.initialBalance,
          leverage: this.config.trading.leverage,
        },
        performance: {
          finalBalance: metrics.finalBalance,
          totalReturn: parseFloat(metrics.totalReturn.toFixed(2)),
          totalProfitLoss: parseFloat(metrics.totalProfit.toFixed(2)),
          totalFees: parseFloat(metrics.totalFees.toFixed(2)),
          maxDrawdown: parseFloat(this.results.maxDrawdown.toFixed(2)),
        },
        statistics: {
          totalTrades: metrics.totalTrades,
          winningTrades: metrics.winningTrades,
          losingTrades: metrics.losingTrades,
          winRate: parseFloat(metrics.winRate.toFixed(2)),
          profitFactor: parseFloat(metrics.profitFactor.toFixed(2)),
        },
        tradeMetrics: {
          avgProfit: parseFloat(metrics.avgProfit.toFixed(2)),
          avgWin: parseFloat(metrics.avgWin.toFixed(2)),
          avgLoss: parseFloat(metrics.avgLoss.toFixed(2)),
          avgDuration: parseFloat(metrics.avgDuration.toFixed(0)),
        },
        bestWorst: {
          bestTrade: {
            profit: parseFloat(metrics.bestTrade.profit.toFixed(2)),
            profitPercent: parseFloat(
              metrics.bestTrade.profitPercent.toFixed(2)
            ),
          },
          worstTrade: {
            profit: parseFloat(metrics.worstTrade.profit.toFixed(2)),
            profitPercent: parseFloat(
              metrics.worstTrade.profitPercent.toFixed(2)
            ),
          },
        },
        interpretation: {
          profitable: metrics.totalReturn > 0,
          goodWinRate: metrics.winRate >= 50,
          acceptableDrawdown: this.results.maxDrawdown <= 20,
        },
      };

      // Format as readable text
      const logEntry = `
${"=".repeat(80)}
BACKTEST RESULTS - ${result.timestamp}
${"=".repeat(80)}

STRATEGY: ${result.strategy}
TYPE: ${result.strategyType}

CONFIG:
  Symbol: ${result.config.symbol}
  Timeframe: ${result.config.timeframe}
  Period: ${result.config.days} days
  Initial Balance: ${result.config.initialBalance} USDT
  Leverage: ${result.config.leverage}x

PERFORMANCE:
  Final Balance: ${result.performance.finalBalance.toFixed(2)} USDT
  Total Return: ${result.performance.totalReturn}%
  Total P/L: ${result.performance.totalProfitLoss} USDT
  Total Fees: ${result.performance.totalFees.toFixed(2)} USDT
  Max Drawdown: ${result.performance.maxDrawdown}%

STATISTICS:
  Total Trades: ${result.statistics.totalTrades}
  Winning: ${result.statistics.winningTrades}
  Losing: ${result.statistics.losingTrades}
  Win Rate: ${result.statistics.winRate}%
  Profit Factor: ${result.statistics.profitFactor}

TRADE METRICS:
  Avg Profit: ${result.tradeMetrics.avgProfit} USDT
  Avg Win: ${result.tradeMetrics.avgWin} USDT
  Avg Loss: ${result.tradeMetrics.avgLoss} USDT
  Avg Duration: ${result.tradeMetrics.avgDuration} minutes

BEST/WORST:
  Best Trade: ${result.bestWorst.bestTrade.profit} USDT (${
        result.bestWorst.bestTrade.profitPercent
      }%)
  Worst Trade: ${result.bestWorst.worstTrade.profit} USDT (${
        result.bestWorst.worstTrade.profitPercent
      }%)

INTERPRETATION:
  Profitable: ${result.interpretation.profitable ? "YES ✅" : "NO ❌"}
  Good Win Rate: ${result.interpretation.goodWinRate ? "YES ✅" : "NO ⚠️"}
  Safe Drawdown: ${
    result.interpretation.acceptableDrawdown ? "YES ✅" : "NO ⚠️"
  }

${"=".repeat(80)}

`;

      // Append to log file
      fs.appendFileSync(logFile, logEntry);

      // Also save as JSON for analysis
      const jsonFile = path.join(logDir, `backtest-${timestamp}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2));

      console.log(`\n💾 Results saved to:`);
      console.log(`   ${logFile}`);
      console.log(`   ${jsonFile}`);
    } catch (error) {
      logger.error("Failed to save backtest results", {
        error: error.message,
      });
    }
  }

  /**
   * Get number of candles per day based on timeframe
   */
  getCandlesPerDay(timeframe) {
    const minutes =
      {
        "1m": 1,
        "5m": 5,
        "15m": 15,
        "1h": 60,
        "4h": 240,
        "1d": 1440,
      }[timeframe] || 5;

    return Math.floor(1440 / minutes);
  }
}

// Run backtest
(async () => {
  // Setup DNS to bypass ISP blocks (if DNS_PROVIDER env var is set)
  const dnsProvider =
    process.env.DNS_PROVIDER || process.env.USE_GOOGLE_DNS === "true"
      ? "google"
      : null;
  if (dnsProvider) {
    setupDNS(dnsProvider);
  }

  const backtester = new Backtester();

  // You can customize these parameters (command line > env > config default)
  const symbol = process.argv[2] || config.trading.symbol;
  const timeframe = process.argv[3] || config.trading.timeframe;
  const days = parseInt(process.argv[4]) || config.trading.backtestDays;

  await backtester.run(symbol, timeframe, days);
  process.exit(0);
})();
