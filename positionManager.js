import logger from "./logger.js";

/**
 * Position Manager - Handles position tracking and order execution
 */
export class PositionManager {
  constructor(exchange, config) {
    this.exchange = exchange;
    this.config = config;
    this.currentPosition = null;
    this.dailyTrades = [];
    this.dailyLoss = 0;
    this.lastResetDate = new Date().toDateString();
  }

  /**
   * Reset daily statistics
   */
  resetDailyStats() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      logger.info("Resetting daily statistics");
      this.dailyTrades = [];
      this.dailyLoss = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Check if daily limits are reached
   */
  isDailyLimitReached(balance) {
    this.resetDailyStats();

    const lossCount = this.dailyTrades.filter((t) => t.profit < 0).length;
    const dailyLossPercent = Math.abs(this.dailyLoss) / balance;

    if (lossCount >= this.config.trading.maxDailyLosses) {
      logger.warn("Daily loss limit reached (max losing trades)", {
        lossCount,
        maxDailyLosses: this.config.trading.maxDailyLosses,
      });
      return true;
    }

    if (dailyLossPercent >= this.config.trading.dailyLossLimit) {
      logger.warn("Daily loss limit reached (max loss percentage)", {
        dailyLossPercent: (dailyLossPercent * 100).toFixed(2) + "%",
        dailyLossLimit: this.config.trading.dailyLossLimit * 100 + "%",
      });
      return true;
    }

    return false;
  }

  /**
   * Check if we can enter a new position
   */
  canEnterPosition(balance) {
    if (this.currentPosition) {
      logger.debug("Cannot enter position - already in position");
      return false;
    }

    if (this.isDailyLimitReached(balance)) {
      return false;
    }

    return true;
  }

  /**
   * Execute market buy order
   */
  async executeBuy(symbol, quantity, price, stopLoss, takeProfit) {
    try {
      logger.info("Executing BUY order", {
        symbol,
        quantity: quantity.toFixed(6),
        price: price.toFixed(2),
        stopLoss: stopLoss.toFixed(2),
        takeProfit: takeProfit.toFixed(2),
      });

      if (this.config.bot.dryRun) {
        logger.info("🧪 DRY RUN - Order simulation");

        this.currentPosition = {
          symbol,
          side: "buy",
          quantity,
          entryPrice: price,
          stopLoss,
          takeProfit,
          entryTime: new Date(),
          positionValue: quantity * price,
          orderId: "DRY_RUN_" + Date.now(),
        };

        return this.currentPosition;
      }

      // Real order execution
      const order = await this.exchange.createMarketBuyOrder(symbol, quantity);

      logger.info("✅ BUY Order Filled", {
        orderId: order.id,
        symbol: order.symbol,
        quantity: order.amount,
        price: order.price || order.average,
        cost: order.cost,
      });

      this.currentPosition = {
        symbol,
        side: "buy",
        quantity: order.amount,
        entryPrice: order.price || order.average,
        stopLoss,
        takeProfit,
        entryTime: new Date(),
        positionValue: order.cost,
        orderId: order.id,
      };

      return this.currentPosition;
    } catch (error) {
      logger.error("Failed to execute BUY order", {
        error: error.message,
        symbol,
        quantity,
      });
      throw error;
    }
  }

