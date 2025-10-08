import SMCIndicators from "./smc-indicators.js";
import logger from "./logger.js";

/**
 * Smart Money Concepts Trading Strategy
 * Uses Order Blocks, Fair Value Gaps, and Market Structure
 */
export class SMCStrategy {
  constructor(config) {
    this.config = config;

    // Get settings from config
    const smcConfig = config.smcStrategy || {};
    this.minScore = smcConfig.minScore || 5; // LOWERED from 6

    logger.info("SMC Strategy Configured", {
      minScore: this.minScore,
    });
  }

  /**
   * Analyze market using SMC concepts
   */
  analyze(candles, position = null) {
    if (!candles || candles.length < 100) {
      return { action: "HOLD", reason: "Insufficient data for SMC analysis" };
    }

    const currentPrice = candles[candles.length - 1][4];
    const currentCandle = candles[candles.length - 1];

    // Calculate SMC indicators
    const fvgs = SMCIndicators.detectFVG(candles);
    const orderBlocks = SMCIndicators.detectOrderBlocks(candles);
    const structure = SMCIndicators.detectMarketStructure(candles);
    const bosSignals = SMCIndicators.detectBOS(candles, structure);
    const premiumDiscount = SMCIndicators.getPremiumDiscount(candles);
    const liquidity = SMCIndicators.detectLiquidityZones(candles);

    // Check proximity to key levels
    const nearFVG = SMCIndicators.isPriceNearFVG(currentPrice, fvgs);
    const nearOB = SMCIndicators.isPriceNearOB(currentPrice, orderBlocks);

    logger.debug("SMC Analysis", {
      price: currentPrice,
      zone: premiumDiscount.zone,
      position: premiumDiscount.position.toFixed(2) + "%",
      bullishFVGs: fvgs.bullish.length,
      bearishFVGs: fvgs.bearish.length,
      bullishOBs: orderBlocks.bullish.length,
      bearishOBs: orderBlocks.bearish.length,
      bosSignals: bosSignals.bos.length,
      chochSignals: bosSignals.choch.length,
      nearBullishOB: nearOB.nearBullishOB,
      nearBearishOB: nearOB.nearBearishOB,
    });

    // If we have a position, check for exit
    if (position) {
      return this.checkExitSignal(
        position,
        currentPrice,
        premiumDiscount,
        fvgs,
        orderBlocks
      );
    }

    // Check for entry signals
    return this.checkEntrySignal(
      currentPrice,
      fvgs,
      orderBlocks,
      structure,
      bosSignals,
      premiumDiscount,
      liquidity,
      nearFVG,
      nearOB
    );
  }

