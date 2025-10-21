import dotenv from "dotenv";
dotenv.config({ path: "./env.upbit-listing" });
import logger from "./logger.js";
import axios from "axios";
import ccxt from "ccxt";

// Upbit Official API Announcement Bot - ELIMINATES THE 1.5 HOUR DELAY!
class UpbitOfficialAPIBot {
  constructor(config) {
    this.config = config;
    this.bybitClient = null;

    // Track announcements and pending listings
    this.lastAnnouncementId = 0;
    this.pendingListings = new Map(); // token -> { announcement, bybitSymbol, announcedAt }
    this.isRunning = false;

    this.upbitAnnouncementApi = axios.create({
      baseURL: "https://api-manager.upbit.com",
      timeout: 2000,
      headers: {
        "User-Agent": "UpbitOfficialAPIBot/1.0",
        Accept: "application/json",
        Referer: "https://upbit.com/service_center/notice",
      },
    });

    this.upbitMarketApi = axios.create({
      baseURL: "https://api.upbit.com",
      timeout: 800,
      headers: {
        Accept: "application/json",
        "User-Agent": "UpbitOfficialAPIBot/1.0",
      },
    });

    this.metrics = {
      announcementsDetected: 0,
      apiConfirmations: 0,
      tradesExecuted: 0,
      totalLatency: [],
    };
  }

  async initialize() {
    try {
      logger.info("🚀 Initializing Upbit Official API Bot...");

      // Initialize Bybit for trading
      this.bybitClient = new ccxt.bybit({
        apiKey: this.config.bybitApiKey,
        secret: this.config.bybitApiSecret,
        enableRateLimit: false,
        options: {
          defaultType: "swap",
          adjustForTimeDifference: true,
        },
        timeout: 1500,
      });

      await this.bybitClient.loadMarkets();
      logger.info(
        `✅ Bybit initialized with ${
          Object.keys(this.bybitClient.markets).length
        } markets`
      );

      // Get initial announcement ID to start monitoring
      await this.getInitialAnnouncementId();

      logger.info("✅ Upbit Official API Bot initialized successfully");
      logger.info("🎯 This bot will detect announcements INSTANTLY!");
      logger.info("⚡ No more 1.5-hour delays!");
    } catch (error) {
      logger.error("❌ Failed to initialize:", error.message);
      throw error;
    }
  }

  async getInitialAnnouncementId() {
    try {
      const response = await this.upbitAnnouncementApi.get(
        "/api/v1/announcements",
        {
          params: {
            os: "web",
            page: 1,
            per_page: 1,
            category: "all",
          },
        }
      );

      if (response.data.success && response.data.data.notices.length > 0) {
        this.lastAnnouncementId = response.data.data.notices[0].id;
        logger.info(
          `📊 Starting from announcement ID: ${this.lastAnnouncementId}`
        );
      }
    } catch (error) {
      logger.warn(
        `⚠️  Could not get initial announcement ID: ${error.message}`
      );
    }
  }

  async checkUpbitAnnouncements() {
    try {
      const response = await this.upbitAnnouncementApi.get(
        "/api/v1/announcements",
        {
          params: {
            os: "web",
            page: 1,
            per_page: 20,
            category: "all",
          },
        }
      );

      if (!response.data.success) {
        logger.warn("⚠️  API response not successful");
        return;
      }

      const announcements = response.data.data.notices;

      // Find new announcements (higher ID than last seen)
      const newAnnouncements = announcements.filter(
        (announcement) => announcement.id > this.lastAnnouncementId
      );

      if (newAnnouncements.length > 0) {
        logger.info(
          `🚨 ${newAnnouncements.length} NEW ANNOUNCEMENTS DETECTED!`
        );

        for (const announcement of newAnnouncements) {
          await this.processAnnouncement(announcement);
        }

        // Update last seen ID
        this.lastAnnouncementId = Math.max(...announcements.map((a) => a.id));
      }
    } catch (error) {
      logger.error("❌ Error checking announcements:");
      logger.error("   Status:", error.response?.status);
      logger.error("   Message:", error.message);
      logger.error("   Data:", error.response?.data);
    }
  }

