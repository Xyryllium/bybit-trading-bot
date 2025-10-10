import { TwitterApi } from "twitter-api-v2";
import ccxt from "ccxt";
import logger from "./logger.js";

class UpbitListingStrategy {
  constructor(config) {
    this.config = config;
    this.twitterClient = null;
    this.bybitClient = null;
    this.stream = null;
    this.processedTweets = new Set(); // Prevent duplicate processing
    this.isRunning = false;
    this.openPositions = new Map(); // Track open positions for auto-sell
    this.sellTimers = new Map(); // Track sell timers

    // Trading parameters
    this.useAccountPercentage = config.useAccountPercentage !== false; // Default true
    this.accountPercentage = config.accountPercentage || 10; // Use 10% of account by default
    this.orderAmount = config.orderAmount || 100; // Fallback fixed amount
    this.leverage = config.leverage || 10; // 10x leverage by default
    this.stopLossPercent = config.stopLossPercent || 5; // 5% stop loss
    this.sellAfterSeconds = config.sellAfterSeconds || 60; // Auto-sell after 60 seconds
    this.maxOrdersPerDay = config.maxOrdersPerDay || 5;
    this.ordersPlacedToday = 0;
    this.lastResetDate = new Date().toDateString();
    this.accountBalance = 0;

    // SPEED OPTIMIZATION: Cache for faster lookups
    this.marketsCache = null;
    this.marketsCacheTime = 0;
    this.priceCache = new Map(); // Cache recent prices
    this.lastBalanceUpdate = 0;
    this.balanceCache = 0;
    this.cachedOrderAmount = 0;
  }

  // Initialize Twitter API client
  async initializeTwitter() {
    try {
      this.twitterClient = new TwitterApi(this.config.twitterBearerToken);
      logger.info("Twitter API client initialized successfully");
      return true;
    } catch (error) {
      logger.error("Failed to initialize Twitter API:", error);
      throw error;
    }
  }

  // Initialize Bybit API client
  async initializeBybit() {
    try {
      this.bybitClient = new ccxt.bybit({
        apiKey: this.config.bybitApiKey,
        secret: this.config.bybitApiSecret,
        enableRateLimit: true,
        options: {
          defaultType: "swap", // Use perpetual futures (USDT perpetual)
          adjustForTimeDifference: true,
        },
      });

      // Test connection and PRE-LOAD markets for speed
      await this.bybitClient.loadMarkets();
      this.marketsCache = this.bybitClient.markets;
      this.marketsCacheTime = Date.now();
      logger.info(
        "Bybit API client initialized successfully (Futures Perpetual)"
      );
      logger.info(
        `Markets pre-cached: ${Object.keys(this.marketsCache).length} symbols`
      );

      // Fetch account balance if using percentage mode
      if (this.useAccountPercentage) {
        await this.updateAccountBalance();
      }

      // SPEED OPTIMIZATION: Keep connection warm
      setInterval(async () => {
        try {
          await this.bybitClient.fetchTime();
        } catch (e) {
          logger.warn("Keep-alive ping failed:", e.message);
        }
      }, 30000); // Ping every 30 seconds

      return true;
    } catch (error) {
      logger.error("Failed to initialize Bybit API:", error);
      throw error;
    }
  }

  // Update account balance
  async updateAccountBalance() {
    try {
      const balance = await this.bybitClient.fetchBalance();
      this.accountBalance = balance.USDT?.free || 0;
      logger.info(`Account Balance: ${this.accountBalance.toFixed(2)} USDT`);
      logger.info(
        `Per Trade (${this.accountPercentage}%): ${(
          (this.accountBalance * this.accountPercentage) /
          100
        ).toFixed(2)} USDT`
      );
      return this.accountBalance;
    } catch (error) {
      logger.error("Failed to fetch account balance:", error);
      logger.warn("Falling back to fixed order amount");
      this.useAccountPercentage = false;
      return 0;
    }
  }

  // Get current order amount (dynamic based on account balance)
  async getOrderAmount() {
    if (this.useAccountPercentage && this.accountBalance > 0) {
      // SPEED OPTIMIZATION: Only update balance every 60 seconds, not every trade
      const now = Date.now();
      if (now - this.lastBalanceUpdate > 60000) {
        await this.updateAccountBalance();
        this.balanceCache = this.accountBalance;
        this.cachedOrderAmount =
          (this.accountBalance * this.accountPercentage) / 100;
        this.lastBalanceUpdate = now;
      }
      return this.cachedOrderAmount;
    } else {
      return this.orderAmount;
    }
  }