  /**
   * Execute market sell order
   */
  async executeSell(symbol, quantity, price, reason) {
    try {
      if (!this.currentPosition) {
        logger.warn("No position to sell");
        return null;
      }

      logger.info("Executing SELL order", {
        symbol,
        quantity: quantity.toFixed(6),
        price: price.toFixed(2),
        reason,
      });

      const entryPrice = this.currentPosition.entryPrice;
      const profitLoss = (price - entryPrice) * quantity;
      const profitPercent = ((price - entryPrice) / entryPrice) * 100;

      if (this.config.bot.dryRun) {
        logger.info("🧪 DRY RUN - Order simulation");

        const trade = {
          symbol,
          entryPrice,
          exitPrice: price,
          quantity,
          profit: profitLoss,
          profitPercent,
          reason,
          entryTime: this.currentPosition.entryTime,
          exitTime: new Date(),
          orderId: "DRY_RUN_" + Date.now(),
        };

        this.recordTrade(trade);
        this.currentPosition = null;

        return trade;
      }

      // Real order execution
      const order = await this.exchange.createMarketSellOrder(symbol, quantity);

      logger.info("✅ SELL Order Filled", {
        orderId: order.id,
        symbol: order.symbol,
        quantity: order.amount,
        price: order.price || order.average,
        profitLoss: profitLoss.toFixed(2),
        profitPercent: profitPercent.toFixed(2) + "%",
      });

      const trade = {
        symbol,
        entryPrice,
        exitPrice: order.price || order.average,
        quantity: order.amount,
        profit: profitLoss,
        profitPercent,
        reason,
        entryTime: this.currentPosition.entryTime,
        exitTime: new Date(),
        orderId: order.id,
      };

      this.recordTrade(trade);
      this.currentPosition = null;

      return trade;
    } catch (error) {
      logger.error("Failed to execute SELL order", {
        error: error.message,
        symbol,
        quantity,
      });
      throw error;
    }
  }

  /**
   * Record trade statistics
   */
  recordTrade(trade) {
    this.dailyTrades.push(trade);

    if (trade.profit < 0) {
      this.dailyLoss += Math.abs(trade.profit);
    }

    const emoji = trade.profit >= 0 ? "💰" : "📉";

    logger.info(`${emoji} Trade Closed`, {
      reason: trade.reason,
      entryPrice: trade.entryPrice.toFixed(2),
      exitPrice: trade.exitPrice.toFixed(2),
      quantity: trade.quantity.toFixed(6),
      profit: trade.profit.toFixed(2) + " USDT",
      profitPercent: trade.profitPercent.toFixed(2) + "%",
      duration:
        Math.round((trade.exitTime - trade.entryTime) / 1000 / 60) + " minutes",
    });
  }

  /**
   * Get current position
   */
  getPosition() {
    return this.currentPosition;
  }

  /**
   * Get position status
   */
  getPositionStatus(currentPrice) {
    if (!this.currentPosition) {
      return null;
    }

    const unrealizedPL =
      (currentPrice - this.currentPosition.entryPrice) *
      this.currentPosition.quantity;
    const unrealizedPercent =
      ((currentPrice - this.currentPosition.entryPrice) /
        this.currentPosition.entryPrice) *
      100;

    return {
      ...this.currentPosition,
      currentPrice,
      unrealizedPL,
      unrealizedPercent,
      duration:
        Math.round((new Date() - this.currentPosition.entryTime) / 1000 / 60) +
        " minutes",
    };
  }

  /**
   * Get trading statistics
   */
  getStats() {
    const totalTrades = this.dailyTrades.length;
    const winningTrades = this.dailyTrades.filter((t) => t.profit > 0).length;
    const losingTrades = this.dailyTrades.filter((t) => t.profit < 0).length;
    const totalProfit = this.dailyTrades.reduce((sum, t) => sum + t.profit, 0);
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: winRate.toFixed(2) + "%",
      totalProfit: totalProfit.toFixed(2) + " USDT",
      dailyLoss: this.dailyLoss.toFixed(2) + " USDT",
    };
  }

  /**
   * Close position at market (emergency exit)
   */
  async closePositionAtMarket(reason = "Manual close") {
    if (!this.currentPosition) {
      logger.warn("No position to close");
      return null;
    }

    try {
      const ticker = await this.exchange.fetchTicker(
        this.currentPosition.symbol
      );
      const currentPrice = ticker.last;

      return await this.executeSell(
        this.currentPosition.symbol,
        this.currentPosition.quantity,
        currentPrice,
        reason
      );
    } catch (error) {
      logger.error("Failed to close position at market", {
        error: error.message,
      });
      throw error;
    }
  }
}

export default PositionManager;
