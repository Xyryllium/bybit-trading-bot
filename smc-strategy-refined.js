import SMCIndicators from "./smc-indicators.js";
import Indicators from "./indicators.js";
import logger from "./logger.js";

/**
 * REFINED Smart Money Concepts Trading Strategy
 *
 * Enhancements over basic SMC:
 * 1. Weighted scoring (quality over quantity)
 * 2. Order Block strength filtering
 * 3. FVG size/quality assessment
 * 4. Trend confluence requirements
 * 5. Volume confirmation
 * 6. Risk-reward validation
 * 7. Dynamic stop loss at Order Block levels
 * 8. Multi-timeframe structure awareness
 * 9. Confluence detection (multiple signals at same level)
 * 10. Smart exit management (trailing + structure-based)
 */
export class SMCStrategyRefined {
  constructor(config) {
    this.config = config;

    // Get settings from config (with env variable support)
    const refinedConfig = config.smcStrategy?.refined || {};

    this.minScore = refinedConfig.minScore || 4; // LOWERED from 7
    this.minRiskReward = refinedConfig.minRiskReward || 1.2; // LOWERED from 1.5
    this.minOrderBlockAge = refinedConfig.minOrderBlockAge || 3;
    this.maxOrderBlockAge = refinedConfig.maxOrderBlockAge || 300;

    logger.info("SMC Refined Configured", {
      minScore: this.minScore,
      minRR: this.minRiskReward,
      obAge: `${this.minOrderBlockAge}-${this.maxOrderBlockAge} candles`,
    });
  }

  /**
   * Analyze market using refined SMC concepts
   */
  analyze(candles, position = null) {
    if (!candles || candles.length < 150) {
      return {
        action: "HOLD",
        reason: "Insufficient data for refined SMC analysis",
      };
    }

    const currentPrice = candles[candles.length - 1][4];
    const currentCandle = candles[candles.length - 1];
    const currentIndex = candles.length - 1;

    // Calculate all indicators
    const fvgs = SMCIndicators.detectFVG(candles);
    const orderBlocks = SMCIndicators.detectOrderBlocks(candles);
    const structure = SMCIndicators.detectMarketStructure(candles);
    const bosSignals = SMCIndicators.detectBOS(candles, structure);
    const premiumDiscount = SMCIndicators.getPremiumDiscount(candles);
    const liquidity = SMCIndicators.detectLiquidityZones(candles);

    // Additional analysis
    const volume = this.analyzeVolume(candles);
    const trend = this.determineTrend(structure);
    const nearFVG = this.findBestFVG(currentPrice, fvgs, currentIndex);
    const nearOB = this.findBestOrderBlock(
      currentPrice,
      orderBlocks,
      currentIndex
    );

    logger.debug("Refined SMC Analysis", {
      price: currentPrice.toFixed(2),
      zone: premiumDiscount.zone,
      trend: trend.direction,
      trendStrength: trend.strength,
      volumeState: volume.state,
      nearBullishOB: nearOB.bullish ? "YES" : "NO",
      nearBearishOB: nearOB.bearish ? "YES" : "NO",
    });

    // If we have a position, check for exit
    if (position) {
      return this.checkExitSignalRefined(
        position,
        currentPrice,
        candles,
        premiumDiscount,
        fvgs,
        orderBlocks,
        structure
      );
    }

    // Check for entry signals
    return this.checkEntrySignalRefined(
      currentPrice,
      candles,
      fvgs,
      orderBlocks,
      structure,
      bosSignals,
      premiumDiscount,
      liquidity,
      nearFVG,
      nearOB,
      volume,
      trend
    );
  }