  /**
   * Check for entry signal using SMC
   */
  checkEntrySignal(
    price,
    fvgs,
    orderBlocks,
    structure,
    bosSignals,
    premiumDiscount,
    liquidity,
    nearFVG,
    nearOB
  ) {
    let bullishScore = 0;
    let bearishScore = 0;
    const bullishReasons = [];
    const bearishReasons = [];

    // === BULLISH SIGNALS ===

    // 1. Price Zone Bonus (not a requirement)
    if (premiumDiscount.zone === "discount") {
      bullishScore += 2;
      bullishReasons.push(
        `In Discount Zone (${premiumDiscount.position.toFixed(1)}%)`
      );
    } else if (premiumDiscount.zone === "equilibrium") {
      bullishScore += 0.5;
      bullishReasons.push(
        `Equilibrium (${premiumDiscount.position.toFixed(1)}%)`
      );
    } else {
      // Premium zone - no bonus but still allow entry
      bullishReasons.push(
        `Premium Zone (${premiumDiscount.position.toFixed(1)}%)`
      );
    }

    // 2. Near Bullish Order Block
    if (nearOB.nearBullishOB) {
      bullishScore += 3;
      bullishReasons.push("Price at Bullish Order Block");
    }

    // 3. Bullish FVG nearby
    if (nearFVG.nearBullishFVG) {
      bullishScore += 2;
      bullishReasons.push("Near Bullish Fair Value Gap");
    }

    // 4. Bullish BOS (Break of Structure)
    const bullishBOS = bosSignals.bos.find((b) => b.type === "bullish");
    if (bullishBOS) {
      bullishScore += 3;
      bullishReasons.push("Bullish Break of Structure");
    }

    // 5. Bullish CHoCH (Change of Character)
    const bullishCHoCH = bosSignals.choch.find((c) => c.type === "bullish");
    if (bullishCHoCH) {
      bullishScore += 2;
      bullishReasons.push("Bullish Change of Character");
    }

    // 6. Near Buy-Side Liquidity (sweep potential)
    if (liquidity.buyLiquidity.length > 0) {
      const nearestLiquidity =
        liquidity.buyLiquidity[liquidity.buyLiquidity.length - 1];
      if (Math.abs(price - nearestLiquidity.price) / price < 0.01) {
        bullishScore += 1;
        bullishReasons.push("Near Buy-Side Liquidity");
      }
    }

    // 7. Market Structure: Higher Lows
    if (structure.swingLows.length >= 2) {
      const lastTwo = structure.swingLows.slice(-2);
      if (lastTwo[1].price > lastTwo[0].price) {
        bullishScore += 1;
        bullishReasons.push("Higher Lows (Uptrend)");
      }
    }

    // === BEARISH SIGNALS ===

    // 1. Price in Premium Zone (Above 70%)
    if (premiumDiscount.zone === "premium") {
      bearishScore += 2;
      bearishReasons.push(
        `In Premium Zone (${premiumDiscount.position.toFixed(1)}%)`
      );
    }

    // 2. Near Bearish Order Block
    if (nearOB.nearBearishOB) {
      bearishScore += 3;
      bearishReasons.push("Price at Bearish Order Block");
    }

    // 3. Bearish FVG nearby
    if (nearFVG.nearBearishFVG) {
      bearishScore += 2;
      bearishReasons.push("Near Bearish Fair Value Gap");
    }

    // 4. Bearish BOS
    const bearishBOS = bosSignals.bos.find((b) => b.type === "bearish");
    if (bearishBOS) {
      bearishScore += 3;
      bearishReasons.push("Bearish Break of Structure");
    }

    // 5. Bearish CHoCH
    const bearishCHoCH = bosSignals.choch.find((c) => c.type === "bearish");
    if (bearishCHoCH) {
      bearishScore += 2;
      bearishReasons.push("Bearish Change of Character");
    }

    // 6. Near Sell-Side Liquidity
    if (liquidity.sellLiquidity.length > 0) {
      const nearestLiquidity =
        liquidity.sellLiquidity[liquidity.sellLiquidity.length - 1];
      if (Math.abs(price - nearestLiquidity.price) / price < 0.01) {
        bearishScore += 1;
        bearishReasons.push("Near Sell-Side Liquidity");
      }
    }

    // 7. Market Structure: Lower Highs
    if (structure.swingHighs.length >= 2) {
      const lastTwo = structure.swingHighs.slice(-2);
      if (lastTwo[1].price < lastTwo[0].price) {
        bearishScore += 1;
        bearishReasons.push("Lower Highs (Downtrend)");
      }
    }

    // === DECISION ===

    // Only long positions for now (spot trading)
    if (bullishScore >= this.minScore && bullishScore > bearishScore) {
      logger.info("🟢 SMC BUY Signal", {
        price,
        score: bullishScore,
        reasons: bullishReasons.join(" | "),
      });

      return {
        action: "BUY",
        price,
        reasons: bullishReasons,
        score: bullishScore,
        indicators: {
          fvgs: fvgs.bullish.length,
          orderBlocks: orderBlocks.bullish.length,
          zone: premiumDiscount.zone,
        },
      };
    }

    // Log why we're not entering
    if (bullishScore > 0) {
      logger.debug("SMC Signal Insufficient", {
        bullishScore,
        bearishScore,
        required: this.minScore,
        bullishReasons: bullishReasons.join(" | "),
      });
    }

    return {
      action: "HOLD",
      reason: `Insufficient SMC signal (Bullish: ${bullishScore}, Bearish: ${bearishScore})`,
      details: {
        bullishReasons: bullishReasons.join(", ") || "None",
        bearishReasons: bearishReasons.join(", ") || "None",
      },
    };
  }

  /**
   * Check exit signal using SMC
   */
  checkExitSignal(position, currentPrice, premiumDiscount, fvgs, orderBlocks) {
    const entryPrice = position.entryPrice;
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const stopLoss = position.stopLoss;
    const takeProfit = position.takeProfit;

    logger.debug("SMC Exit Check", {
      entryPrice,
      currentPrice,
      profitPercent: profitPercent.toFixed(2) + "%",
      zone: premiumDiscount.zone,
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

    // SMC Exit: In Premium Zone with profit
    if (
      premiumDiscount.zone === "premium" &&
      profitPercent > this.config.strategy.minProfitPercent
    ) {
      logger.info("🟡 SMC Premium Zone Exit", {
        zone: premiumDiscount.zone,
        position: premiumDiscount.position.toFixed(2) + "%",
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Price in premium zone with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    // SMC Exit: Near Bearish Order Block with profit
    const nearBearishOB = SMCIndicators.isPriceNearOB(
      currentPrice,
      orderBlocks
    );
    if (
      nearBearishOB.nearBearishOB &&
      profitPercent > this.config.strategy.minProfitPercent
    ) {
      logger.info("🟡 SMC Bearish OB Exit", {
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Near bearish order block with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    // SMC Exit: Filled Bearish FVG with profit
    const nearBearishFVG = SMCIndicators.isPriceNearFVG(currentPrice, fvgs);
    if (
      nearBearishFVG.nearBearishFVG &&
      profitPercent > this.config.strategy.minProfitPercent
    ) {
      logger.info("🟡 SMC Bearish FVG Exit", {
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Filled bearish FVG with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    return {
      action: "HOLD",
      reason: "SMC position maintained",
      profitPercent,
    };
  }

  /**
   * Calculate position size based on risk management
   */
  calculatePositionSize(balance, entryPrice, stopLossPrice) {
    const riskAmount = balance * this.config.trading.riskPerTrade;
    const riskPerUnit = entryPrice - stopLossPrice;
    const quantity = riskAmount / riskPerUnit;

    let positionValue = quantity * entryPrice;

    const maxPositionValue = balance * this.config.trading.maxPositionSize;
    if (positionValue > maxPositionValue) {
      positionValue = maxPositionValue;
      const adjustedQuantity = positionValue / entryPrice;

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
   * Calculate stop loss and take profit using SMC levels
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
      return {
        stopLoss: entryPrice * (1 + stopLossPercent),
        takeProfit: entryPrice * (1 - takeProfitPercent),
      };
    }
  }
}

export default SMCStrategy;