  async processAnnouncement(announcement) {
    try {
      logger.info(`📢 NEW ANNOUNCEMENT: ${announcement.title}`);
      logger.info(`   📅 Listed at: ${announcement.listed_at}`);
      logger.info(`   🏷️  Category: ${announcement.category}`);
      logger.info(`   🆔 ID: ${announcement.id}`);

      // Check if it's a trading announcement (both Korean and English)
      if (
        announcement.category !== "거래" &&
        announcement.category !== "Trade"
      ) {
        logger.info(
          `   ⏭️  Skipping non-trading announcement (${announcement.category})`
        );
        return;
      }

      // Extract token symbol from title
      const tokenSymbol = this.extractTokenSymbol(announcement.title);
      if (!tokenSymbol) {
        logger.warn(
          `   ⚠️  Could not extract token symbol from: ${announcement.title}`
        );
        return;
      }

      logger.info(`   🎯 Token detected: ${tokenSymbol}`);

      // Check if available on Bybit
      const bybitSymbol = await this.findBybitSymbol(tokenSymbol);
      if (!bybitSymbol) {
        logger.warn(`   ⚠️  ${tokenSymbol} not available on Bybit`);
        return;
      }

      // Store as pending listing
      this.pendingListings.set(tokenSymbol, {
        tokenSymbol,
        bybitSymbol,
        announcement,
        announcedAt: new Date(announcement.listed_at),
        source: "upbit_official_api",
      });

      this.metrics.announcementsDetected++;

      logger.info(
        `   ✅ ${tokenSymbol} added to pending list (${bybitSymbol})`
      );
      logger.info(`   ⏰ Waiting for API confirmation...`);
      logger.info(`   📊 Pending listings: ${this.pendingListings.size}`);
    } catch (error) {
      logger.error(`   ❌ Error processing announcement:`, error.message);
    }
  }

  async checkUpbitApiListings() {
    try {
      const response = await this.upbitMarketApi.get("/v1/market/all");
      const markets = response.data;
      const currentMarkets = new Set(markets.map((m) => m.market));

      // Check if any pending listings are now live
      for (const [tokenSymbol, listing] of this.pendingListings.entries()) {
        const upbitMarkets = markets.filter((market) =>
          market.market.includes(`-${tokenSymbol}`)
        );

        if (upbitMarkets.length > 0) {
          logger.info(`🚨 CONFIRMED: ${tokenSymbol} is now LIVE on Upbit!`);

          for (const market of upbitMarkets) {
            logger.info(
              `   📊 Market: ${market.market} - ${market.english_name}`
            );
          }

          const delay = Date.now() - listing.announcedAt.getTime();
          logger.info(
            `   ⏱️  Delay from announcement: ${Math.round(delay / 1000)}s`
          );

          // Execute trade immediately
          await this.executeTrade(
            listing.bybitSymbol,
            tokenSymbol,
            listing.announcement
          );

          // Remove from pending
          this.pendingListings.delete(tokenSymbol);
          this.metrics.apiConfirmations++;
        }
      }
    } catch (error) {
      logger.error("❌ Error checking Upbit API:", error.message);
    }
  }

  async executeTrade(bybitSymbol, tokenSymbol, announcement) {
    try {
      logger.info(`🚀 EXECUTING TRADE: ${bybitSymbol}`);

      const startTime = Date.now();

      const [ticker, orderAmount] = await Promise.all([
        this.bybitClient.fetchTicker(bybitSymbol),
        this.getOrderAmount(),
      ]);

      const currentPrice = ticker.last;
      const orderSize = (orderAmount * this.config.leverage) / currentPrice;
      const amount = this.bybitClient.amountToPrecision(bybitSymbol, orderSize);

      logger.info(
        `   💰 Order: ${amount} ${bybitSymbol} @ $${currentPrice} | ${this.config.leverage}x`
      );
      logger.info(`   📢 Source: Upbit Official API (${announcement.title})`);

      const order = await this.bybitClient.createMarketBuyOrder(
        bybitSymbol,
        amount
      );

      const executionTime = Date.now() - startTime;
      logger.info(`   ✅ ORDER PLACED! ID: ${order.id}`);
      logger.info(`   ⚡ Execution time: ${executionTime}ms`);

      this.metrics.tradesExecuted++;
      this.metrics.totalLatency.push(executionTime);

      // Schedule auto-sell
      this.scheduleAutoSell(bybitSymbol, amount);
    } catch (error) {
      logger.error(`   ❌ Trade failed:`, error.message);
    }
  }

  scheduleAutoSell(symbol, amount) {
    logger.info(`   ⏰ Auto-sell scheduled: ${this.config.sellAfterSeconds}s`);

    setTimeout(async () => {
      try {
        const ticker = await this.bybitClient.fetchTicker(symbol);
        const currentPrice = ticker.last;

        await this.bybitClient.createMarketSellOrder(symbol, amount, {
          reduceOnly: true,
        });

        logger.info(`   ✅ POSITION CLOSED: ${symbol} @ $${currentPrice}`);
      } catch (error) {
        logger.error(`   ❌ Auto-sell failed:`, error.message);
      }
    }, this.config.sellAfterSeconds * 1000);
  }