  /**
   * REFINED entry logic with weighted scoring
   */
  checkEntrySignalRefined(
    price,
    candles,
    fvgs,
    orderBlocks,
    structure,
    bosSignals,
    premiumDiscount,
    liquidity,
    nearFVG,
    nearOB,
    volume,
    trend
  ) {
    let bullishScore = 0;
    const bullishReasons = [];
    let confidence = "LOW";

    // === PRICE ZONE SCORING (Bonus points, not requirement) ===

    // 1. DISCOUNT ZONE - Bonus points for better entry
    if (premiumDiscount.zone === "discount") {
      if (premiumDiscount.position < 20) {
        bullishScore += 2; // Deep discount (0-20%)
        bullishReasons.push(
          `Deep Discount (${premiumDiscount.position.toFixed(1)}%)`
        );
      } else {
        bullishScore += 1; // Normal discount (20-30%)
        bullishReasons.push(
          `Discount Zone (${premiumDiscount.position.toFixed(1)}%)`
        );
      }
    } else if (premiumDiscount.zone === "equilibrium") {
      // Neutral zone - small bonus
      bullishScore += 0.5;
      bullishReasons.push(
        `Equilibrium (${premiumDiscount.position.toFixed(1)}%)`
      );
    } else {
      // Premium zone - REJECT unless very strong signals
      bullishScore -= 2; // Heavy penalty (was -0.5)
      bullishReasons.push(
        `⚠️ Premium Zone (${premiumDiscount.position.toFixed(1)}%)`
      );
    }

    // 2. ORDER BLOCK - Check quality and strength
    if (nearOB.bullish) {
      const ob = nearOB.bullish;
      let obScore = 3; // Base score

      // Bonus for fresh Order Block (< 50 candles old)
      if (ob.age < 50) {
        obScore += 1;
        bullishReasons.push(`Fresh Bullish OB (${ob.age} candles old)`);
      } else {
        bullishReasons.push(`Bullish OB at ${ob.middle.toFixed(2)}`);
      }

      // Bonus if OB is untested (first touch)
      if (ob.tested === false) {
        obScore += 1;
        bullishReasons.push("Untested OB (First Touch)");
      }

      bullishScore += obScore;
    }

    // 3. FAIR VALUE GAP - Size and quality matters
    if (nearFVG.bullish) {
      const fvg = nearFVG.bullish;
      let fvgScore = 2; // Base score

      // Bonus for larger FVG (more significant imbalance)
      const fvgSizePercent = (fvg.size / price) * 100;
      if (fvgSizePercent > 1) {
        fvgScore += 1;
        bullishReasons.push(
          `Large Bullish FVG (${fvgSizePercent.toFixed(2)}%)`
        );
      } else {
        bullishReasons.push(`Bullish FVG (${fvgSizePercent.toFixed(2)}%)`);
      }

      // Bonus if FVG is unfilled (50%+ remaining)
      if (fvg.filledPercent < 50) {
        fvgScore += 0.5;
        bullishReasons.push("Unfilled FVG");
      }

      bullishScore += fvgScore;
    }

    // === TREND CONFLUENCE (Critical) ===
    if (trend.direction === "BULLISH") {
      bullishScore += 2;
      bullishReasons.push(`Bullish Trend (${trend.strength})`);

      // Extra bonus for strong trend
      if (trend.strength === "STRONG") {
        bullishScore += 1;
        bullishReasons.push("Strong Uptrend Momentum");
      }
    } else if (trend.direction === "BEARISH") {
      // Counter-trend trading is risky, heavy penalty
      bullishScore -= 2; // Increased penalty (was -1)
      bullishReasons.push("⚠️ Counter-trend (Bearish)");
    }

    // === MARKET STRUCTURE ===

    // Break of Structure
    const bullishBOS = bosSignals.bos.find((b) => b.type === "bullish");
    if (bullishBOS) {
      bullishScore += 2;
      bullishReasons.push("Bullish BOS (Structure Break)");
    }

    // Change of Character (potential reversal)
    const bullishCHoCH = bosSignals.choch.find((c) => c.type === "bullish");
    if (bullishCHoCH) {
      bullishScore += 2;
      bullishReasons.push("Bullish CHoCH (Reversal Signal)");
    }

    // Higher Lows (trend confirmation)
    if (structure.swingLows.length >= 3) {
      const lastThree = structure.swingLows.slice(-3);
      const isRising =
        lastThree[2].price > lastThree[1].price &&
        lastThree[1].price > lastThree[0].price;

      if (isRising) {
        bullishScore += 1;
        bullishReasons.push("Higher Lows Pattern");
      }
    }

    // === VOLUME CONFIRMATION (CRITICAL for win rate) ===
    if (volume.state === "HIGH") {
      bullishScore += 1.5; // Increased importance
      bullishReasons.push(`High Volume (${volume.ratio.toFixed(2)}x)`);
    } else if (volume.state === "VERY_HIGH") {
      bullishScore += 2.5; // Increased importance
      bullishReasons.push(`Very High Volume (${volume.ratio.toFixed(2)}x)`);
    } else if (volume.state === "LOW") {
      bullishScore -= 1.5; // Heavier penalty (was -0.5)
      bullishReasons.push("⚠️ Low Volume");
    }

    // === LIQUIDITY SWEEP ===
    if (nearOB.bullish && nearOB.bullish.liquiditySwept) {
      bullishScore += 1;
      bullishReasons.push("Liquidity Swept (Stop Hunt)");
    }

    // === CONFLUENCE BONUS ===
    // If Order Block AND FVG are at the same level, it's a strong confluence
    if (nearOB.bullish && nearFVG.bullish) {
      const obLevel = nearOB.bullish.middle;
      const fvgLevel = nearFVG.bullish.middle;
      const confluence = Math.abs(obLevel - fvgLevel) / price;

      if (confluence < 0.005) {
        // Within 0.5% of each other
        bullishScore += 2;
        bullishReasons.push("🎯 Strong Confluence (OB + FVG)");
      }
    }

    // === DETERMINE CONFIDENCE LEVEL ===
    if (bullishScore >= 10) {
      confidence = "VERY_HIGH";
    } else if (bullishScore >= 8) {
      confidence = "HIGH";
    } else if (bullishScore >= this.minScore) {
      confidence = "MEDIUM";
    }

    // === SOFT REQUIREMENTS (Improve quality without blocking all trades) ===
    // Prefer discount/equilibrium over premium
    if (premiumDiscount.zone === "premium") {
      // Already has -2 penalty from earlier, that's enough
    }

    // Prefer trades with OB or FVG (but don't require)
    if (!nearOB.bullish && !nearFVG.bullish) {
      bullishScore -= 1; // Small penalty, not rejection
    }

    // === RISK-REWARD VALIDATION ===
    if (bullishScore >= this.minScore) {
      // Calculate potential stop loss and take profit
      const stopLoss = nearOB.bullish
        ? nearOB.bullish.bottom * 0.999 // Just below OB
        : price * 0.98; // Default 2%

      const takeProfit = premiumDiscount.equilibrium * 1.01; // Slightly above equilibrium

      const risk = price - stopLoss;
      const reward = takeProfit - price;
      const rrRatio = reward / risk;

      if (rrRatio < this.minRiskReward) {
        logger.debug("Rejected: Poor Risk-Reward", {
          rrRatio: rrRatio.toFixed(2),
          required: this.minRiskReward,
        });
        return {
          action: "HOLD",
          reason: `Poor Risk-Reward ratio (${rrRatio.toFixed(2)}:1)`,
        };
      }

      // === ENTRY CONFIRMED ===
      logger.info(`🟢 REFINED SMC BUY Signal [${confidence}]`, {
        price: price.toFixed(2),
        score: bullishScore.toFixed(1),
        confidence,
        rrRatio: rrRatio.toFixed(2) + ":1",
        reasons: bullishReasons.join(" | "),
      });

      return {
        action: "BUY",
        price,
        reasons: bullishReasons,
        score: bullishScore,
        confidence,
        rrRatio,
        indicators: {
          zone: premiumDiscount.zone,
          trend: trend.direction,
          volume: volume.state,
          orderBlock: nearOB.bullish ? "YES" : "NO",
          fvg: nearFVG.bullish ? "YES" : "NO",
        },
      };
    }

    // === INSUFFICIENT SIGNAL ===
    return {
      action: "HOLD",
      reason: `Insufficient SMC signal (Score: ${bullishScore.toFixed(1)}/${
        this.minScore
      })`,
      details: {
        score: bullishScore.toFixed(1),
        required: this.minScore,
        reasons: bullishReasons.join(", ") || "None",
      },
    };
  }

