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

class UpbitListingBacktest {
  constructor(config) {
    this.config = config;
    this.twitterClient = null;
    this.bybitClient = null;
    this.results = [];
    this.orderAmount = config.orderAmount || 100;
    this.stopLossPercent = config.stopLossPercent || 5;
    this.sellAfterSeconds = config.sellAfterSeconds || 60;
    this.maxTrades = config.maxTrades || 50; // Limit number of historical tweets to test
  }

  // Initialize Twitter API client
  async initializeTwitter() {
    try {
      this.twitterClient = new TwitterApi(this.config.twitterBearerToken);
      logger.info("Twitter API client initialized for backtesting");
      return true;
    } catch (error) {
      logger.error("Failed to initialize Twitter API:", error);
      throw error;
    }
  }

  // Initialize Bybit API client (no credentials needed for historical data)
  async initializeBybit() {
    try {
      this.bybitClient = new ccxt.bybit({
        enableRateLimit: true,
        options: {
          defaultType: "swap", // Use perpetual futures
          adjustForTimeDifference: true,
        },
      });

      await this.bybitClient.loadMarkets();
      logger.info(
        "Bybit API client initialized for backtesting (Public data only - no credentials needed)"
      );
      return true;
    } catch (error) {
      logger.error("Failed to initialize Bybit API:", error);
      throw error;
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

  // Find symbol on Bybit
  async findBybitSymbol(tokenSymbol) {
    try {
      await this.bybitClient.loadMarkets();
      const markets = this.bybitClient.markets;

      const possibleSymbols = [
        `${tokenSymbol}/USDT:USDT`, // USDT perpetual format
        `${tokenSymbol}/USD:USDT`,
        `${tokenSymbol}/USDT`,
      ];

      for (const symbol of possibleSymbols) {
        if (markets[symbol] && markets[symbol].type === "swap") {
          return symbol;
        }
      }

      return null;
    } catch (error) {
      logger.error("Error finding Bybit symbol:", error);
      return null;
    }
  }

  // Fetch historical tweets
  async fetchHistoricalTweets() {
    try {
      // Check if we have a cached tweets file to avoid rate limits
      const cacheFile = path.join(__dirname, "upbit-tweets-cache.json");
      if (fs.existsSync(cacheFile)) {
        logger.info("Loading tweets from cache file (avoids rate limits)...");
        const cachedData = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        const upbitListings = cachedData.map((tweet) => ({
          id: tweet.id,
          text: tweet.text,
          created_at: new Date(tweet.created_at),
        }));
        logger.info(
          `Loaded ${upbitListings.length} cached Upbit listing tweets`
        );
        return upbitListings;
      }

      logger.info("Fetching historical tweets from @NewListingsFeed...");

      const username = this.config.twitterUsername || "NewListingsFeed";

      // Get user ID first
      const user = await this.twitterClient.v2.userByUsername(username);
      const userId = user.data.id;

      logger.info(`Found user @${username} (ID: ${userId})`);

      // Fetch recent tweets (last 7 days by default, max 100 tweets)
      const tweets = await this.twitterClient.v2.userTimeline(userId, {
        max_results: Math.min(this.maxTrades, 100),
        "tweet.fields": ["created_at", "text"],
        exclude: ["retweets", "replies"],
      });

      const upbitListings = [];
      // Pattern handles both "listed on Upbit" and "listed on @Official_Upbit"
      const upbitPattern = /listed\s+on\s+(@official_)?upbit/i;

      for (const tweet of tweets.data.data || []) {
        if (upbitPattern.test(tweet.text)) {
          upbitListings.push({
            id: tweet.id,
            text: tweet.text,
            created_at: new Date(tweet.created_at),
          });
        }
      }

      logger.info(`Found ${upbitListings.length} Upbit listing tweets`);

      // Save to cache file for future backtests (avoid rate limits)
      fs.writeFileSync(
        cacheFile,
        JSON.stringify(
          upbitListings.map((t) => ({
            id: t.id,
            text: t.text,
            created_at: t.created_at.toISOString(),
          })),
          null,
          2
        )
      );
      logger.info(`Saved tweets to cache: ${cacheFile}`);

      return upbitListings;
    } catch (error) {
      logger.error("Error fetching historical tweets:", error);
      if (error.code === 401) {
        logger.error("Authentication failed. Check your Twitter Bearer Token.");
      } else if (error.code === 429) {
        logger.error("Rate limit exceeded. Please wait before trying again.");
      }
      throw error;
    }
  }

  // Get historical price data around tweet time
  async getHistoricalPrices(symbol, tweetTime) {
    try {
      // Calculate timeframes - NO DELAY, execute immediately
      const entryTime = tweetTime; // Execute immediately at tweet time
      const exitTime = new Date(
        entryTime.getTime() + this.sellAfterSeconds * 1000
      );
      const endTime = new Date(entryTime.getTime() + 300000); // Get 5 minutes of data

      // Fetch OHLCV data (1-minute candles)
      const since = entryTime.getTime() - 60000; // Start 1 minute before
      const ohlcv = await this.bybitClient.fetchOHLCV(
        symbol,
        "1m",
        since,
        10 // Get 10 candles
      );

      if (!ohlcv || ohlcv.length === 0) {
        logger.warn(
          `No historical data available for ${symbol} at ${entryTime}`
        );
        return null;
      }

      // Find entry price - use the candle that CONTAINS the tweet time
      let entryPrice = null;
      let entryCandle = null;

      for (const candle of ohlcv) {
        const candleTime = new Date(candle[0]);
        const candleEndTime = new Date(candleTime.getTime() + 60000); // 1 min later

        // Check if tweet time falls within this candle
        if (candleTime <= entryTime && entryTime < candleEndTime) {
          entryCandle = candle;
          // Use OPEN price of the candle (earliest possible entry in that minute)
          // This is most realistic since we'd execute at the start of price discovery
          entryPrice = candle[1]; // OPEN price
          logger.info(
            `Using candle open price: $${entryPrice} (candle: ${candleTime.toISOString()})`
          );
          break;
        }
      }

      if (!entryPrice) {
        // Fallback: use the closest candle
        entryCandle = ohlcv[ohlcv.length - 1];
        entryPrice = entryCandle[1]; // Open price
        logger.warn(`Using fallback candle open: $${entryPrice}`);
      }

      // Find exit price (after sellAfterSeconds)
      let exitPrice = null;
      let stopLossHit = false;
      const stopLossPrice = entryPrice * (1 - this.stopLossPercent / 100);

      for (const candle of ohlcv) {
        const candleTime = new Date(candle[0]);

        // Check if we're in the holding period
        if (candleTime > entryTime && candleTime <= exitTime) {
          const low = candle[3];

          // Check if stop loss was hit
          if (low <= stopLossPrice) {
            exitPrice = stopLossPrice;
            stopLossHit = true;
            break;
          }
        }

        // If we reached exit time and stop loss wasn't hit
        if (candleTime >= exitTime && !stopLossHit) {
          exitPrice = candle[1]; // Open price at exit time
          break;
        }
      }

      // If no exit price found, use the last available price
      if (!exitPrice) {
        exitPrice = ohlcv[ohlcv.length - 1][4]; // Close of last candle
      }

      return {
        entryPrice,
        exitPrice,
        stopLossHit,
        entryTime: new Date(entryCandle[0]),
        dataAvailable: true,
      };
    } catch (error) {
      logger.error(
        `Error fetching historical prices for ${symbol}:`,
        error.message
      );
      return null;
    }
  }

  // Backtest a single tweet/trade
  async backtestTrade(tweet) {
    try {
      logger.info(`\n${"=".repeat(60)}`);
      logger.info(`Testing tweet from ${tweet.created_at.toISOString()}`);
      logger.info(`Tweet: ${tweet.text}`);

      // Extract symbol
      const tokenSymbol = this.extractTokenSymbol(tweet.text);
      if (!tokenSymbol) {
        logger.warn("Could not extract token symbol");
        return {
          success: false,
          reason: "Symbol extraction failed",
          tweet: tweet.text,
        };
      }

      logger.info(`Extracted symbol: ${tokenSymbol}`);

      // Find on Bybit
      const bybitSymbol = await this.findBybitSymbol(tokenSymbol);
      if (!bybitSymbol) {
        logger.warn(`Token ${tokenSymbol} not found on Bybit`);
        return {
          success: false,
          reason: "Not available on Bybit",
          symbol: tokenSymbol,
          tweet: tweet.text,
        };
      }

      logger.info(`Found on Bybit: ${bybitSymbol}`);

      // Get historical prices
      logger.info("Fetching historical price data...");
      const priceData = await this.getHistoricalPrices(
        bybitSymbol,
        tweet.created_at
      );

      if (!priceData || !priceData.dataAvailable) {
        logger.warn("Historical price data not available");
        return {
          success: false,
          reason: "No historical data",
          symbol: bybitSymbol,
          tweet: tweet.text,
        };
      }

      // Calculate trade results (with leverage for futures)
      const entryPrice = priceData.entryPrice;
      const exitPrice = priceData.exitPrice;
      const leverage = this.config.leverage || 1;
      const amount = (this.orderAmount * leverage) / entryPrice;

      // Calculate P&L for futures
      const rawPriceChange = ((exitPrice - entryPrice) / entryPrice) * 100;
      const leveragedProfitPercent = rawPriceChange * leverage;
      const profit = this.orderAmount * (leveragedProfitPercent / 100);
      const profitPercent = leveragedProfitPercent;

      logger.info(`Entry Price: $${entryPrice.toFixed(6)}`);
      logger.info(`Exit Price: $${exitPrice.toFixed(6)}`);
      logger.info(`Price Change: ${rawPriceChange.toFixed(2)}%`);
      logger.info(`Leverage: ${leverage}x`);
      logger.info(`Stop Loss Hit: ${priceData.stopLossHit ? "YES" : "NO"}`);
      logger.info(
        `Profit/Loss: $${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`
      );
      logger.info(profitPercent > 0 ? "✅ WINNING TRADE" : "❌ LOSING TRADE");

      return {
        success: true,
        symbol: bybitSymbol,
        tokenSymbol: tokenSymbol,
        tweetDate: tweet.created_at,
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        orderAmount: this.orderAmount,
        leverage: leverage,
        priceChange: rawPriceChange,
        profit: profit,
        profitPercent: profitPercent,
        stopLossHit: priceData.stopLossHit,
        holdTimeSeconds: this.sellAfterSeconds,
        tweet: tweet.text,
        winning: profitPercent > 0,
      };
    } catch (error) {
      logger.error("Error backtesting trade:", error);
      return {
        success: false,
        reason: error.message,
        tweet: tweet.text,
      };
    }
  }

  // Run full backtest
  async run() {
    try {
      logger.info("=".repeat(60));
      logger.info("UPBIT LISTING STRATEGY BACKTEST (FUTURES PERPETUAL)");
      logger.info("=".repeat(60));
      logger.info(`Margin Per Trade: $${this.orderAmount} USDT`);
      logger.info(`Leverage: ${this.config.leverage || 1}x`);
      logger.info(
        `Position Size: $${this.orderAmount * (this.config.leverage || 1)} USDT`
      );
      logger.info(`Stop Loss: ${this.stopLossPercent}%`);
      logger.info(`Hold Time: ${this.sellAfterSeconds} seconds`);
      logger.info(`⚡ NO EXECUTION DELAY (Immediate entry at tweet time)`);
      logger.info("=".repeat(60));

      // Initialize APIs
      await this.initializeTwitter();
      await this.initializeBybit();

      // Fetch historical tweets
      const tweets = await this.fetchHistoricalTweets();

      if (tweets.length === 0) {
        logger.warn("No Upbit listing tweets found to backtest");
        return;
      }

      // Backtest each trade
      logger.info(`\nStarting backtest of ${tweets.length} tweets...\n`);

      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i];
        logger.info(`[${i + 1}/${tweets.length}] Processing...`);

        const result = await this.backtestTrade(tweet);
        this.results.push(result);

        // Rate limiting - wait between API calls
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Generate report
      this.generateReport();

      // Save results to file
      this.saveResults();
    } catch (error) {
      logger.error("Backtest failed:", error);
      throw error;
    }
  }

  // Generate performance report
  generateReport() {
    const successfulTrades = this.results.filter((r) => r.success);
    const failedTrades = this.results.filter((r) => !r.success);
    const winningTrades = successfulTrades.filter((r) => r.winning);
    const losingTrades = successfulTrades.filter((r) => !r.winning);

    const totalProfit = successfulTrades.reduce(
      (sum, r) => sum + (r.profit || 0),
      0
    );
    const totalProfitPercent =
      successfulTrades.length > 0
        ? (totalProfit / (successfulTrades.length * this.orderAmount)) * 100
        : 0;

    const winRate =
      successfulTrades.length > 0
        ? (winningTrades.length / successfulTrades.length) * 100
        : 0;

    const avgWinPercent =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, r) => sum + r.profitPercent, 0) /
          winningTrades.length
        : 0;

