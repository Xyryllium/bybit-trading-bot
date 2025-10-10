import dotenv from "dotenv";
dotenv.config({ path: "./env.upbit-listing" });
import UpbitListingStrategy from "./upbit-listing-strategy.js";
import logger from "./logger.js";
import { TwitterApi } from "twitter-api-v2";

// Configuration
const config = {
  // Twitter API credentials
  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
  twitterUsername: process.env.TWITTER_USERNAME || "NewListingsFeed",

  // Bybit API credentials
  bybitApiKey: process.env.BYBIT_API_KEY,
  bybitApiSecret: process.env.BYBIT_API_SECRET,

  // Trading parameters
  useAccountPercentage: process.env.USE_ACCOUNT_PERCENTAGE !== "false",
  accountPercentage: parseFloat(process.env.ACCOUNT_PERCENTAGE) || 10,
  orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 100,
  leverage: parseFloat(process.env.LEVERAGE) || 10,
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 5,
  sellAfterSeconds: parseInt(process.env.SELL_AFTER_SECONDS) || 60,
  maxOrdersPerDay: parseInt(process.env.MAX_ORDERS_PER_DAY) || 5,

  // Polling configuration
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS) || 10, // Check every 10 seconds
};

// Validate required configuration
function validateConfig() {
  const required = ["twitterBearerToken", "bybitApiKey", "bybitApiSecret"];

  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    logger.error("Missing required configuration:");
    missing.forEach((key) => logger.error(`  - ${key}`));
    logger.error("\nPlease check your env.upbit-listing file");
    process.exit(1);
  }
}

// Polling-based Twitter monitor (instead of streaming)
class TwitterPoller {
  constructor(config, strategy) {
    this.config = config;
    this.strategy = strategy;
    this.twitterClient = new TwitterApi(config.twitterBearerToken);
    this.userId = null;
    this.lastTweetId = null;
    this.isRunning = false;
    this.pollInterval = null;
  }

  async initialize() {
    try {
      // Get user ID
      const user = await this.twitterClient.v2.userByUsername(
        this.config.twitterUsername
      );
      this.userId = user.data.id;
      logger.info(
        `Initialized Twitter poller for @${this.config.twitterUsername} (ID: ${this.userId})`
      );
    } catch (error) {
      logger.error("Failed to initialize Twitter poller:", error);
      throw error;
    }
  }

  async checkForNewTweets() {
    try {
      const params = {
        max_results: 5,
        "tweet.fields": ["created_at", "text"],
        exclude: ["retweets", "replies"],
      };

      // Add since_id if we have a last tweet ID
      if (this.lastTweetId) {
        params.since_id = this.lastTweetId;
      }

      const timeline = await this.twitterClient.v2.userTimeline(
        this.userId,
        params
      );

      const tweets = timeline.data.data || [];

      if (tweets.length === 0) {
        logger.debug("No new tweets");
        return;
      }

      // Update last tweet ID
      this.lastTweetId = tweets[0].id;

      // Process tweets in chronological order (oldest first)
      const reversedTweets = [...tweets].reverse();

      for (const tweet of reversedTweets) {
        await this.processTweet(tweet);
      }
    } catch (error) {
      if (error.code === 429) {
        logger.warn("Rate limit hit, waiting before next poll...");
      } else {
        logger.error("Error checking tweets:", error.message);
      }
    }
  }

  async processTweet(tweetData) {
    try {
      const tweetText = tweetData.text;
      const tweetId = tweetData.id;

      // Check if tweet mentions Upbit listing
      const upbitListingPattern = /listed\s+on\s+(@official_)?upbit/i;
      if (!upbitListingPattern.test(tweetText)) {
        return;
      }

      logger.info("🚨 UPBIT LISTING DETECTED! 🚨");
      logger.info(`Tweet: ${tweetText}`);

      // Format tweet for strategy processor
      const formattedTweet = {
        data: {
          id: tweetId,
          text: tweetText,
          created_at: tweetData.created_at,
        },
        includes: {
          users: [{ username: this.config.twitterUsername }],
        },
      };

      // Pass to strategy
      await this.strategy.processTweet(formattedTweet);
    } catch (error) {
      logger.error("Error processing tweet:", error);
    }
  }

  start() {
    this.isRunning = true;
    logger.info(
      `Starting Twitter poller (checking every ${this.config.pollIntervalSeconds} seconds)`
    );

    // Poll immediately
    this.checkForNewTweets();

    // Then poll at interval
    this.pollInterval = setInterval(() => {
      if (this.isRunning) {
        this.checkForNewTweets();
      }
    }, this.config.pollIntervalSeconds * 1000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("Twitter poller stopped");
  }
}

// Main function
async function main() {
  try {
    logger.info("=".repeat(60));
    logger.info("UPBIT LISTING TRADING BOT (POLLING MODE)");
    logger.info("=".repeat(60));

    // Validate configuration
    validateConfig();

    // Create strategy instance
    const strategy = new UpbitListingStrategy(config);

    // Initialize Bybit
    await strategy.initializeBybit();

    // Create Twitter poller instead of stream
    const poller = new TwitterPoller(config, strategy);
    await poller.initialize();

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("\nReceived SIGINT, shutting down gracefully...");
      poller.stop();
      await strategy.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("\nReceived SIGTERM, shutting down gracefully...");
      poller.stop();
      await strategy.stop();
      process.exit(0);
    });

    // Start polling
    poller.start();

    logger.info("Strategy is now running and monitoring for Upbit listings!");
    logger.info(`Mode: Polling every ${config.pollIntervalSeconds} seconds`);
    if (strategy.useAccountPercentage) {
      logger.info(
        `Trading Mode: ${strategy.accountPercentage}% of account balance per trade`
      );
      logger.info(
        `Current Balance: ${strategy.accountBalance.toFixed(2)} USDT`
      );
      logger.info(
        `Per Trade Margin: ~${(
          (strategy.accountBalance * strategy.accountPercentage) /
          100
        ).toFixed(2)} USDT`
      );
    } else {
      logger.info(`Trading Mode: Fixed ${strategy.orderAmount} USDT per trade`);
    }
    logger.info(`Leverage: ${strategy.leverage}x`);
    logger.info(`Max orders per day: ${strategy.maxOrdersPerDay}`);
    logger.info(`Stop Loss: ${strategy.stopLossPercent}%`);
    logger.info(
      `Auto-sell after: ${strategy.sellAfterSeconds} seconds (${
        strategy.sellAfterSeconds / 60
      } minute)`
    );

    // Log status every 5 minutes
    setInterval(() => {
      const status = strategy.getStatus();
      logger.info("Strategy Status:", status);
    }, 5 * 60 * 1000);
  } catch (error) {
    logger.error("Fatal error:", error);
    process.exit(1);
  }
}

// Run the bot
main();
