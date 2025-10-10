import dotenv from "dotenv";
dotenv.config({ path: "./env.upbit-listing" });
import ccxt from "ccxt";
import logger from "./logger.js";
import axios from "axios";

// Performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      detectionLatency: [],
      orderExecutionTime: [],
      totalLatency: [],
      detectionCount: 0,
      orderSuccessCount: 0,
      orderFailureCount: 0,
    };
  }

  recordDetection(latencyMs) {
    this.metrics.detectionLatency.push(latencyMs);
    this.metrics.detectionCount++;
  }

  recordOrderExecution(latencyMs, success = true) {
    this.metrics.orderExecutionTime.push(latencyMs);
    if (success) {
      this.metrics.orderSuccessCount++;
    } else {
      this.metrics.orderFailureCount++;
    }
  }

  recordTotalLatency(latencyMs) {
    this.metrics.totalLatency.push(latencyMs);
  }

  getStats() {
    const avg = (arr) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const min = (arr) => (arr.length > 0 ? Math.min(...arr) : 0);
    const max = (arr) => (arr.length > 0 ? Math.max(...arr) : 0);

    return {
      detections: this.metrics.detectionCount,
      orders: {
        success: this.metrics.orderSuccessCount,
        failed: this.metrics.orderFailureCount,
        total: this.metrics.orderSuccessCount + this.metrics.orderFailureCount,
      },
      latency: {
        detection: {
          avg: avg(this.metrics.detectionLatency).toFixed(2),
          min: min(this.metrics.detectionLatency).toFixed(2),
          max: max(this.metrics.detectionLatency).toFixed(2),
        },
        orderExecution: {
          avg: avg(this.metrics.orderExecutionTime).toFixed(2),
          min: min(this.metrics.orderExecutionTime).toFixed(2),
          max: max(this.metrics.orderExecutionTime).toFixed(2),
        },
        total: {
          avg: avg(this.metrics.totalLatency).toFixed(2),
          min: min(this.metrics.totalLatency).toFixed(2),
          max: max(this.metrics.totalLatency).toFixed(2),
        },
      },
    };
  }

  logStats() {
    const stats = this.getStats();
    logger.info("📊 PERFORMANCE STATS:");
    logger.info(`   Detections: ${stats.detections}`);
    logger.info(
      `   Orders: ${stats.orders.success}/${stats.orders.total} successful`
    );
    logger.info(
      `   Detection Latency: ${stats.latency.detection.avg}ms avg (${stats.latency.detection.min}-${stats.latency.detection.max}ms)`
    );
    logger.info(
      `   Order Execution: ${stats.latency.orderExecution.avg}ms avg (${stats.latency.orderExecution.min}-${stats.latency.orderExecution.max}ms)`
    );
    logger.info(
      `   Total Latency: ${stats.latency.total.avg}ms avg (${stats.latency.total.min}-${stats.latency.total.max}ms)`
    );
  }
}

// Configuration
const config = {
  // Upbit API configuration
  upbitApiUrl: "https://api.upbit.com/v1/market/all",
  pollIntervalSeconds: parseInt(process.env.UPBIT_API_POLL_INTERVAL) || 1, // 1 second default

  // Bybit API credentials
  bybitApiKey: process.env.BYBIT_API_KEY,
  bybitApiSecret: process.env.BYBIT_API_SECRET,

  // Trading parameters
  useAccountPercentage: process.env.USE_ACCOUNT_PERCENTAGE !== "false",
  accountPercentage: parseFloat(process.env.ACCOUNT_PERCENTAGE) || 10,
  orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 10,
  leverage: parseFloat(process.env.LEVERAGE) || 10,
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 5,
  sellAfterSeconds: parseInt(process.env.SELL_AFTER_SECONDS) || 60,
  maxOrdersPerDay: parseInt(process.env.MAX_ORDERS_PER_DAY) || 5,

  // Performance optimization
  preconnectBybit: true, // Keep connection warm
  parallelExecution: true, // Execute non-critical tasks in parallel
};

