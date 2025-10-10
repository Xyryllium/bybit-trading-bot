import dotenv from "dotenv";
dotenv.config({ path: "./env.upbit-listing" });
import { TwitterApi } from "twitter-api-v2";
import ccxt from "ccxt";
import logger from "./logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * UPBIT API LISTING BACKTEST
 *
 * This backtest simulates the Upbit API listing detection approach
 * It uses historical Twitter data to know WHEN listings occurred,
 * then simulates detecting them via Upbit API polling vs Twitter polling
 *
 * Compares:
 * - API polling (1-2s detection) vs Twitter polling (30s+ detection)
 * - Order execution speed with optimizations
 * - Overall performance metrics
 */

class UpbitApiListingBacktest {
  constructor(config) {
    this.config = config;
    this.twitterClient = null;
    this.bybitClient = null;
    this.results = {
      apiPoll: [], // Results with API polling
      twitterStream: [], // Results with Twitter streaming (for comparison)
    };
    this.orderAmount = config.orderAmount || 10;
    this.leverage = config.leverage || 10;
    this.stopLossPercent = config.stopLossPercent || 5;
    this.sellAfterSeconds = config.sellAfterSeconds || 60;
    this.maxTrades = config.maxTrades || 50;

    // Simulation parameters
    this.apiPollInterval = config.apiPollInterval || 1; // 1 second
    this.twitterStreamDelay = config.twitterStreamDelay || 1.5; // 1.5 seconds realistic streaming delay
  }

  async initializeTwitter() {
    try {
      this.twitterClient = new TwitterApi(this.config.twitterBearerToken);
      logger.info("✅ Twitter API initialized for backtesting");
      return true;
    } catch (error) {
      logger.error("❌ Failed to initialize Twitter:", error.message);
      throw error;
    }
  }

  async initializeBybit() {
    try {
      this.bybitClient = new ccxt.bybit({
        enableRateLimit: true,
        options: {
          defaultType: "swap",
          adjustForTimeDifference: true,
        },
      });

      await this.bybitClient.loadMarkets();
      logger.info("✅ Bybit API initialized (public data only)");
      return true;
    } catch (error) {
      logger.error("❌ Failed to initialize Bybit:", error.message);
      throw error;
    }
  }