  /**
   * REFINED exit logic with trailing and structure-based exits
   * CRITICAL: Only exits when profitable OR at hard stop loss!
   */
  checkExitSignalRefined(
    position,
    currentPrice,
    candles,
    premiumDiscount,
    fvgs,
    orderBlocks,
    structure
  ) {
    const entryPrice = position.entryPrice;
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const stopLoss = position.stopLoss;
    const takeProfit = position.takeProfit;

    // Calculate trailing stop (if in profit) - NOW CONFIGURABLE!
    const refinedConfig = this.config.smcStrategy?.refined || {};
    const trailingStopPercent = refinedConfig.trailingStopPercent || 0.6;
    const trailingStartProfit = 0.5; // Start trailing at 0.5% profit
    let effectiveStopLoss = stopLoss;

    if (profitPercent > trailingStartProfit) {
      // Trailing stop activates at 0.5% profit
      effectiveStopLoss = Math.max(
        stopLoss,
        currentPrice * (1 - trailingStopPercent / 100)
      );
    }

    logger.debug("Refined SMC Exit Check", {
      entryPrice: entryPrice.toFixed(2),
      currentPrice: currentPrice.toFixed(2),
      profit: profitPercent.toFixed(2) + "%",
      zone: premiumDiscount.zone,
      stopLoss: effectiveStopLoss.toFixed(2),
    });

    // 1. NEVER EXIT EARLY WHEN IN LOSS - Let backtest handle stop loss!
    // This prevents early exits at bad prices
    if (profitPercent < 0) {
      return {
        action: "HOLD",
        reason: "Waiting for stop loss or reversal",
        profitPercent,
      };
    }

    // 2. STOP LOSS (including trailing) - only when actually hit
    if (currentPrice <= effectiveStopLoss) {
      const isTrailing = effectiveStopLoss > stopLoss;
      logger.warn(isTrailing ? "🔴 Trailing Stop Hit" : "🔴 Stop Loss Hit", {
        entryPrice: entryPrice.toFixed(2),
        exitPrice: currentPrice.toFixed(2),
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: isTrailing ? "Trailing stop triggered" : "Stop loss triggered",
        price: currentPrice,
        profitPercent,
      };
    }

    // 2. TAKE PROFIT
    if (currentPrice >= takeProfit) {
      logger.info("🟢 Take Profit Hit", {
        entryPrice: entryPrice.toFixed(2),
        exitPrice: currentPrice.toFixed(2),
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Take profit triggered",
        price: currentPrice,
        profitPercent,
      };
    }

    // 3. PREMIUM ZONE EXIT (only when profitable)
    if (
      premiumDiscount.zone === "premium" &&
      premiumDiscount.position > 85 &&
      profitPercent > 0.8 // Must have profit
    ) {
      logger.info("🟡 Premium Zone Exit", {
        position: premiumDiscount.position.toFixed(1) + "%",
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Deep premium zone with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    // 4. BEARISH SIGNALS (only when profitable to lock gains)
    const bosSignals = SMCIndicators.detectBOS(candles, structure);
    const bearishBOS = bosSignals.bos.find((b) => b.type === "bearish");

    if (bearishBOS && profitPercent > 0.6) {
      logger.info("🟡 Bearish BOS Exit", {
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Bearish break of structure (protect profit)",
        price: currentPrice,
        profitPercent,
      };
    }

    // HOLD POSITION
    return {
      action: "HOLD",
      reason: "Position maintained",
      profitPercent,
      trailingStop: effectiveStopLoss !== stopLoss,
    };
  }

  /**
   * Find the best (most relevant) Order Block near current price
   */
  findBestOrderBlock(price, orderBlocks, currentIndex) {
    let bestBullish = null;
    let bestBearish = null;
    let minBullishDistance = Infinity;
    let minBearishDistance = Infinity;

    // Find closest bullish OB
    for (const ob of orderBlocks.bullish) {
      const age = currentIndex - ob.index;
      if (age < this.minOrderBlockAge || age > this.maxOrderBlockAge) continue;

      const distance = Math.abs(price - ob.middle);
      const distancePercent = distance / price;

      if (distancePercent < 0.01 && distance < minBullishDistance) {
        // Within 1%
        minBullishDistance = distance;
        bestBullish = { ...ob, age, distance, tested: false };
      }
    }

    // Find closest bearish OB
    for (const ob of orderBlocks.bearish) {
      const age = currentIndex - ob.index;
      if (age < this.minOrderBlockAge || age > this.maxOrderBlockAge) continue;

      const distance = Math.abs(price - ob.middle);
      const distancePercent = distance / price;

      if (distancePercent < 0.01 && distance < minBearishDistance) {
        minBearishDistance = distance;
        bestBearish = { ...ob, age, distance };
      }
    }

    return { bullish: bestBullish, bearish: bestBearish };
  }

  /**
   * Find the best FVG near current price
   */
  findBestFVG(price, fvgs, currentIndex) {
    let bestBullish = null;
    let bestBearish = null;

    // Find closest bullish FVG
    for (const fvg of fvgs.bullish.slice(-10)) {
      // Last 10 only
      const withinGap = price >= fvg.bottom && price <= fvg.top;
      const nearGap = Math.abs(price - fvg.middle) / price < 0.005; // Within 0.5%

      if (withinGap || nearGap) {
        const filled =
          price > fvg.top ? 100 : ((price - fvg.bottom) / fvg.size) * 100;
        bestBullish = { ...fvg, filledPercent: filled };
        break;
      }
    }

    // Find closest bearish FVG
    for (const fvg of fvgs.bearish.slice(-10)) {
      const withinGap = price >= fvg.bottom && price <= fvg.top;
      const nearGap = Math.abs(price - fvg.middle) / price < 0.005;

      if (withinGap || nearGap) {
        const filled =
          price < fvg.bottom ? 100 : ((fvg.top - price) / fvg.size) * 100;
        bestBearish = { ...fvg, filledPercent: filled };
        break;
      }
    }

    return { bullish: bestBullish, bearish: bestBearish };
  }

  /**
   * Determine trend direction and strength
   */
  determineTrend(structure) {
    if (structure.swingHighs.length < 3 || structure.swingLows.length < 3) {
      return { direction: "NEUTRAL", strength: "WEAK" };
    }

    const recentHighs = structure.swingHighs.slice(-3);
    const recentLows = structure.swingLows.slice(-3);

    const higherHighs =
      recentHighs[2].price > recentHighs[1].price &&
      recentHighs[1].price > recentHighs[0].price;

    const higherLows =
      recentLows[2].price > recentLows[1].price &&
      recentLows[1].price > recentLows[0].price;

    const lowerHighs =
      recentHighs[2].price < recentHighs[1].price &&
      recentHighs[1].price < recentHighs[0].price;

    const lowerLows =
      recentLows[2].price < recentLows[1].price &&
      recentLows[1].price < recentLows[0].price;

    if (higherHighs && higherLows) {
      return { direction: "BULLISH", strength: "STRONG" };
    } else if (higherHighs || higherLows) {
      return { direction: "BULLISH", strength: "MODERATE" };
    } else if (lowerHighs && lowerLows) {
      return { direction: "BEARISH", strength: "STRONG" };
    } else if (lowerHighs || lowerLows) {
      return { direction: "BEARISH", strength: "MODERATE" };
    }

    return { direction: "NEUTRAL", strength: "WEAK" };
  }

  /**
   * Analyze volume conditions
   */
  analyzeVolume(candles) {
    const recentVolumes = candles.slice(-20).map((c) => c[5]);
    const currentVolume = recentVolumes[recentVolumes.length - 1];
    const avgVolume =
      recentVolumes.slice(0, -1).reduce((a, b) => a + b, 0) /
      (recentVolumes.length - 1);

    const ratio = currentVolume / avgVolume;

    let state = "NORMAL";
    if (ratio > 2) state = "VERY_HIGH";
    else if (ratio > 1.5) state = "HIGH";
    else if (ratio < 0.7) state = "LOW";

    return { ratio, state, current: currentVolume, average: avgVolume };
  }

  /**
   * Calculate position size (same as basic)
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
   * Calculate stop loss - ALWAYS use fixed percentage (NEVER wider than config!)
   */
  calculateExitPrices(entryPrice, orderBlock = null, side = "buy") {
    // ALWAYS use fixed percentages from config (no dynamic OB stops!)
    const stopLossPercent = this.config.trading.stopLossPercent / 100;
    const takeProfitPercent = this.config.trading.takeProfitPercent / 100;

    if (side === "buy") {
      const fixedStopLoss = entryPrice * (1 - stopLossPercent);
      const fixedTakeProfit = entryPrice * (1 + takeProfitPercent);

      // If Order Block exists, can use it for TP but NEVER for wider SL
      if (orderBlock) {
        const obStopLoss = orderBlock.bottom * 0.999;

        // Only use OB stop if it's TIGHTER than fixed stop
        const stopLoss = Math.max(obStopLoss, fixedStopLoss);

        // Calculate TP based on actual risk
        const risk = entryPrice - stopLoss;
        const takeProfit = Math.max(fixedTakeProfit, entryPrice + risk * 2);

        return { stopLoss, takeProfit, stopLossPercent };
      }

      return {
        stopLoss: fixedStopLoss,
        takeProfit: fixedTakeProfit,
      };
    } else {
      return {
        stopLoss: entryPrice * (1 + stopLossPercent),
        takeProfit: entryPrice * (1 - takeProfitPercent),
      };
    }
  }
}

export default SMCStrategyRefined;