// Upbit Listing Detector
class UpbitListingDetector {
  constructor(config) {
    this.config = config;
    this.knownMarkets = new Set();
    this.isInitialized = false;
    this.isRunning = false;
    this.pollInterval = null;
    this.bybitClient = null;
    this.performance = new PerformanceMonitor();

    // Trading state
    this.openPositions = new Map();
    this.sellTimers = new Map();
    this.ordersPlacedToday = 0;
    this.lastResetDate = new Date().toDateString();
    this.accountBalance = 0;

    // Optimization: Pre-cache Bybit markets
    this.bybitMarketsCache = null;
    this.bybitMarketsCacheTime = 0;
    this.lastBalanceUpdate = 0;
    this.cachedOrderAmount = 0;

    // Error tracking for fallback logic
    this.consecutiveErrors = 0;
    this.lastSuccessfulCheck = Date.now();

    // Axios instance for faster Upbit API calls
    this.upbitApi = axios.create({
      baseURL: "https://api.upbit.com",
      timeout: 3000, // 3 second timeout
      headers: {
        Accept: "application/json",
      },
    });
  }

  // Initialize Bybit client with optimizations
  async initializeBybit() {
    try {
      logger.info("🔧 Initializing Bybit API client...");

      this.bybitClient = new ccxt.bybit({
        apiKey: this.config.bybitApiKey,
        secret: this.config.bybitApiSecret,
        enableRateLimit: false, // We handle rate limiting ourselves for speed
        options: {
          defaultType: "swap", // USDT perpetual futures
          adjustForTimeDifference: true,
          recvWindow: 10000, // Faster timeout
        },
        timeout: 5000, // 5 second API timeout
      });

      // Pre-load markets to cache
      logger.info("📥 Pre-loading Bybit markets...");
      await this.bybitClient.loadMarkets();
      this.bybitMarketsCache = this.bybitClient.markets;
      this.bybitMarketsCacheTime = Date.now();
      logger.info(
        `✅ Cached ${Object.keys(this.bybitMarketsCache).length} Bybit markets`
      );

      // Fetch initial account balance
      if (this.config.useAccountPercentage) {
        await this.updateAccountBalance();
      }

      // Keep connection warm with periodic pings
      if (this.config.preconnectBybit) {
        setInterval(async () => {
          try {
            await this.bybitClient.fetchTime();
          } catch (e) {
            // Ignore ping errors
          }
        }, 30000); // Every 30 seconds
        logger.info("✅ Bybit keep-alive enabled");
      }

      logger.info("✅ Bybit API initialized successfully");
      return true;
    } catch (error) {
      logger.error("❌ Failed to initialize Bybit:", error.message);
      throw error;
    }
  }

  // Update account balance
  async updateAccountBalance() {
    try {
      const balance = await this.bybitClient.fetchBalance();
      this.accountBalance = balance.USDT?.free || 0;
      this.cachedOrderAmount =
        (this.accountBalance * this.config.accountPercentage) / 100;
      this.lastBalanceUpdate = Date.now();

      logger.info(`💰 Balance: ${this.accountBalance.toFixed(2)} USDT`);
      logger.info(
        `💰 Per Trade (${
          this.config.accountPercentage
        }%): ${this.cachedOrderAmount.toFixed(2)} USDT`
      );
      return this.accountBalance;
    } catch (error) {
      logger.error("Failed to fetch balance:", error.message);
      this.config.useAccountPercentage = false;
      return 0;
    }
  }

  // Get order amount (cached for speed)
  async getOrderAmount() {
    if (this.config.useAccountPercentage) {
      // Update balance every 60 seconds
      const now = Date.now();
      if (now - this.lastBalanceUpdate > 60000) {
        await this.updateAccountBalance();
      }
      return this.cachedOrderAmount;
    }
    return this.config.orderAmount;
  }

  // Initialize: Load current Upbit markets
  async initialize() {
    try {
      logger.info("🔄 Fetching current Upbit markets...");
      const response = await this.upbitApi.get("/v1/market/all");
      const markets = response.data;

      // Store all current market codes
      markets.forEach((market) => {
        this.knownMarkets.add(market.market);
      });

      logger.info(
        `✅ Initialized with ${this.knownMarkets.size} known markets`
      );
      logger.info(
        `📊 Sample markets: ${Array.from(this.knownMarkets)
          .slice(0, 5)
          .join(", ")}...`
      );

      this.isInitialized = true;
      return true;
    } catch (error) {
      logger.error("❌ Failed to initialize Upbit markets:", error.message);
      throw error;
    }
  }