  extractTokenSymbol(tweetText) {
    // Priority 1: $SYMBOL format
    const dollarPattern = /\$([A-Z0-9]{1,10})\b/gi;
    const dollarMatches = [...tweetText.matchAll(dollarPattern)];
    if (dollarMatches.length > 0 && dollarMatches[0][1]) {
      return dollarMatches[0][1].toUpperCase();
    }

    // Priority 2: Other patterns
    const patterns = [/#([A-Z0-9]{2,10})\b/gi, /\b([A-Z]{3,10})\s+listed/gi];

    const matches = new Set();
    for (const pattern of patterns) {
      const regexMatches = [...tweetText.matchAll(pattern)];
      regexMatches.forEach((match) => {
        if (match[1]) matches.add(match[1].toUpperCase());
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

    return symbols.length > 0 ? symbols[0] : null;
  }

  findBybitSymbol(tokenSymbol) {
    const possibleSymbols = [
      `${tokenSymbol}/USDT:USDT`,
      `${tokenSymbol}/USD:${tokenSymbol}`,
      `${tokenSymbol}/USDT`,
    ];

    for (const symbol of possibleSymbols) {
      const market = this.bybitClient.markets[symbol];
      if (market && market.type === "swap") {
        return symbol;
      }
    }
    return null;
  }

  // Simulate detection latency based on polling interval
  simulateDetectionLatency(pollInterval) {
    // Random delay between 0 and pollInterval (worst case = full interval)
    // Average case = pollInterval / 2
    return Math.random() * pollInterval * 1000; // Convert to ms
  }

  // Simulate order execution with realistic latency
  simulateOrderExecution() {
    // Optimized execution: 100-500ms typical
    return 100 + Math.random() * 400;
  }

  async fetchHistoricalPrice(symbol, timestamp) {
    try {
      // Fetch OHLCV data around the listing time
      const since = timestamp - 3600000; // 1 hour before
      const ohlcv = await this.bybitClient.fetchOHLCV(symbol, "1m", since, 120);

      if (!ohlcv || ohlcv.length === 0) {
        return null;
      }

      // Find candles around the listing announcement
      const listingTime = timestamp;
      const candles = ohlcv.filter(
        (c) =>
          c[0] >= listingTime &&
          c[0] <= listingTime + this.sellAfterSeconds * 1000
      );

      if (candles.length === 0) {
        // Use first available candle after listing
        const afterCandles = ohlcv.filter((c) => c[0] >= listingTime);
        if (afterCandles.length > 0) {
          return {
            entry: afterCandles[0][1], // Open of first candle
            exit: afterCandles[
              Math.min(
                afterCandles.length - 1,
                Math.floor(this.sellAfterSeconds / 60)
              )
            ][4], // Close
            high: Math.max(
              ...afterCandles
                .slice(0, Math.floor(this.sellAfterSeconds / 60))
                .map((c) => c[2])
            ),
            candles: afterCandles.slice(
              0,
              Math.floor(this.sellAfterSeconds / 60)
            ),
          };
        }
        return null;
      }

      return {
        entry: candles[0][1], // Open price at entry
        exit: candles[candles.length - 1][4], // Close price at exit
        high: Math.max(...candles.map((c) => c[2])), // Highest price during hold
        candles: candles,
      };
    } catch (error) {
      logger.warn(
        `Could not fetch historical data for ${symbol}: ${error.message}`
      );
      return null;
    }
  }

  async simulateTrade(symbol, listingTimestamp, detectionMethod) {
    try {
      // Simulate detection latency
      let detectionLatency;
      if (detectionMethod === "api") {
        // API polling: random between 0 and poll interval
        detectionLatency = this.simulateDetectionLatency(this.apiPollInterval);
      } else {
        // Twitter streaming: fixed realistic delay (network + processing)
        // Even real-time streaming has 1-2 second delay in practice
        detectionLatency = this.twitterStreamDelay * 1000; // Convert to ms
      }

      // Simulate order execution latency
      const orderExecutionLatency = this.simulateOrderExecution();

      // Total latency
      const totalLatency = detectionLatency + orderExecutionLatency;

      // Adjusted entry time (when we actually entered)
      const entryTimestamp = listingTimestamp + totalLatency;

      // Fetch historical price data
      const priceData = await this.fetchHistoricalPrice(symbol, entryTimestamp);

      if (!priceData) {
        return null;
      }

      const entryPrice = priceData.entry;
      const exitPrice = priceData.exit;
      const highPrice = priceData.high;

      // Calculate returns
      const priceChange = ((exitPrice - entryPrice) / entryPrice) * 100;
      const pnlPercent = priceChange * this.leverage;
      const pnl = this.orderAmount * (pnlPercent / 100);

      // Check if stop loss was hit
      const maxDrawdown =
        ((entryPrice - Math.min(...priceData.candles.map((c) => c[3]))) /
          entryPrice) *
        100;
      const leveragedDrawdown = maxDrawdown * this.leverage;
      const stopLossHit = leveragedDrawdown >= this.stopLossPercent;

      return {
        symbol,
        detectionMethod,
        detectionLatency: Math.round(detectionLatency),
        orderExecutionLatency: Math.round(orderExecutionLatency),
        totalLatency: Math.round(totalLatency),
        entryPrice,
        exitPrice,
        highPrice,
        priceChange: priceChange.toFixed(2),
        pnlPercent: pnlPercent.toFixed(2),
        pnl: pnl.toFixed(2),
        stopLossHit,
        leverage: this.leverage,
        orderAmount: this.orderAmount,
        timestamp: new Date(listingTimestamp).toISOString(),
      };
    } catch (error) {
      logger.error(`Error simulating trade for ${symbol}:`, error.message);
      return null;
    }
  }

  // Load tweets from cache file
  loadCachedTweets() {
    try {
      const cacheFile = path.join(__dirname, "upbit-tweets-cache.json");

      if (!fs.existsSync(cacheFile)) {
        return null;
      }

      const data = fs.readFileSync(cacheFile, "utf8");
      const tweets = JSON.parse(data);

      logger.info(`✅ Loaded ${tweets.length} tweets from cache`);
      return tweets;
    } catch (error) {
      logger.warn(`⚠️  Could not load cache: ${error.message}`);
      return null;
    }
  }

  // Save tweets to cache file
  saveTweetsToCache(tweets) {
    try {
      const cacheFile = path.join(__dirname, "upbit-tweets-cache.json");
      fs.writeFileSync(cacheFile, JSON.stringify(tweets, null, 2));
      logger.info(`✅ Saved ${tweets.length} tweets to cache`);
    } catch (error) {
      logger.warn(`⚠️  Could not save cache: ${error.message}`);
    }
  }

  async fetchHistoricalListings() {
    try {
      // Try to load from cache first
      logger.info("📥 Loading historical Upbit listing announcements...");

      const cachedTweets = this.loadCachedTweets();
      if (cachedTweets && cachedTweets.length > 0) {
        logger.info("✅ Using cached tweets (faster, no API calls!)");

        // Filter for Upbit listings
        const upbitListingPattern = /listed\s+on\s+(@official_)?upbit/i;
        const listingTweets = cachedTweets.filter((tweet) =>
          upbitListingPattern.test(tweet.text)
        );

        // Limit to maxTrades
        const limitedTweets = listingTweets.slice(0, this.maxTrades);

        logger.info(
          `✅ Found ${limitedTweets.length} Upbit listing announcements (from cache)`
        );
        return limitedTweets;
      }

      // Fall back to fetching from Twitter API
      logger.info("📥 Cache not found, fetching from Twitter API...");
      logger.warn("⚠️  This may take a while and use Twitter API quota");

      const userId = this.config.twitterUserId;
      const tweets = [];
      let paginationToken = null;
      let fetchedCount = 0;

      // Fetch tweets with pagination
      while (fetchedCount < this.maxTrades) {
        const params = {
          max_results: Math.min(100, this.maxTrades - fetchedCount),
          "tweet.fields": ["created_at", "text"],
          exclude: ["retweets", "replies"],
        };

        if (paginationToken) {
          params.pagination_token = paginationToken;
        }

        const response = await this.twitterClient.v2.userTimeline(
          userId,
          params
        );

        if (!response.data || !response.data.data) {
          break;
        }

        const newTweets = response.data.data;
        tweets.push(...newTweets);
        fetchedCount += newTweets.length;

        // Check if there's more data
        if (!response.data.meta?.next_token) {
          break;
        }

        paginationToken = response.data.meta.next_token;

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Filter for Upbit listings
      const upbitListingPattern = /listed\s+on\s+(@official_)?upbit/i;
      const listingTweets = tweets.filter((tweet) =>
        upbitListingPattern.test(tweet.text)
      );

      // Save to cache for next time
      if (listingTweets.length > 0) {
        this.saveTweetsToCache(listingTweets);
      }

      logger.info(
        `✅ Found ${listingTweets.length} Upbit listing announcements (from Twitter API)`
      );
      return listingTweets;
    } catch (error) {
      logger.error("❌ Failed to fetch historical tweets:", error.message);
      throw error;
    }
  }

  async runBacktest() {
    try {
      logger.info("=".repeat(70));
      logger.info("⚡ UPBIT API LISTING BACKTEST - SPEED COMPARISON ⚡");
      logger.info("=".repeat(70));

      // Initialize Bybit (always needed)
      await this.initializeBybit();

      // Initialize Twitter only if cache doesn't exist
      const cacheExists = fs.existsSync(
        path.join(__dirname, "upbit-tweets-cache.json")
      );
      if (!cacheExists) {
        logger.info("📡 Cache not found, initializing Twitter API...");
        await this.initializeTwitter();
      } else {
        logger.info("✅ Using cached tweets, skipping Twitter initialization");
      }

      // Fetch historical listings
      const listingTweets = await this.fetchHistoricalListings();

      if (listingTweets.length === 0) {
        logger.error("❌ No listing tweets found. Cannot run backtest.");
        return;
      }

      logger.info("");
      logger.info("🔄 Running backtest simulation...");
      logger.info(
        `   API Polling: ${this.apiPollInterval}s interval (0-${this.apiPollInterval}s random delay)`
      );
      logger.info(
        `   Twitter Streaming: ~${this.twitterStreamDelay}s realistic delay (network + processing)`
      );
      logger.info("");

      let successfulTrades = 0;

      for (let i = 0; i < listingTweets.length; i++) {
        const tweet = listingTweets[i];
        const tokenSymbol = this.extractTokenSymbol(tweet.text);

        if (!tokenSymbol) {
          logger.warn(
            `⚠️  Could not extract symbol from: ${tweet.text.substring(
              0,
              60
            )}...`
          );
          continue;
        }

        const bybitSymbol = this.findBybitSymbol(tokenSymbol);
        if (!bybitSymbol) {
          logger.warn(`⚠️  ${tokenSymbol} not available on Bybit, skipping`);
          continue;
        }

        const timestamp = new Date(tweet.created_at).getTime();

        logger.info(
          `\n[${i + 1}/${listingTweets.length}] ${tokenSymbol} (${
            tweet.created_at
          })`
        );

        // Simulate with API polling
        const apiResult = await this.simulateTrade(
          bybitSymbol,
          timestamp,
          "api"
        );
        if (apiResult) {
          this.results.apiPoll.push(apiResult);
          logger.info(
            `  📡 API Poll: ${apiResult.detectionLatency}ms detection → P&L: ${apiResult.pnlPercent}%`
          );
        }

        // Simulate with Twitter streaming
        const twitterResult = await this.simulateTrade(
          bybitSymbol,
          timestamp,
          "stream"
        );
        if (twitterResult) {
          this.results.twitterStream.push(twitterResult);
          logger.info(
            `  🐦 Twitter Stream: ${twitterResult.detectionLatency}ms detection → P&L: ${twitterResult.pnlPercent}%`
          );
        }

        if (apiResult || twitterResult) {
          successfulTrades++;
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Generate report
      this.generateReport();
    } catch (error) {
      logger.error("❌ Backtest failed:", error.message);
      throw error;
    }
  }

  calculateStats(results) {
    if (results.length === 0) {
      return null;
    }

    const wins = results.filter((r) => parseFloat(r.pnl) > 0);
    const losses = results.filter((r) => parseFloat(r.pnl) <= 0);
    const totalPnl = results.reduce((sum, r) => sum + parseFloat(r.pnl), 0);
    const winRate = (wins.length / results.length) * 100;
    const avgPnl = totalPnl / results.length;
    const avgDetectionLatency =
      results.reduce((sum, r) => sum + r.detectionLatency, 0) / results.length;
    const avgTotalLatency =
      results.reduce((sum, r) => sum + r.totalLatency, 0) / results.length;

    return {
      totalTrades: results.length,
      wins: wins.length,
      losses: losses.length,
      winRate: winRate.toFixed(2),
      totalPnl: totalPnl.toFixed(2),
      avgPnl: avgPnl.toFixed(2),
      avgDetectionLatency: avgDetectionLatency.toFixed(0),
      avgTotalLatency: avgTotalLatency.toFixed(0),
      bestTrade: Math.max(...results.map((r) => parseFloat(r.pnl))).toFixed(2),
      worstTrade: Math.min(...results.map((r) => parseFloat(r.pnl))).toFixed(2),
    };
  }

  generateReport() {
    logger.info("");
    logger.info("=".repeat(70));
    logger.info("📊 BACKTEST RESULTS - API POLLING vs TWITTER STREAMING");
    logger.info("=".repeat(70));

    const apiStats = this.calculateStats(this.results.apiPoll);
    const twitterStats = this.calculateStats(this.results.twitterStream);

    if (!apiStats || !twitterStats) {
      logger.error("❌ Insufficient data for comparison");
      return;
    }

    logger.info("");
    logger.info("🚀 API POLLING RESULTS");
    logger.info("-".repeat(70));
    logger.info(
      `   Detection Method: Poll Upbit API every ${this.apiPollInterval}s`
    );
    logger.info(
      `   Avg Detection: ${apiStats.avgDetectionLatency}ms (random 0-${
        this.apiPollInterval * 1000
      }ms)`
    );
    logger.info(`   Total Trades: ${apiStats.totalTrades}`);
    logger.info(`   Win Rate: ${apiStats.winRate}%`);
    logger.info(
      `   Total P&L: $${apiStats.totalPnl} (${(
        (parseFloat(apiStats.totalPnl) /
          (this.orderAmount * apiStats.totalTrades)) *
        100
      ).toFixed(2)}%)`
    );
    logger.info(`   Avg P&L: $${apiStats.avgPnl} per trade`);
    logger.info(`   Best Trade: $${apiStats.bestTrade}`);
    logger.info(`   Worst Trade: $${apiStats.worstTrade}`);
    logger.info(`   Avg Total Latency: ${apiStats.avgTotalLatency}ms`);

    logger.info("");
    logger.info("🐦 TWITTER STREAMING RESULTS (Paid API Required)");
    logger.info("-".repeat(70));
    logger.info(
      `   Detection Method: Real-time stream (requires $100-5000/mo)`
    );
    logger.info(
      `   Avg Detection: ${twitterStats.avgDetectionLatency}ms (realistic delays)`
    );
    logger.info(`   Total Trades: ${twitterStats.totalTrades}`);
    logger.info(`   Win Rate: ${twitterStats.winRate}%`);
    logger.info(
      `   Total P&L: $${twitterStats.totalPnl} (${(
        (parseFloat(twitterStats.totalPnl) /
          (this.orderAmount * twitterStats.totalTrades)) *
        100
      ).toFixed(2)}%)`
    );
    logger.info(`   Avg P&L: $${twitterStats.avgPnl} per trade`);
    logger.info(`   Best Trade: $${twitterStats.bestTrade}`);
    logger.info(`   Worst Trade: $${twitterStats.worstTrade}`);
    logger.info(`   Avg Total Latency: ${twitterStats.avgTotalLatency}ms`);

    logger.info("");
    logger.info("⚡ COMPARISON");
    logger.info("-".repeat(70));
    const pnlDifference =
      parseFloat(apiStats.totalPnl) - parseFloat(twitterStats.totalPnl);
    const latencyDifference =
      parseFloat(apiStats.avgTotalLatency) -
      parseFloat(twitterStats.avgTotalLatency);
    const winRateDifference =
      parseFloat(apiStats.winRate) - parseFloat(twitterStats.winRate);

    logger.info(
      `   P&L Difference: $${pnlDifference.toFixed(2)} (${
        pnlDifference > 0 ? "API WINS" : "Twitter WINS"
      })`
    );
    logger.info(
      `   Latency Difference: ${Math.abs(latencyDifference).toFixed(0)}ms (${
        latencyDifference < 0 ? "API faster" : "Twitter faster"
      })`
    );
    logger.info(
      `   Win Rate Difference: ${
        winRateDifference > 0 ? "+" : ""
      }${winRateDifference.toFixed(2)}%`
    );

    logger.info("");
    logger.info("=".repeat(70));
    logger.info("💡 CONCLUSION");
    logger.info("=".repeat(70));

    logger.info(`   API Polling: FREE, ${apiStats.avgTotalLatency}ms latency`);
    logger.info(
      `   Twitter Stream: $100-5000/month, ${twitterStats.avgTotalLatency}ms latency`
    );
    logger.info("");

    if (Math.abs(pnlDifference) < 1.0) {
      logger.info(
        `✅ PERFORMANCE IS SIMILAR (within $${Math.abs(pnlDifference).toFixed(
          2
        )})`
      );
      logger.info(
        `   📊 API Polling: $${apiStats.totalPnl} | Twitter Stream: $${twitterStats.totalPnl}`
      );
      logger.info("");
      logger.info("🎯 RECOMMENDATION:");
      logger.info("   ✅ Use API Polling - Same performance, FREE!");
      logger.info("   ❌ Skip Twitter Streaming - Not worth $100-5000/month");
    } else if (pnlDifference > 0) {
      logger.info(`✅ API POLLING WINS by $${pnlDifference.toFixed(2)}`);
      logger.info("   🎯 Use upbit-api-listing-bot.js (FREE & FASTER)");
    } else {
      logger.info(
        `⚠️  Twitter Stream performs better by $${Math.abs(
          pnlDifference
        ).toFixed(2)}`
      );
      logger.info(`   But costs $1,200-60,000/year vs FREE API polling`);
      logger.info(`   💰 ROI: Not worth it unless trading large amounts`);
    }

    logger.info("");
    logger.info("📌 KEY INSIGHT:");
    logger.info("   Even 'real-time' Twitter streaming has 1-2s delays");
    logger.info("   (network latency + processing + execution)");
    logger.info("   API polling achieves similar speed for FREE!");
    logger.info("=".repeat(70));
  }
}

// Configuration
const config = {
  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
  twitterUsername: process.env.TWITTER_USERNAME || "NewListingsFeed",
  twitterUserId: process.env.TWITTER_USER_ID,
  orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 10,
  leverage: parseFloat(process.env.LEVERAGE) || 10,
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 5,
  sellAfterSeconds: parseInt(process.env.SELL_AFTER_SECONDS) || 60,
  maxTrades: parseInt(process.env.MAX_BACKTEST_TRADES) || 20,
  apiPollInterval: parseInt(process.env.UPBIT_API_POLL_INTERVAL) || 1,
  // Twitter streaming realistic delay: network (500ms) + processing (500ms) + execution (500ms) = 1.5s
  twitterStreamDelay: parseFloat(process.env.TWITTER_STREAM_DELAY) || 1.5,
};

// Validate configuration (only if cache doesn't exist)
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const cacheExists = fs.existsSync(
  path.join(__dirname2, "upbit-tweets-cache.json")
);

if (!cacheExists && !config.twitterBearerToken) {
  logger.error("❌ Missing TWITTER_BEARER_TOKEN in env.upbit-listing");
  logger.error(
    "💡 Either provide Twitter credentials OR ensure upbit-tweets-cache.json exists"
  );
  process.exit(1);
}

// Run backtest
const backtest = new UpbitApiListingBacktest(config);
backtest.runBacktest().catch((error) => {
  logger.error("❌ Backtest failed:", error);
  process.exit(1);
});