  async getOrderAmount() {
    if (this.config.useAccountPercentage) {
      const balance = await this.bybitClient.fetchBalance();
      const accountBalance = balance.USDT?.free || 0;
      return (accountBalance * this.config.accountPercentage) / 100;
    }
    return this.config.orderAmount;
  }

  extractTokenSymbol(title) {
    // Extract token symbol from announcement titles (Korean and English)
    const patterns = [
      /\(([A-Z0-9]+)\)/, // (BIO), (BTC), etc.
      /([A-Z0-9]{2,10})\s*신규/, // BIO 신규 (Korean)
      /([A-Z0-9]{2,10})\s*거래/, // BIO 거래 (Korean)
      /Market Support for ([A-Z0-9]+)/i, // Market Support for BIO (English)
      /([A-Z0-9]+)\s*\(/, // BIO ( at start
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  async findBybitSymbol(tokenSymbol) {
    const markets = this.bybitClient.markets;
    const possibleSymbols = [
      `${tokenSymbol}/USDT:USDT`,
      `${tokenSymbol}/USD:USDT`,
      `${tokenSymbol}/USDT`,
    ];

    for (const symbol of possibleSymbols) {
      if (markets[symbol] && markets[symbol].type === "swap") {
        return symbol;
      }
    }
    return null;
  }

  start() {
    this.isRunning = true;
    logger.info("🚀 Starting Upbit Official API Bot...");

    setInterval(() => {
      if (this.isRunning) {
        this.checkUpbitAnnouncements();
      }
    }, 500);

    setInterval(() => {
      if (this.isRunning) {
        this.checkUpbitApiListings();
      }
    }, 200);

    // Log status every 5 minutes
    setInterval(() => {
      this.logStatus();
    }, 5 * 60 * 1000);

    logger.info("✅ Upbit Official API Bot is now running!");
    logger.info("   🚨 Announcements: Checking every 500ms");
    logger.info("   🔄 API Confirmations: Checking every 200ms");
    logger.info(`   📊 Pending listings: ${this.pendingListings.size}`);
    logger.info(
      "   🎯 Target: https://api-manager.upbit.com/api/v1/announcements"
    );
  }

  logStatus() {
    logger.info("📊 UPBIT OFFICIAL API STATUS:");
    logger.info(
      `   Announcements Detected: ${this.metrics.announcementsDetected}`
    );
    logger.info(`   API Confirmations: ${this.metrics.apiConfirmations}`);
    logger.info(`   Trades Executed: ${this.metrics.tradesExecuted}`);
    logger.info(`   Pending Listings: ${this.pendingListings.size}`);

    if (this.metrics.totalLatency.length > 0) {
      const avgLatency =
        this.metrics.totalLatency.reduce((a, b) => a + b, 0) /
        this.metrics.totalLatency.length;
      logger.info(`   Average Execution Time: ${Math.round(avgLatency)}ms`);
    }

    for (const [token, listing] of this.pendingListings.entries()) {
      const age = Math.round(
        (Date.now() - listing.announcedAt.getTime()) / 1000
      );
      logger.info(`   ${token}: ${age}s since announcement`);
    }
  }

  stop() {
    this.isRunning = false;
    logger.info("🛑 Upbit Official API Bot stopped");
  }
}

// Configuration
const config = {
  bybitApiKey: process.env.BYBIT_API_KEY,
  bybitApiSecret: process.env.BYBIT_API_SECRET,
  useAccountPercentage: process.env.USE_ACCOUNT_PERCENTAGE !== "false",
  accountPercentage: parseFloat(process.env.ACCOUNT_PERCENTAGE) || 10,
  orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 100,
  leverage: parseFloat(process.env.LEVERAGE) || 10,
  sellAfterSeconds: parseInt(process.env.SELL_AFTER_SECONDS) || 60,
};

// Main function
async function main() {
  try {
    logger.info("=".repeat(80));
    logger.info("🚀 UPBIT OFFICIAL API BOT 🚀");
    logger.info("=".repeat(80));

    const bot = new UpbitOfficialAPIBot(config);
    await bot.initialize();

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("\n🛑 Shutting down gracefully...");
      bot.stop();
      process.exit(0);
    });

    bot.start();
  } catch (error) {
    logger.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

// Run the bot
main();
