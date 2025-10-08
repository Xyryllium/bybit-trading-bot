import Indicators from "./indicators.js";
import logger from "./logger.js";

/**
 * Trading Strategy - Momentum based with RSI and EMA
 */
export class TradingStrategy {
  constructor(config) {
    this.config = config;
    this.rsiPeriod = config.strategy.rsi.period;
    this.rsiOversold = config.strategy.rsi.oversold;
    this.rsiOverbought = config.strategy.rsi.overbought;
    this.fastEMA = config.strategy.ema.fastPeriod;
    this.slowEMA = config.strategy.ema.slowPeriod;
    this.volumeMultiplier = config.strategy.volume.multiplier;
    this.volumePeriod = config.strategy.volume.period;
  }

  /**
   * Analyze market data and generate trading signal
   * @param {Array} candles - Array of OHLCV candles
   * @param {Object} position - Current position (if any)
   * @returns {Object} Signal object with action and data
   */
  analyze(candles, position = null) {
    if (!candles || candles.length < this.slowEMA + this.rsiPeriod) {
      return { action: "HOLD", reason: "Insufficient data for analysis" };
    }

    // Extract price and volume data
    const closes = candles.map((c) => c[4]); // Close prices
    const volumes = candles.map((c) => c[5]); // Volumes
    const highs = candles.map((c) => c[2]); // High prices
    const lows = candles.map((c) => c[3]); // Low prices

    // Calculate indicators
    const rsi = Indicators.calculateRSI(closes, this.rsiPeriod);
    const fastEMA = Indicators.calculateEMA(closes, this.fastEMA);
    const slowEMA = Indicators.calculateEMA(closes, this.slowEMA);
    const crossover = Indicators.detectEMACrossover(
      closes,
      this.fastEMA,
      this.slowEMA
    );
    const avgVolume = Indicators.calculateAverageVolume(
      volumes,
      this.volumePeriod
    );
    const currentVolume = volumes[volumes.length - 1];
    const currentPrice = closes[closes.length - 1];
    const volatility = Indicators.calculateVolatility(closes, 20);

    logger.debug("Strategy Analysis", {
      price: currentPrice,
      rsi: rsi?.toFixed(2),
      fastEMA: fastEMA?.toFixed(2),
      slowEMA: slowEMA?.toFixed(2),
      crossover,
      volume: currentVolume,
      avgVolume: avgVolume?.toFixed(2),
      volatility: volatility?.toFixed(2),
    });

    // If we have a position, check for exit signals
    if (position) {
      return this.checkExitSignal(position, currentPrice, rsi);
    }

    // Check for entry signals
    return this.checkEntrySignal(
      currentPrice,
      rsi,
      fastEMA,
      slowEMA,
      crossover,
      currentVolume,
      avgVolume,
      volatility
    );
  }

  /**
   * Check for entry signal
   */
  checkEntrySignal(
    price,
    rsi,
    fastEMA,
    slowEMA,
    crossover,
    volume,
    avgVolume,
    volatility
  ) {
    const reasons = [];
    let score = 0;

    // RSI conditions
    if (rsi < this.rsiOversold) {
      reasons.push(`RSI oversold (${rsi.toFixed(2)})`);
      score += 3;
    } else if (rsi >= 30 && rsi <= 50) {
      reasons.push(`RSI bullish zone (${rsi.toFixed(2)})`);
      score += 1;
    }

    // EMA crossover
    if (crossover === "bullish") {
      reasons.push("Bullish EMA crossover");
      score += 3;
    } else if (fastEMA > slowEMA) {
      reasons.push("Fast EMA above Slow EMA");
      score += 1;
    }

    // Volume confirmation
    if (volume > avgVolume * this.volumeMultiplier) {
      reasons.push(`High volume (${(volume / avgVolume).toFixed(2)}x avg)`);
      score += 2;
    }

    // Volatility check (avoid extremely volatile conditions for small accounts)
    const volatilityPercent = (volatility / price) * 100;
    if (volatilityPercent > 5) {
      reasons.push(
        `High volatility (${volatilityPercent.toFixed(2)}%) - caution`
      );
      score -= 1;
    }

    // Decision threshold
    if (score >= 4) {
      logger.info("🟢 BUY Signal Generated", {
        price,
        score,
        reasons: reasons.join(", "),
      });

      return {
        action: "BUY",
        price,
        reasons,
        score,
        indicators: { rsi, fastEMA, slowEMA, volume, avgVolume },
      };
    }

    return {
      action: "HOLD",
      reason: `Insufficient signal strength (score: ${score}/4)`,
      details: reasons.join(", ") || "No conditions met",
    };
  }