  // Extract token symbol from tweet text
  extractTokenSymbol(tweetText) {
    try {
      // Priority 1: $SYMBOL format (most common in NewListingsFeed tweets)
      const dollarPattern = /\$([A-Z0-9]{1,10})\b/gi;
      const dollarMatches = [...tweetText.matchAll(dollarPattern)];
      if (dollarMatches.length > 0 && dollarMatches[0][1]) {
        const symbol = dollarMatches[0][1].toUpperCase();
        logger.info(`Extracted symbol from $ format: ${symbol}`);
        return symbol;
      }

      // Priority 2: Other patterns
      const patterns = [
        /#([A-Z0-9]{2,10})\b/gi, // #SYMBOL format
        /\b([A-Z]{3,10})\s+listed/gi, // SYMBOL listed format
      ];

      const matches = new Set();
      for (const pattern of patterns) {
        const regexMatches = [...tweetText.matchAll(pattern)];
        regexMatches.forEach((match) => {
          if (match[1]) {
            matches.add(match[1].toUpperCase());
          }
        });
      }

      const excludeWords = [
        "LISTED",
        "UPBIT",
        "OFFICIAL",
        "NEW",
        "ANNOUNCEMENT",
        "TRADING",
        "TOKEN",
        "COIN",
        "SPOT",
        "KRW",
        "USD",
        "USDT",
      ];

      const symbols = Array.from(matches).filter(
        (s) => !excludeWords.includes(s)
      );

      if (symbols.length > 0) {
        logger.info(`Extracted symbol from pattern: ${symbols[0]}`);
        return symbols[0];
      }

      return null;
    } catch (error) {
      logger.error("Error extracting token symbol:", error);
      return null;
    }
  }

  // Check if symbol is available on Bybit (OPTIMIZED with cache)
  async findBybitSymbol(tokenSymbol) {
    try {
      // SPEED OPTIMIZATION: Use cached markets (avoid API call)
      const markets = this.marketsCache || this.bybitClient.markets;
      if (!markets) {
        await this.bybitClient.loadMarkets();
        this.marketsCache = this.bybitClient.markets;
      }

      // Try different perpetual futures symbol formats
      const possibleSymbols = [
        `${tokenSymbol}/USDT:USDT`, // USDT perpetual format
        `${tokenSymbol}/USD:USDT`,
        `${tokenSymbol}/USDT`,
        `${tokenSymbol}USDT`,
      ];

      for (const symbol of possibleSymbols) {
        if (markets[symbol] && markets[symbol].type === "swap") {
          logger.info(`Found matching perpetual symbol on Bybit: ${symbol}`);
          return symbol;
        }
      }

      logger.warn(`Token ${tokenSymbol} perpetual contract not found on Bybit`);
      return null;
    } catch (error) {
      logger.error("Error finding Bybit symbol:", error);
      return null;
    }
  }

  // Place buy order on Bybit
  async placeBuyOrder(symbol) {
    try {
      // Reset daily counter if needed
      const today = new Date().toDateString();
      if (this.lastResetDate !== today) {
        this.ordersPlacedToday = 0;
        this.lastResetDate = today;
      }

      // Check daily limit
      if (this.ordersPlacedToday >= this.maxOrdersPerDay) {
        logger.warn(
          `Daily order limit reached (${this.maxOrdersPerDay}). Skipping order.`
        );
        return null;
      }

      // SPEED OPTIMIZATION: Execute critical operations in parallel
      const [currentOrderAmount, ticker] = await Promise.all([
        this.getOrderAmount(),
        this.bybitClient.fetchTicker(symbol),
      ]);

      const currentPrice = ticker.last;
      const orderSize = (currentOrderAmount * this.leverage) / currentPrice;
      const market = this.bybitClient.market(symbol);
      const amount = this.bybitClient.amountToPrecision(symbol, orderSize);

      // SPEED: Set leverage asynchronously, don't wait for it
      this.bybitClient.setLeverage(this.leverage, symbol).catch(() => {
        // Ignore errors - leverage might already be set
      });

      logger.info(
        `🚀 LONG ${symbol} | ${amount} @ ${currentPrice} | ${this.leverage}x`
      );

      // SPEED: Place market buy order IMMEDIATELY (most critical operation)
      const order = await this.bybitClient.createMarketBuyOrder(symbol, amount);

      this.ordersPlacedToday++;

      // Store position info
      this.openPositions.set(symbol, {
        symbol: symbol,
        amount: amount,
        entryPrice: currentPrice,
        entryTime: Date.now(),
        orderId: order.id,
        margin: currentOrderAmount,
      });

      // SPEED: Set stop loss and schedule sell in parallel (non-blocking)
      Promise.all([
        this.stopLossPercent > 0
          ? this.setStopLoss(symbol, currentPrice, amount)
          : Promise.resolve(),
        Promise.resolve(this.scheduleAutoSell(symbol, amount)),
      ]).catch((err) =>
        logger.error("Error in post-order setup:", err.message)
      );

      return order;
    } catch (error) {
      logger.error("Error placing buy order:", error);
      throw error;
    }
  }