  // Check for new listings with retry logic
  async checkForNewListings() {
    const checkStartTime = Date.now();
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        // Fetch current markets from Upbit
        const response = await this.upbitApi.get("/v1/market/all");
        const markets = response.data;

        const currentMarkets = new Set(markets.map((m) => m.market));

        // Find new markets (not in our known set)
        const newMarkets = markets.filter(
          (market) => !this.knownMarkets.has(market.market)
        );

        if (newMarkets.length > 0) {
          const detectionLatency = Date.now() - checkStartTime;
          this.performance.recordDetection(detectionLatency);

          for (const market of newMarkets) {
            await this.handleNewListing(market, checkStartTime);
          }

          // Update known markets
          newMarkets.forEach((m) => this.knownMarkets.add(m.market));
        }

        // Success - reset error count
        this.consecutiveErrors = 0;
        return;
      } catch (error) {
        retries++;

        if (error.response && error.response.status === 429) {
          logger.warn(
            `⚠️  Rate limit hit (attempt ${retries}/${maxRetries}), waiting...`
          );
          await this.sleep(2000 * retries); // Exponential backoff
        } else if (
          error.code === "ECONNREFUSED" ||
          error.code === "ETIMEDOUT"
        ) {
          logger.warn(
            `⚠️  Connection error (attempt ${retries}/${maxRetries}): ${error.message}`
          );
          await this.sleep(1000 * retries);
        } else {
          logger.error(
            `❌ Error checking markets (attempt ${retries}/${maxRetries}):`,
            error.message
          );

          if (retries >= maxRetries) {
            this.consecutiveErrors++;

            // If too many consecutive errors, slow down polling
            if (this.consecutiveErrors >= 5) {
              logger.warn(
                "⚠️  Too many errors, slowing down polling temporarily..."
              );
              await this.sleep(10000); // Wait 10 seconds
              this.consecutiveErrors = 0;
            }
          } else {
            await this.sleep(500 * retries);
          }
        }
      }
    }
  }

  // Helper: Sleep function
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Handle new listing detected
  async handleNewListing(market, detectionStartTime) {
    const orderStartTime = Date.now();

    try {
      logger.info("🚨 NEW LISTING DETECTED! 🚨");
      logger.info(`   Market: ${market.market}`);
      logger.info(`   Name: ${market.english_name} (${market.korean_name})`);

      // Extract token symbol from market code
      // Upbit format: "KRW-BTC", "USDT-ETH", etc.
      const [quote, base] = market.market.split("-");
      const tokenSymbol = base; // The actual token (BTC, ETH, etc.)

      logger.info(`   Token: ${tokenSymbol}`);

      // Check if available on Bybit
      const bybitSymbol = await this.findBybitSymbol(tokenSymbol);

      if (!bybitSymbol) {
        logger.warn(
          `   ⚠️  ${tokenSymbol} not available on Bybit, skipping trade`
        );
        return;
      }

      // Execute trade with performance tracking
      await this.executeTrade(bybitSymbol, orderStartTime, detectionStartTime);
    } catch (error) {
      const totalLatency = Date.now() - detectionStartTime;
      this.performance.recordOrderExecution(Date.now() - orderStartTime, false);
      this.performance.recordTotalLatency(totalLatency);

      logger.error(
        `❌ Error handling listing in ${totalLatency}ms:`,
        error.message
      );
    }
  }

  // Find matching Bybit perpetual symbol (OPTIMIZED)
  async findBybitSymbol(tokenSymbol) {
    try {
      // Use cached markets
      const markets = this.bybitMarketsCache || this.bybitClient.markets;

      // Try common perpetual formats
      const possibleSymbols = [
        `${tokenSymbol}/USDT:USDT`, // Standard USDT perpetual
        `${tokenSymbol}/USD:${tokenSymbol}`, // Inverse perpetual
        `${tokenSymbol}/USDT`, // Spot (fallback)
      ];

      for (const symbol of possibleSymbols) {
        if (markets[symbol] && markets[symbol].type === "swap") {
          logger.info(`   ✅ Found on Bybit: ${symbol}`);
          return symbol;
        }
      }

      return null;
    } catch (error) {
      logger.error("Error finding Bybit symbol:", error.message);
      return null;
    }
  }

  // Execute trade with optimized speed
  async executeTrade(symbol, orderStartTime, detectionStartTime) {
    try {
      // Check daily limit
      const today = new Date().toDateString();
      if (this.lastResetDate !== today) {
        this.ordersPlacedToday = 0;
        this.lastResetDate = today;
      }

      if (this.ordersPlacedToday >= this.config.maxOrdersPerDay) {
        logger.warn(
          `   ⚠️  Daily limit reached (${this.config.maxOrdersPerDay}), skipping`
        );
        return;
      }

      // CRITICAL SPEED OPTIMIZATION: Fetch ticker and order amount in parallel
      const [orderAmount, ticker] = await Promise.all([
        this.getOrderAmount(),
        this.bybitClient.fetchTicker(symbol),
      ]);

      const currentPrice = ticker.last;
      const orderSize = (orderAmount * this.config.leverage) / currentPrice;
      const amount = this.bybitClient.amountToPrecision(symbol, orderSize);

      logger.info(
        `   🎯 EXECUTING: ${amount} ${symbol} @ $${currentPrice} | ${this.config.leverage}x`
      );

      // CRITICAL: Set leverage async (don't wait)
      this.bybitClient.setLeverage(this.config.leverage, symbol).catch(() => {
        /* Ignore - leverage might already be set */
      });

      // CRITICAL: Place market order IMMEDIATELY
      const order = await this.bybitClient.createMarketBuyOrder(symbol, amount);

      const orderExecutionTime = Date.now() - orderStartTime;
      const totalLatency = Date.now() - detectionStartTime;

      this.performance.recordOrderExecution(orderExecutionTime, true);
      this.performance.recordTotalLatency(totalLatency);

      this.ordersPlacedToday++;

      logger.info(`   ✅ ORDER PLACED!`);
      logger.info(`      Order ID: ${order.id}`);
      logger.info(`      Detection → Order: ${totalLatency}ms`);
      logger.info(`      Order Execution: ${orderExecutionTime}ms`);

      // Store position
      this.openPositions.set(symbol, {
        symbol,
        amount,
        entryPrice: currentPrice,
        entryTime: Date.now(),
        orderId: order.id,
        margin: orderAmount,
      });

      // NON-CRITICAL: Set stop loss and schedule sell in parallel (async)
      if (this.config.parallelExecution) {
        Promise.all([
          this.config.stopLossPercent > 0
            ? this.setStopLoss(symbol, currentPrice, amount)
            : Promise.resolve(),
          Promise.resolve(this.scheduleAutoSell(symbol, amount)),
        ]).catch((err) => logger.error("Post-order error:", err.message));
      }
    } catch (error) {
      const totalLatency = Date.now() - detectionStartTime;
      this.performance.recordOrderExecution(Date.now() - orderStartTime, false);
      this.performance.recordTotalLatency(totalLatency);

      logger.error(`   ❌ Order failed in ${totalLatency}ms:`, error.message);
      throw error;
    }
  }

  // Set stop loss (async, non-blocking)
  async setStopLoss(symbol, entryPrice, amount) {
    try {
      const stopPrice = entryPrice * (1 - this.config.stopLossPercent / 100);
      const slPrice = this.bybitClient.priceToPrecision(symbol, stopPrice);

      await this.bybitClient.createOrder(
        symbol,
        "stop_market",
        "sell",
        amount,
        null,
        {
          stopPrice: slPrice,
          reduceOnly: true,
        }
      );

      logger.info(
        `   🛡️  Stop loss set: $${slPrice} (-${this.config.stopLossPercent}%)`
      );
    } catch (error) {
      logger.warn(`   ⚠️  Stop loss failed: ${error.message}`);
    }
  }

  // Schedule auto-sell
  scheduleAutoSell(symbol, amount) {
    logger.info(`   ⏰ Auto-sell scheduled: ${this.config.sellAfterSeconds}s`);

    const timer = setTimeout(async () => {
      await this.executeSellOrder(symbol, amount);
    }, this.config.sellAfterSeconds * 1000);

    this.sellTimers.set(symbol, timer);
  }

  // Execute sell order
  async executeSellOrder(symbol, amount) {
    try {
      const position = this.openPositions.get(symbol);
      if (!position) {
        logger.warn(`No position found for ${symbol}`);
        return;
      }

      logger.info(`🔔 CLOSING POSITION: ${symbol}`);

      const ticker = await this.bybitClient.fetchTicker(symbol);
      const currentPrice = ticker.last;
      const priceChange =
        ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const pnlPercent = priceChange * this.config.leverage;
      const pnl = position.margin * (pnlPercent / 100);

      // Cancel stop loss orders
      try {
        const openOrders = await this.bybitClient.fetchOpenOrders(symbol);
        for (const order of openOrders) {
          if (order.type === "stop_market") {
            await this.bybitClient.cancelOrder(order.id, symbol);
          }
        }
      } catch (e) {
        // Ignore
      }

      // Execute sell
      await this.bybitClient.createMarketSellOrder(symbol, amount, {
        reduceOnly: true,
      });

      logger.info(`✅ POSITION CLOSED!`);
      logger.info(`   Entry: $${position.entryPrice}`);
      logger.info(`   Exit: $${currentPrice}`);
      logger.info(`   Price Change: ${priceChange.toFixed(2)}%`);
      logger.info(
        `   P&L (${this.config.leverage}x): ${pnlPercent.toFixed(
          2
        )}% ($${pnl.toFixed(2)})`
      );

      // Cleanup
      this.openPositions.delete(symbol);
      this.sellTimers.delete(symbol);
    } catch (error) {
      logger.error(`Error closing position:`, error.message);
      this.openPositions.delete(symbol);
      this.sellTimers.delete(symbol);
    }
  }

  // Start monitoring
  start() {
    this.isRunning = true;
    logger.info(`🚀 Starting Upbit listing monitor`);
    logger.info(`   Poll interval: ${this.config.pollIntervalSeconds}s`);
    logger.info(
      `   Checking every ${this.config.pollIntervalSeconds * 1000}ms`
    );

    // Immediate first check
    this.checkForNewListings();

    // Then poll at interval
    this.pollInterval = setInterval(() => {
      if (this.isRunning) {
        this.checkForNewListings();
      }
    }, this.config.pollIntervalSeconds * 1000);

    // Log performance stats every 5 minutes
    setInterval(() => {
      this.performance.logStats();
    }, 5 * 60 * 1000);
  }

  // Stop monitoring
  stop() {
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Clear sell timers
    for (const [symbol, timer] of this.sellTimers.entries()) {
      clearTimeout(timer);
      logger.info(`Cleared sell timer for ${symbol}`);
    }
    this.sellTimers.clear();

    logger.info("🛑 Upbit listing monitor stopped");
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      knownMarkets: this.knownMarkets.size,
      ordersToday: this.ordersPlacedToday,
      maxOrdersPerDay: this.config.maxOrdersPerDay,
      openPositions: this.openPositions.size,
      pendingSells: this.sellTimers.size,
      performance: this.performance.getStats(),
    };
  }
}