  /**
   * Check for exit signal
   */
  checkExitSignal(position, currentPrice, rsi) {
    const entryPrice = position.entryPrice;
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const stopLoss = position.stopLoss;
    const takeProfit = position.takeProfit;

    logger.debug("Exit Check", {
      entryPrice,
      currentPrice,
      profitPercent: profitPercent.toFixed(2) + "%",
      stopLoss,
      takeProfit,
      rsi: rsi?.toFixed(2),
    });

    // Stop loss hit
    if (currentPrice <= stopLoss) {
      logger.warn("🔴 Stop Loss Hit", {
        entryPrice,
        currentPrice,
        loss: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Stop loss triggered",
        price: currentPrice,
        profitPercent,
      };
    }

    // Take profit hit
    if (currentPrice >= takeProfit) {
      logger.info("🟢 Take Profit Hit", {
        entryPrice,
        currentPrice,
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Take profit triggered",
        price: currentPrice,
        profitPercent,
      };
    }

    // RSI overbought exit (trailing strategy)
    if (
      rsi > this.rsiOverbought &&
      profitPercent > this.config.strategy.minProfitPercent
    ) {
      logger.info("🟡 RSI Overbought Exit", {
        rsi: rsi.toFixed(2),
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "RSI overbought with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    return {
      action: "HOLD",
      reason: "Position maintained",
      profitPercent,
    };
  }

  /**
   * Calculate position size based on risk management
   * @param {number} balance - Current account balance
   * @param {number} entryPrice - Entry price
   * @param {number} stopLossPrice - Stop loss price
   * @returns {Object} Position sizing details
   */
  calculatePositionSize(balance, entryPrice, stopLossPrice) {
    const riskAmount = balance * this.config.trading.riskPerTrade;
    const riskPerUnit = entryPrice - stopLossPrice;
    const quantity = riskAmount / riskPerUnit;

    // Calculate position value
    let positionValue = quantity * entryPrice;

    // Apply maximum position size limit
    const maxPositionValue = balance * this.config.trading.maxPositionSize;
    if (positionValue > maxPositionValue) {
      positionValue = maxPositionValue;
      const adjustedQuantity = positionValue / entryPrice;

      logger.info("Position size adjusted to max limit", {
        originalQuantity: quantity.toFixed(6),
        adjustedQuantity: adjustedQuantity.toFixed(6),
        maxPositionValue: maxPositionValue.toFixed(2),
      });

      return {
        quantity: adjustedQuantity,
        positionValue,
        riskAmount: adjustedQuantity * riskPerUnit,
        riskPercent: ((adjustedQuantity * riskPerUnit) / balance) * 100,
      };
    }

    return {
      quantity,
      positionValue,
      riskAmount,
      riskPercent: this.config.trading.riskPerTrade * 100,
    };
  }

  /**
   * Calculate stop loss and take profit prices
   * @param {number} entryPrice - Entry price
   * @param {string} side - 'buy' or 'sell'
   * @returns {Object} Stop loss and take profit prices
   */
  calculateExitPrices(entryPrice, side = "buy") {
    const stopLossPercent = this.config.trading.stopLossPercent / 100;
    const takeProfitPercent = this.config.trading.takeProfitPercent / 100;

    if (side === "buy") {
      return {
        stopLoss: entryPrice * (1 - stopLossPercent),
        takeProfit: entryPrice * (1 + takeProfitPercent),
      };
    } else {
      // For short positions (not implemented in this version)
      return {
        stopLoss: entryPrice * (1 + stopLossPercent),
        takeProfit: entryPrice * (1 - takeProfitPercent),
      };
    }
  }
}

export default TradingStrategy;