  // Set stop loss order
  async setStopLoss(symbol, entryPrice, amount) {
    try {
      const stopLossPrice = entryPrice * (1 - this.stopLossPercent / 100);
      const slPrice = this.bybitClient.priceToPrecision(symbol, stopLossPrice);

      logger.info(
        `Setting stop loss at ${slPrice} (${this.stopLossPercent}% below entry)`
      );

      try {
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
        logger.info("Stop loss order placed successfully");
      } catch (error) {
        logger.error("Failed to place stop loss:", error.message);
      }
    } catch (error) {
      logger.error("Error setting stop loss:", error);
    }
  }

  // Schedule automatic sell after configured time
  scheduleAutoSell(symbol, amount) {
    try {
      logger.info(
        `⏰ Scheduling automatic sell for ${symbol} in ${this.sellAfterSeconds} seconds`
      );

      const timer = setTimeout(async () => {
        await this.executeSellOrder(symbol, amount);
      }, this.sellAfterSeconds * 1000);

      this.sellTimers.set(symbol, timer);
    } catch (error) {
      logger.error("Error scheduling auto-sell:", error);
    }
  }

  // Execute sell order
  async executeSellOrder(symbol, amount) {
    try {
      const position = this.openPositions.get(symbol);
      if (!position) {
        logger.warn(`No open position found for ${symbol}, skipping sell`);
        return;
      }

      logger.info(
        `🔔 TIME TO CLOSE POSITION! Executing market close for ${symbol}`
      );

      // Get current price
      const ticker = await this.bybitClient.fetchTicker(symbol);
      const currentPrice = ticker.last;
      const entryPrice = position.entryPrice;
      const rawProfitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      const leveragedProfitPercent = rawProfitPercent * this.leverage;

      logger.info(`Entry Price: ${entryPrice}, Current Price: ${currentPrice}`);
      logger.info(`Price Change: ${rawProfitPercent.toFixed(2)}%`);
      logger.info(
        `Profit/Loss (${
          this.leverage
        }x leverage): ${leveragedProfitPercent.toFixed(2)}%`
      );

      // Cancel any existing stop loss orders before selling
      try {
        const openOrders = await this.bybitClient.fetchOpenOrders(symbol);
        for (const order of openOrders) {
          if (order.type === "stop_market" || order.type === "stop") {
            await this.bybitClient.cancelOrder(order.id, symbol);
            logger.info(`Cancelled stop loss order: ${order.id}`);
          }
        }
      } catch (error) {
        logger.warn("Could not cancel existing orders:", error.message);
      }

      // Place market sell order to close long position
      const sellOrder = await this.bybitClient.createMarketSellOrder(
        symbol,
        amount,
        {
          reduceOnly: true, // Ensure we're closing position, not opening short
        }
      );

      const pnl = position.margin * (leveragedProfitPercent / 100);

      logger.info("✅ POSITION CLOSED!", {
        symbol: symbol,
        orderId: sellOrder.id,
        amount: amount,
        exitPrice: currentPrice,
        priceChange: rawProfitPercent.toFixed(2) + "%",
        profitPercent: leveragedProfitPercent.toFixed(2) + "%",
        pnl: `$${pnl.toFixed(2)}`,
        leverage: this.leverage + "x",
        holdTime: `${this.sellAfterSeconds}s`,
      });

      // Clean up
      this.openPositions.delete(symbol);
      this.sellTimers.delete(symbol);
    } catch (error) {
      logger.error("Error executing sell order:", error);
      // Clean up even on error
      this.openPositions.delete(symbol);
      this.sellTimers.delete(symbol);
    }
  }