// Validate configuration
function validateConfig() {
  const required = ["bybitApiKey", "bybitApiSecret"];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    logger.error("❌ Missing required configuration:");
    missing.forEach((key) => logger.error(`   - ${key}`));
    logger.error("\n💡 Please check your env.upbit-listing file");
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    logger.info("=".repeat(70));
    logger.info("⚡ UPBIT API LISTING DETECTOR - OPTIMIZED FOR SPEED ⚡");
    logger.info("=".repeat(70));

    validateConfig();

    // Create detector
    const detector = new UpbitListingDetector(config);

    // Initialize Bybit
    await detector.initializeBybit();

    // Initialize Upbit markets
    await detector.initialize();

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info("\n🛑 Shutting down gracefully...");
      detector.stop();
      detector.performance.logStats();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start monitoring
    detector.start();

    logger.info("✅ Bot is now running!");
    logger.info(
      `   Mode: Upbit API Polling (${config.pollIntervalSeconds}s interval)`
    );
    logger.info(
      `   Trading: ${
        config.useAccountPercentage
          ? config.accountPercentage + "% of balance"
          : "$" + config.orderAmount + " per trade"
      }`
    );
    logger.info(`   Leverage: ${config.leverage}x`);
    logger.info(`   Stop Loss: ${config.stopLossPercent}%`);
    logger.info(`   Auto-sell: ${config.sellAfterSeconds}s`);
    logger.info(`   Max trades/day: ${config.maxOrdersPerDay}`);
    logger.info("\n💡 Monitoring Upbit for new listings...");

    // Status updates every 10 minutes
    setInterval(() => {
      const status = detector.getStatus();
      logger.info("📊 STATUS:", {
        markets: status.knownMarkets,
        ordersToday: status.ordersToday,
        openPositions: status.openPositions,
      });
    }, 10 * 60 * 1000);
  } catch (error) {
    logger.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

// Run the bot
main();
