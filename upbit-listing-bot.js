import dotenv from "dotenv";
dotenv.config({ path: "./env.upbit-listing" });
import UpbitListingStrategy from "./upbit-listing-strategy.js";
import logger from "./logger.js";

// Configuration
const config = {
  // Twitter API credentials
  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
  twitterUsername: process.env.TWITTER_USERNAME || "NewListingsFeed",
  twitterUserId: process.env.TWITTER_USER_ID, // Optional: NewListingsFeed user ID

  // Bybit API credentials
  bybitApiKey: process.env.BYBIT_API_KEY,
  bybitApiSecret: process.env.BYBIT_API_SECRET,

  // Trading parameters
  useAccountPercentage: process.env.USE_ACCOUNT_PERCENTAGE !== "false", // Default true
  accountPercentage: parseFloat(process.env.ACCOUNT_PERCENTAGE) || 10, // 10% of account
  orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 100, // Fallback USDT per trade
  leverage: parseFloat(process.env.LEVERAGE) || 10, // 10x leverage
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 5,
  sellAfterSeconds: parseInt(process.env.SELL_AFTER_SECONDS) || 60, // Auto-sell after X seconds
  maxOrdersPerDay: parseInt(process.env.MAX_ORDERS_PER_DAY) || 5,
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

// Main function
async function main() {
  try {
    logger.info("=".repeat(60));
    logger.info("UPBIT LISTING TRADING BOT");
    logger.info("=".repeat(60));

    // Validate configuration
    validateConfig();

    // Create and start strategy
    const strategy = new UpbitListingStrategy(config);

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("\nReceived SIGINT, shutting down gracefully...");
      await strategy.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("\nReceived SIGTERM, shutting down gracefully...");
      await strategy.stop();
      process.exit(0);
    });

    // Start the strategy
    await strategy.start();

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