  // Cancel auto-sell timer for a symbol
  cancelAutoSell(symbol) {
    const timer = this.sellTimers.get(symbol);
    if (timer) {
      clearTimeout(timer);
      this.sellTimers.delete(symbol);
      logger.info(`Cancelled auto-sell timer for ${symbol}`);
    }
  }

  // Process tweet and execute trade if criteria met
  async processTweet(tweet) {
    const startTime = Date.now(); // Track execution time

    try {
      const tweetId = tweet.data.id;
      const tweetText = tweet.data.text;

      // SPEED: Skip logging author lookup
      logger.info(`📢 NEW TWEET: ${tweetText}`);

      // SPEED: Quick duplicate check first
      if (this.processedTweets.has(tweetId)) {
        return;
      }

      // SPEED: Quick pattern check (no logging if fail)
      const upbitListingPattern = /listed\s+on\s+(@official_)?upbit/i;
      if (!upbitListingPattern.test(tweetText)) {
        return;
      }

      logger.info("🚨 UPBIT LISTING DETECTED! 🚨");

      // SPEED: Extract and execute in parallel where possible
      const tokenSymbol = this.extractTokenSymbol(tweetText);
      if (!tokenSymbol) {
        logger.warn("Could not extract token symbol");
        return;
      }

      logger.info(`Symbol: ${tokenSymbol}`);

      // Mark as processed IMMEDIATELY to prevent duplicates during execution
      this.processedTweets.add(tweetId);

      // SPEED: Find symbol and place order without extra logging
      const bybitSymbol = await this.findBybitSymbol(tokenSymbol);
      if (!bybitSymbol) {
        logger.warn(`${tokenSymbol} not on Bybit`);
        return;
      }

      // SPEED: Place order immediately
      const order = await this.placeBuyOrder(bybitSymbol);

      const executionTime = Date.now() - startTime;

      if (order) {
        logger.info(`✅ EXECUTED in ${executionTime}ms | Order: ${order.id}`);
      }

      // Clean up old tweets (less frequently)
      if (this.processedTweets.size > 1000) {
        const tweetsArray = Array.from(this.processedTweets);
        this.processedTweets = new Set(tweetsArray.slice(-1000));
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error(`❌ FAILED in ${executionTime}ms:`, error.message);
    }
  }

  // Start monitoring Twitter stream
  async startTwitterStream() {
    try {
      logger.info("🚀 Attempting to start Twitter streaming...");

      // Try Sample Stream first (FREE - works with Elevated access)
      try {
        logger.info("Trying Sample Stream (1% of all tweets)...");

        this.stream = await this.twitterClient.v2.sampleStream({
          "tweet.fields": ["created_at", "author_id", "text"],
          "user.fields": ["username"],
          expansions: ["author_id"],
        });

        logger.info("✅ Sample Stream started successfully!");
        logger.info("📡 Monitoring 1% of ALL tweets for Upbit listings...");
        logger.info("⚡ Real-time streaming active!");

        // Handle incoming tweets
        this.stream.on("data", async (tweet) => {
          await this.processTweet(tweet);
        });

        this.stream.on("error", (error) => {
          logger.error("Sample stream error:", error);
          if (this.isRunning) {
            logger.info("Attempting to reconnect in 30 seconds...");
            setTimeout(() => this.startTwitterStream(), 30000);
          }
        });

        this.stream.on("end", () => {
          logger.info("Sample stream ended");
          if (this.isRunning) {
            logger.info("Attempting to reconnect in 10 seconds...");
            setTimeout(() => this.startTwitterStream(), 10000);
          }
        });

        return; // Success with Sample Stream
      } catch (sampleError) {
        logger.warn("Sample Stream failed:", sampleError.message);
        logger.info("Trying Filtered Stream as fallback...");
      }

      // Fallback to Filtered Stream (requires Basic/Pro tier)
      const userId = this.config.twitterUserId;

      logger.info(`Setting up Filtered Stream for user ID: ${userId}`);

      // Delete existing rules first
      try {
        const existingRules = await this.twitterClient.v2.streamRules();
        if (existingRules.data && existingRules.data.length > 0) {
          const ruleIds = existingRules.data.map((rule) => rule.id);
          await this.twitterClient.v2.updateStreamRules({
            delete: { ids: ruleIds },
          });
          logger.info(`Deleted ${ruleIds.length} existing stream rules`);
        }
      } catch (error) {
        logger.warn("No existing rules to delete:", error.message);
      }

      // Add new rule for Upbit listings
      const rule = {
        add: [
          {
            value: `from:${this.config.twitterUsername} (listed Upbit OR listed Official_Upbit)`,
            tag: "upbit-listings",
          },
        ],
      };

      await this.twitterClient.v2.updateStreamRules(rule);
      logger.info("Filtered stream rule added successfully");

      // Start filtered streaming
      this.stream = await this.twitterClient.v2.searchStream({
        "tweet.fields": ["created_at", "author_id"],
        "user.fields": ["username"],
        expansions: ["author_id"],
      });

      logger.info("✅ Filtered Stream started successfully!");

      // Handle incoming tweets
      this.stream.on("data", async (tweet) => {
        await this.processTweet(tweet);
      });

      this.stream.on("error", (error) => {
        logger.error("Filtered stream error:", error);
        if (this.isRunning) {
          logger.info("Attempting to reconnect in 30 seconds...");
          setTimeout(() => this.startTwitterStream(), 30000);
        }
      });

      this.stream.on("end", () => {
        logger.info("Filtered stream ended");
        if (this.isRunning) {
          logger.info("Attempting to reconnect in 10 seconds...");
          setTimeout(() => this.startTwitterStream(), 10000);
        }
      });
    } catch (error) {
      logger.error("❌ All streaming methods failed:", error);

      if (error.message.includes("403")) {
        logger.info("");
        logger.info("🚨 STREAMING ACCESS DENIED");
        logger.info(
          "Your account needs Basic ($100/month) or Pro ($5,000/month) tier"
        );
        logger.info(
          "for Filtered Streams, or Sample Stream failed for other reasons."
        );
        logger.info("");
        logger.info("💡 RECOMMENDED: Use polling mode instead");
        logger.info("Run: npm run upbit-listing (polling mode)");
        logger.info(
          "Only 5-15 seconds slower, works with free Elevated access!"
        );
      }

      throw error;
    }
  }

  // Start the strategy
  async start() {
    try {
      logger.info("Starting Upbit Listing Strategy...");

      this.isRunning = true;

      // Initialize APIs
      await this.initializeTwitter();
      await this.initializeBybit();

      // Start monitoring Twitter
      await this.startTwitterStream();

      logger.info("Strategy is now running and monitoring for Upbit listings!");
      if (this.useAccountPercentage) {
        logger.info(
          `Trading Mode: ${this.accountPercentage}% of account balance per trade`
        );
        logger.info(`Current Balance: ${this.accountBalance.toFixed(2)} USDT`);
        logger.info(
          `Per Trade Margin: ~${(
            (this.accountBalance * this.accountPercentage) /
            100
          ).toFixed(2)} USDT`
        );
      } else {
        logger.info(`Trading Mode: Fixed ${this.orderAmount} USDT per trade`);
      }
      logger.info(`Leverage: ${this.leverage}x`);
      logger.info(`Max orders per day: ${this.maxOrdersPerDay}`);
      logger.info(`Stop Loss: ${this.stopLossPercent}%`);
      logger.info(
        `Auto-sell after: ${this.sellAfterSeconds} seconds (${
          this.sellAfterSeconds / 60
        } minute)`
      );
    } catch (error) {
      logger.error("Failed to start strategy:", error);
      throw error;
    }
  }

  // Stop the strategy
  async stop() {
    try {
      logger.info("Stopping Upbit Listing Strategy...");

      this.isRunning = false;

      // Clear all pending sell timers
      for (const [symbol, timer] of this.sellTimers.entries()) {
        clearTimeout(timer);
        logger.info(`Cleared pending sell timer for ${symbol}`);
      }
      this.sellTimers.clear();

      if (this.stream) {
        this.stream.destroy();
        this.stream = null;
      }

      logger.info("Strategy stopped successfully");
    } catch (error) {
      logger.error("Error stopping strategy:", error);
    }
  }

  // Get strategy status
  getStatus() {
    return {
      isRunning: this.isRunning,
      ordersPlacedToday: this.ordersPlacedToday,
      maxOrdersPerDay: this.maxOrdersPerDay,
      processedTweetsCount: this.processedTweets.size,
      openPositions: this.openPositions.size,
      pendingSells: this.sellTimers.size,
    };
  }
}

export default UpbitListingStrategy;