    const avgLossPercent =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, r) => sum + r.profitPercent, 0) /
          losingTrades.length
        : 0;

    const stopLossCount = successfulTrades.filter((r) => r.stopLossHit).length;

    logger.info("\n" + "=".repeat(60));
    logger.info("BACKTEST RESULTS");
    logger.info("=".repeat(60));
    logger.info(`Total Tweets Analyzed: ${this.results.length}`);
    logger.info(`Successful Trades: ${successfulTrades.length}`);
    logger.info(`Failed Trades: ${failedTrades.length}`);
    logger.info("");
    logger.info("TRADE BREAKDOWN:");
    logger.info(
      `  Winning Trades: ${winningTrades.length} (${winRate.toFixed(2)}%)`
    );
    logger.info(
      `  Losing Trades: ${losingTrades.length} (${(100 - winRate).toFixed(2)}%)`
    );
    logger.info(`  Stop Loss Hit: ${stopLossCount} times`);
    logger.info("");
    logger.info("PERFORMANCE METRICS:");
    logger.info(
      `  Total P/L: $${totalProfit.toFixed(2)} (${totalProfitPercent.toFixed(
        2
      )}%)`
    );
    logger.info(`  Avg Win: ${avgWinPercent.toFixed(2)}%`);
    logger.info(`  Avg Loss: ${avgLossPercent.toFixed(2)}%`);
    logger.info(
      `  Best Trade: ${Math.max(
        ...successfulTrades.map((r) => r.profitPercent)
      ).toFixed(2)}%`
    );
    logger.info(
      `  Worst Trade: ${Math.min(
        ...successfulTrades.map((r) => r.profitPercent)
      ).toFixed(2)}%`
    );
    logger.info("");
    logger.info("HYPOTHETICAL ACCOUNT PERFORMANCE:");
    const startingBalance = 100; // Starting with $100 account
    const endingBalance = startingBalance + totalProfit;
    const roi = ((endingBalance - startingBalance) / startingBalance) * 100;
    logger.info(`  Starting Balance: $${startingBalance.toFixed(2)}`);
    logger.info(`  Ending Balance: $${endingBalance.toFixed(2)}`);
    logger.info(`  ROI: ${roi.toFixed(2)}%`);
    logger.info("");
    logger.info("FAILED TRADES REASONS:");
    const failureReasons = {};
    failedTrades.forEach((trade) => {
      failureReasons[trade.reason] = (failureReasons[trade.reason] || 0) + 1;
    });
    Object.entries(failureReasons).forEach(([reason, count]) => {
      logger.info(`  ${reason}: ${count}`);
    });
    logger.info("=".repeat(60));

    // Display top 5 winners and losers
    if (successfulTrades.length > 0) {
      const sortedByProfit = [...successfulTrades].sort(
        (a, b) => b.profitPercent - a.profitPercent
      );

      logger.info("\nTOP 5 WINNING TRADES:");
      sortedByProfit.slice(0, 5).forEach((trade, i) => {
        logger.info(
          `${i + 1}. ${trade.symbol}: +${trade.profitPercent.toFixed(
            2
          )}% ($${trade.profit.toFixed(2)})`
        );
      });

      logger.info("\nTOP 5 LOSING TRADES:");
      sortedByProfit
        .slice(-5)
        .reverse()
        .forEach((trade, i) => {
          logger.info(
            `${i + 1}. ${trade.symbol}: ${trade.profitPercent.toFixed(
              2
            )}% ($${trade.profit.toFixed(2)})`
          );
        });
    }
  }

  // Save results to JSON file
  saveResults() {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, "-");
      const filename = `upbit-backtest-${timestamp}.json`;
      const filepath = path.join(__dirname, "logs", filename);

      // Ensure logs directory exists
      if (!fs.existsSync(path.join(__dirname, "logs"))) {
        fs.mkdirSync(path.join(__dirname, "logs"));
      }

      const report = {
        config: {
          orderAmount: this.orderAmount,
          stopLossPercent: this.stopLossPercent,
          sellAfterSeconds: this.sellAfterSeconds,
        },
        timestamp: new Date().toISOString(),
        results: this.results,
        summary: this.generateSummary(),
      };

      fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
      logger.info(`\nResults saved to: ${filepath}`);
    } catch (error) {
      logger.error("Error saving results:", error);
    }
  }

  // Generate summary object
  generateSummary() {
    const successfulTrades = this.results.filter((r) => r.success);
    const winningTrades = successfulTrades.filter((r) => r.winning);
    const losingTrades = successfulTrades.filter((r) => !r.winning);
    const totalProfit = successfulTrades.reduce(
      (sum, r) => sum + (r.profit || 0),
      0
    );

    return {
      totalTweets: this.results.length,
      successfulTrades: successfulTrades.length,
      failedTrades: this.results.filter((r) => !r.success).length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate:
        successfulTrades.length > 0
          ? (winningTrades.length / successfulTrades.length) * 100
          : 0,
      totalProfit: totalProfit,
      totalProfitPercent:
        successfulTrades.length > 0
          ? (totalProfit / (successfulTrades.length * this.orderAmount)) * 100
          : 0,
      avgWin:
        winningTrades.length > 0
          ? winningTrades.reduce((sum, r) => sum + r.profitPercent, 0) /
            winningTrades.length
          : 0,
      avgLoss:
        losingTrades.length > 0
          ? losingTrades.reduce((sum, r) => sum + r.profitPercent, 0) /
            losingTrades.length
          : 0,
      bestTrade:
        successfulTrades.length > 0
          ? Math.max(...successfulTrades.map((r) => r.profitPercent))
          : 0,
      worstTrade:
        successfulTrades.length > 0
          ? Math.min(...successfulTrades.map((r) => r.profitPercent))
          : 0,
    };
  }
}

// Main function
async function main() {
  try {
    const config = {
      twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
      twitterUsername: process.env.TWITTER_USERNAME || "NewListingsFeed",
      // Note: Bybit API credentials NOT needed for backtesting (only public historical data)
      orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 100,
      leverage: parseFloat(process.env.LEVERAGE) || 10,
      stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 5,
      sellAfterSeconds: parseInt(process.env.SELL_AFTER_SECONDS) || 60,
      maxTrades: parseInt(process.env.MAX_BACKTEST_TRADES) || 50,
    };

    // Validate Twitter token (only requirement for backtesting)
    if (!config.twitterBearerToken) {
      logger.error("TWITTER_BEARER_TOKEN is required for backtesting");
      logger.error("Please set it in your env.upbit-listing file");
      logger.info(
        "\nNote: Bybit API credentials are NOT needed for backtesting"
      );
      logger.info("Backtesting only uses public historical price data");
      process.exit(1);
    }

    const backtest = new UpbitListingBacktest(config);
    await backtest.run();
  } catch (error) {
    logger.error("Backtest error:", error);
    process.exit(1);
  }
}

// Run backtest
main();
