import Indicators from "./indicators.js";
import logger from "./logger.js";

/**
 * PRICE ACTION SCALPING Strategy
 *
 * Based on classic scalping patterns:
 * 1. Double Top / Double Bottom - Reversal patterns
 * 2. 3-4 Bar Plays - Quick momentum patterns
 * 3. Break and Retest - Support/Resistance bounces
 *
 * Optimized for:
 * - 1m-5m timeframes
 * - Quick entries and exits
 * - High probability setups
 * - Tight risk management
 */
export class ScalpingStrategy {
  constructor(config) {
    this.config = config;

    // Get settings from config (which reads from env)
    const scalpConfig = config.scalpingStrategy || {};

    // Pattern detection settings
    this.doubleTolerance = scalpConfig.doubleTolerance || 0.003;
    this.barPlayLength = 4; // Look for 3-4 bar patterns
    this.srTolerance = 0.005; // 0.5% tolerance for S/R levels
    this.minSRTouches = 2; // Minimum touches to confirm S/R

    // Risk management (from env or defaults)
    this.stopLossPercent = scalpConfig.stopLossPercent || 0.4;
    this.takeProfitPercent = scalpConfig.takeProfitPercent || 0.8;
    this.minScore = scalpConfig.minScore || 4;

    // Cooldown tracking (prevents same pattern from triggering multiple times)
    this.lastDoubleBottomLevel = null;
    this.lastDoubleBottomCandle = 0;
    this.lastBarPlayCandle = 0;
    this.lastBreakRetestLevel = null;
    this.lastBreakRetestCandle = 0;
    this.patternCooldown = scalpConfig.patternCooldown || 10;

    // Log configuration
    logger.info("Scalping Strategy Configured", {
      stopLoss: this.stopLossPercent + "%",
      takeProfit: this.takeProfitPercent + "%",
      minScore: this.minScore,
      cooldown: this.patternCooldown + " candles",
      doubleTolerance: (this.doubleTolerance * 100).toFixed(2) + "%",
    });
  }

  /**
   * Analyze market for scalping patterns
   */
  analyze(candles, position = null) {
    if (!candles || candles.length < 50) {
      return { action: "HOLD", reason: "Insufficient data for scalping" };
    }

    const currentPrice = candles[candles.length - 1][4];
    const currentCandle = candles[candles.length - 1];
    const currentCandleIndex = candles.length - 1;

    // Detect patterns
    let doubleBottom = this.detectDoubleBottom(candles);
    const doubleTop = this.detectDoubleTop(candles);
    let barPlay = this.detect34BarPlay(candles);
    let breakRetest = this.detectBreakAndRetest(candles);

    // Apply cooldown to prevent same pattern triggering multiple times
    if (doubleBottom.detected) {
      const levelSimilar =
        this.lastDoubleBottomLevel &&
        Math.abs(doubleBottom.level - this.lastDoubleBottomLevel) /
          doubleBottom.level <
          0.005;
      const tooSoon =
        currentCandleIndex - this.lastDoubleBottomCandle < this.patternCooldown;

      if (levelSimilar && tooSoon) {
        doubleBottom = { detected: false, level: 0, touches: 0 };
      }
    }

    if (barPlay.type === "BULLISH") {
      const tooSoon =
        currentCandleIndex - this.lastBarPlayCandle < this.patternCooldown;
      if (tooSoon) {
        barPlay = { type: null, bars: 0, strength: "WEAK" };
      }
    }

    if (breakRetest.detected && breakRetest.type === "BULLISH") {
      const levelSimilar =
        this.lastBreakRetestLevel &&
        Math.abs(breakRetest.level - this.lastBreakRetestLevel) /
          breakRetest.level <
          0.005;
      const tooSoon =
        currentCandleIndex - this.lastBreakRetestCandle < this.patternCooldown;

      if (levelSimilar && tooSoon) {
        breakRetest = { detected: false, type: null, level: 0 };
      }
    }

    // Support/Resistance levels
    const srLevels = this.findSupportResistanceLevels(candles);

    // Volume and momentum
    const volumes = candles.map((c) => c[5]);
    const avgVolume = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = currentVolume / avgVolume;

    logger.debug("Scalping Pattern Analysis", {
      price: currentPrice.toFixed(2),
      doubleBottom: doubleBottom.detected ? "YES" : "NO",
      doubleTop: doubleTop.detected ? "YES" : "NO",
      barPlay: barPlay.type || "NONE",
      breakRetest: breakRetest.detected ? breakRetest.type : "NONE",
      volumeRatio: volumeRatio.toFixed(2),
      srLevels: srLevels.length,
    });

    // If we have a position, check for exit
    if (position) {
      return this.checkScalpingExit(
        position,
        currentPrice,
        candles,
        doubleTop,
        srLevels
      );
    }

    // Check for entry signals
    return this.checkScalpingEntry(
      currentPrice,
      candles,
      doubleBottom,
      doubleTop,
      barPlay,
      breakRetest,
      srLevels,
      volumeRatio
    );
  }

  /**
   * Check for scalping entry based on patterns
   */
  checkScalpingEntry(
    currentPrice,
    candles,
    doubleBottom,
    doubleTop,
    barPlay,
    breakRetest,
    srLevels,
    volumeRatio
  ) {
    let bullishScore = 0;
    const bullishReasons = [];
    let setupType = null;
    const price = currentPrice; // Alias for consistency

    // === PATTERN 1: DOUBLE BOTTOM (Bullish Reversal) ===
    if (doubleBottom.detected) {
      bullishScore += 4; // Strong signal
      bullishReasons.push(
        `Double Bottom at ${doubleBottom.level.toFixed(2)} (${
          doubleBottom.touches
        } touches)`
      );
      setupType = "DOUBLE_BOTTOM";

      // Bonus if volume confirms
      if (volumeRatio > 1.2) {
        bullishScore += 1;
        bullishReasons.push("Volume Confirmation");
      }

      // Bonus if at support level
      const nearSupport = srLevels.find(
        (sr) =>
          sr.type === "support" &&
          Math.abs(price - sr.level) / price < this.srTolerance
      );
      if (nearSupport) {
        bullishScore += 1;
        bullishReasons.push("At Key Support Level");
      }
    }

    // === PATTERN 2: 3-4 BAR BULLISH PLAY ===
    if (barPlay.type === "BULLISH") {
      bullishScore += 3;
      bullishReasons.push(
        `${barPlay.bars}-Bar Bullish Play (${barPlay.strength})`
      );
      setupType = setupType || "BAR_PLAY";

      // Bonus for strong momentum bars
      if (barPlay.strength === "STRONG") {
        bullishScore += 1;
        bullishReasons.push("Strong Momentum Bars");
      }

      // Volume confirmation
      if (volumeRatio > 1.3) {
        bullishScore += 1;
        bullishReasons.push("High Volume Breakout");
      }
    }

    // === PATTERN 3: BREAK AND RETEST (Bullish) ===
    if (breakRetest.detected && breakRetest.type === "BULLISH") {
      bullishScore += 4; // Very strong signal
      bullishReasons.push(
        `Break & Retest of ${breakRetest.level.toFixed(2)} (${
          breakRetest.retestType
        })`
      );
      setupType = setupType || "BREAK_RETEST";

      // Bonus if clean retest (didn't break back below)
      if (breakRetest.retestType === "CLEAN") {
        bullishScore += 1;
        bullishReasons.push("Clean Retest Hold");
      }

      // Volume on breakout
      if (breakRetest.breakoutVolume > 1.5) {
        bullishScore += 1;
        bullishReasons.push("Strong Breakout Volume");
      }
    }

    // === SUPPORT/RESISTANCE CONFLUENCE ===
    const atSupport = srLevels.find(
      (sr) =>
        sr.type === "support" &&
        Math.abs(price - sr.level) / price < this.srTolerance &&
        sr.touches >= 2
    );

    if (atSupport && !breakRetest.detected) {
      bullishScore += 2;
      bullishReasons.push(
        `At Support (${atSupport.touches} touches at ${atSupport.level.toFixed(
          2
        )})`
      );
      setupType = setupType || "SUPPORT_BOUNCE";
    }

    // === VOLUME REQUIREMENT ===
    if (volumeRatio < 0.8 && bullishScore > 0) {
      bullishScore -= 1;
      bullishReasons.push("⚠️ Low Volume (Risk)");
    }

    // === DECISION ===
    if (bullishScore >= this.minScore) {
      // Update cooldown trackers
      if (doubleBottom.detected) {
        this.lastDoubleBottomLevel = doubleBottom.level;
        this.lastDoubleBottomCandle = candles.length - 1;
      }
      if (barPlay.type === "BULLISH") {
        this.lastBarPlayCandle = candles.length - 1;
      }
      if (breakRetest.detected && breakRetest.type === "BULLISH") {
        this.lastBreakRetestLevel = breakRetest.level;
        this.lastBreakRetestCandle = candles.length - 1;
      }

      logger.info(`⚡ SCALPING BUY - ${setupType}`, {
        price: price.toFixed(2),
        score: bullishScore.toFixed(1),
        setup: setupType,
        reasons: bullishReasons.join(" | "),
      });

      return {
        action: "BUY",
        price,
        reasons: bullishReasons,
        score: bullishScore,
        setupType,
        scalping: true,
      };
    }

    return {
      action: "HOLD",
      reason: `No scalping pattern (Score: ${bullishScore.toFixed(1)}/${
        this.minScore
      })`,
      details: {
        doubleBottom: doubleBottom.detected,
        barPlay: barPlay.type,
        breakRetest: breakRetest.detected,
      },
    };
  }

  /**
   * Check for scalping exit
   */
  checkScalpingExit(position, currentPrice, candles, doubleTop, srLevels) {
    const entryPrice = position.entryPrice;
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const stopLoss = position.stopLoss;
    const takeProfit = position.takeProfit;

    // Breakeven stop after 0.3% profit
    let effectiveStopLoss = stopLoss;
    if (profitPercent > 0.3) {
      effectiveStopLoss = Math.max(stopLoss, entryPrice * 1.0001);
    }

    logger.debug("Scalping Exit Check", {
      entryPrice: entryPrice.toFixed(2),
      currentPrice: currentPrice.toFixed(2),
      profit: profitPercent.toFixed(2) + "%",
    });

    // 1. STOP LOSS
    if (currentPrice <= effectiveStopLoss) {
      const isBreakeven = effectiveStopLoss > stopLoss;
      logger.warn(isBreakeven ? "🟡 Breakeven Stop" : "🔴 Stop Loss", {
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: isBreakeven ? "Breakeven stop" : "Stop loss triggered",
        price: currentPrice,
        profitPercent,
      };
    }

    // 2. TAKE PROFIT
    if (currentPrice >= takeProfit) {
      logger.info("⚡ Scalping Take Profit", {
        profit: profitPercent.toFixed(2) + "%",
      });

      return {
        action: "SELL",
        reason: "Scalping take profit",
        price: currentPrice,
        profitPercent,
      };
    }

    // 3. DOUBLE TOP EXIT (with profit)
    if (doubleTop.detected && profitPercent > 0.4) {
      logger.info("⚡ Double Top Exit", {
        profit: profitPercent.toFixed(2) + "%",
        level: doubleTop.level.toFixed(2),
      });

      return {
        action: "SELL",
        reason: "Double top pattern with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    // 4. RESISTANCE REJECTION (with profit)
    const atResistance = srLevels.find(
      (sr) =>
        sr.type === "resistance" &&
        Math.abs(currentPrice - sr.level) / currentPrice < this.srTolerance
    );

    if (atResistance && profitPercent > 0.4) {
      logger.info("⚡ Resistance Exit", {
        profit: profitPercent.toFixed(2) + "%",
        level: atResistance.level.toFixed(2),
      });

      return {
        action: "SELL",
        reason: "Hit resistance with profit",
        price: currentPrice,
        profitPercent,
      };
    }

    // 5. QUICK PROFIT WITH REVERSAL SIGNS
    if (profitPercent > 0.5) {
      const recentCandles = candles.slice(-3);
      const bearishBars = recentCandles.filter((c) => c[4] < c[1]).length;

      if (bearishBars >= 2) {
        logger.info("⚡ Quick Exit: Reversal Bars", {
          profit: profitPercent.toFixed(2) + "%",
        });

        return {
          action: "SELL",
          reason: "Reversal pattern with profit",
          price: currentPrice,
          profitPercent,
        };
      }
    }

    return {
      action: "HOLD",
      reason: "Position maintained",
      profitPercent,
      breakeven: effectiveStopLoss !== stopLoss,
    };
  }

  /**
   * PATTERN 1: Detect Double Bottom
   * Two lows at approximately the same level with clear reversal
   */
  detectDoubleBottom(candles) {
    const result = { detected: false, level: 0, touches: 0 };

    if (candles.length < 30) return result;

    const recentCandles = candles.slice(-50); // Last 50 candles
    const currentPrice = candles[candles.length - 1][4];
    const currentLow = candles[candles.length - 1][3];

    // Find swing lows (local minimums)
    const swingLows = [];
    for (let i = 5; i < recentCandles.length - 2; i++) {
      const candle = recentCandles[i];
      const isSwingLow =
        candle[3] <= recentCandles[i - 1][3] &&
        candle[3] <= recentCandles[i - 2][3] &&
        candle[3] <= recentCandles[i + 1][3] &&
        candle[3] <= recentCandles[i + 2][3];

      if (isSwingLow) {
        swingLows.push({ price: candle[3], index: i, candle });
      }
    }

    if (swingLows.length < 2) return result;

    // Find double bottom (two swing lows at similar level)
    for (let i = 0; i < swingLows.length - 1; i++) {
      for (let j = i + 1; j < swingLows.length; j++) {
        const low1 = swingLows[i];
        const low2 = swingLows[j];
        const diff = Math.abs(low1.price - low2.price) / low1.price;

        // Must be within tolerance AND separated by at least 10 candles
        if (diff < this.doubleTolerance && low2.index - low1.index >= 10) {
          const avgLow = (low1.price + low2.price) / 2;

          // Check if we just bounced from the second low
          const isNearSecondLow = j === swingLows.length - 1; // Most recent swing low
          const priceAboveLow = currentPrice > avgLow * 1.001; // Price above the low
          const recentBounce = currentPrice > currentLow; // Current candle closed above its low

          if (isNearSecondLow && priceAboveLow && recentBounce) {
            // Additional confirmation: check last 2-3 candles are rising
            const last3 = candles.slice(-3);
            const risingCandles = last3.filter(
              (c, idx) => idx === 0 || c[4] >= last3[idx - 1][4]
            ).length;

            if (risingCandles >= 2) {
              result.detected = true;
              result.level = avgLow;
              result.touches = 2;
              result.distance = ((currentPrice - avgLow) / currentPrice) * 100;
              return result;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * PATTERN 1: Detect Double Top
   * Two highs at approximately the same level with clear rejection
   */
  detectDoubleTop(candles) {
    const result = { detected: false, level: 0, touches: 0 };

    if (candles.length < 30) return result;

    const recentCandles = candles.slice(-50);
    const currentPrice = candles[candles.length - 1][4];
    const currentHigh = candles[candles.length - 1][2];

    // Find swing highs (local maximums)
    const swingHighs = [];
    for (let i = 5; i < recentCandles.length - 2; i++) {
      const candle = recentCandles[i];
      const isSwingHigh =
        candle[2] >= recentCandles[i - 1][2] &&
        candle[2] >= recentCandles[i - 2][2] &&
        candle[2] >= recentCandles[i + 1][2] &&
        candle[2] >= recentCandles[i + 2][2];

      if (isSwingHigh) {
        swingHighs.push({ price: candle[2], index: i, candle });
      }
    }

    if (swingHighs.length < 2) return result;

    // Find double top (two swing highs at similar level)
    for (let i = 0; i < swingHighs.length - 1; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        const high1 = swingHighs[i];
        const high2 = swingHighs[j];
        const diff = Math.abs(high1.price - high2.price) / high1.price;

        // Must be within tolerance AND separated by at least 10 candles
        if (diff < this.doubleTolerance && high2.index - high1.index >= 10) {
          const avgHigh = (high1.price + high2.price) / 2;

          // Check if we just rejected from the second high
          const isNearSecondHigh = j === swingHighs.length - 1;
          const priceBelowHigh = currentPrice < avgHigh * 0.999;
          const recentRejection = currentPrice < currentHigh;

          if (isNearSecondHigh && priceBelowHigh && recentRejection) {
            // Check last 2-3 candles are falling
            const last3 = candles.slice(-3);
            const fallingCandles = last3.filter(
              (c, idx) => idx === 0 || c[4] <= last3[idx - 1][4]
            ).length;

            if (fallingCandles >= 2) {
              result.detected = true;
              result.level = avgHigh;
              result.touches = 2;
              result.distance = ((avgHigh - currentPrice) / currentPrice) * 100;
              return result;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * PATTERN 2: Detect 3-4 Bar Plays
   * Consecutive bullish or bearish bars showing strong momentum
   */
  detect34BarPlay(candles) {
    const result = { type: null, bars: 0, strength: "WEAK" };

    if (candles.length < 5) return result;

    const recent = candles.slice(-this.barPlayLength);

    // Check for bullish 3-4 bar play (consecutive green candles)
    const bullishBars = recent.filter((c) => c[4] > c[1]); // Close > Open
    const bearishBars = recent.filter((c) => c[4] < c[1]);

    // Calculate average body size
    const bodySize = recent.map((c) => Math.abs(c[4] - c[1]));
    const avgBody = bodySize.reduce((a, b) => a + b, 0) / bodySize.length;
    const recentBody = Math.abs(
      recent[recent.length - 1][4] - recent[recent.length - 1][1]
    );

    // Bullish 3-4 bar play
    if (bullishBars.length >= 3) {
      result.type = "BULLISH";
      result.bars = bullishBars.length;

      // Check strength based on body size
      if (recentBody > avgBody * 1.5) {
        result.strength = "STRONG";
      } else if (recentBody > avgBody) {
        result.strength = "MODERATE";
      }

      // Additional check: bars should be increasing in size
      const bodySizes = bullishBars.map((c) => Math.abs(c[4] - c[1]));
      const isIncreasing = bodySizes[bodySizes.length - 1] > bodySizes[0];
      if (isIncreasing) {
        result.strength = "STRONG";
      }
    }

    // Bearish 3-4 bar play
    if (bearishBars.length >= 3) {
      result.type = "BEARISH";
      result.bars = bearishBars.length;

      if (recentBody > avgBody * 1.5) {
        result.strength = "STRONG";
      } else if (recentBody > avgBody) {
        result.strength = "MODERATE";
      }
    }

    return result;
  }

  /**
   * PATTERN 3: Detect Break and Retest
   * Price breaks through level, pulls back to test it, then continues
   */
  detectBreakAndRetest(candles) {
    const result = {
      detected: false,
      type: null,
      level: 0,
      retestType: null,
      breakoutVolume: 0,
    };

    if (candles.length < 30) return result;

    const currentPrice = candles[candles.length - 1][4];
    const srLevels = this.findSupportResistanceLevels(candles.slice(0, -10));

    // Check recent price action for break and retest
    const recent20 = candles.slice(-20);
    const volumes = recent20.map((c) => c[5]);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    for (const sr of srLevels) {
      // Check if price broke above resistance recently
      if (sr.type === "resistance") {
        const breakCandle = this.findBreakoutCandle(
          recent20,
          sr.level,
          "above"
        );

        if (breakCandle) {
          // Now check if it retested
          const candlesAfterBreak = recent20.slice(breakCandle.index + 1);
          const retest = this.findRetestCandle(
            candlesAfterBreak,
            sr.level,
            "above"
          );

          if (retest && retest.success) {
            const distanceToCurrent =
              Math.abs(currentPrice - sr.level) / currentPrice;

            // If currently near the retested level or bouncing up
            if (distanceToCurrent < 0.01 || currentPrice > sr.level) {
              result.detected = true;
              result.type = "BULLISH";
              result.level = sr.level;
              result.retestType = retest.clean ? "CLEAN" : "MESSY";
              result.breakoutVolume = breakCandle.volumeRatio;
            }
          }
        }
      }

      // Check if price broke below support recently
      if (sr.type === "support") {
        const breakCandle = this.findBreakoutCandle(
          recent20,
          sr.level,
          "below"
        );

        if (breakCandle) {
          const candlesAfterBreak = recent20.slice(breakCandle.index + 1);
          const retest = this.findRetestCandle(
            candlesAfterBreak,
            sr.level,
            "below"
          );

          if (retest && retest.success) {
            result.detected = true;
            result.type = "BEARISH";
            result.level = sr.level;
            result.retestType = retest.clean ? "CLEAN" : "MESSY";
            result.breakoutVolume = breakCandle.volumeRatio;
          }
        }
      }
    }

    return result;
  }

  /**
   * Find breakout candle
   */
  findBreakoutCandle(candles, level, direction) {
    const volumes = candles.map((c) => c[5]);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const close = candle[4];
      const volume = candle[5];
      const volumeRatio = volume / avgVolume;

      if (direction === "above") {
        // Broke above with strong close
        if (close > level && candle[2] > level) {
          return { index: i, volumeRatio };
        }
      } else {
        // Broke below with strong close
        if (close < level && candle[3] < level) {
          return { index: i, volumeRatio };
        }
      }
    }

    return null;
  }

  /**
   * Find retest candle after breakout
   */
  findRetestCandle(candles, level, direction) {
    if (candles.length < 2) return null;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const close = candle[4];
      const low = candle[3];
      const high = candle[2];

      if (direction === "above") {
        // Retest from above (support became resistance, now support again)
        const touchedLevel = Math.abs(low - level) / level < 0.005;
        const heldAbove = close > level;

        if (touchedLevel && heldAbove) {
          // Check if it's a clean hold (didn't break back below)
          const remainingCandles = candles.slice(i);
          const brokeBackBelow = remainingCandles.some((c) => c[4] < level);

          return {
            success: true,
            clean: !brokeBackBelow,
            index: i,
          };
        }
      } else {
        // Retest from below
        const touchedLevel = Math.abs(high - level) / level < 0.005;
        const heldBelow = close < level;

        if (touchedLevel && heldBelow) {
          const remainingCandles = candles.slice(i);
          const brokeBackAbove = remainingCandles.some((c) => c[4] > level);

          return {
            success: true,
            clean: !brokeBackAbove,
            index: i,
          };
        }
      }
    }

    return null;
  }

  /**
   * Find Support and Resistance levels
   */
  findSupportResistanceLevels(candles) {
    const levels = [];

    if (candles.length < 50) return levels;

    const recentCandles = candles.slice(-100);
    const highs = recentCandles.map((c) => c[2]);
    const lows = recentCandles.map((c) => c[3]);

    // Find price levels that were touched multiple times
    const pricePoints = [...highs, ...lows];
    const levelClusters = {};

    // Cluster similar prices
    pricePoints.forEach((price) => {
      const key = Math.round(price / (price * this.srTolerance));
      if (!levelClusters[key]) {
        levelClusters[key] = [];
      }
      levelClusters[key].push(price);
    });

    // Find significant levels (touched 2+ times)
    Object.values(levelClusters).forEach((cluster) => {
      if (cluster.length >= this.minSRTouches) {
        const avgLevel = cluster.reduce((a, b) => a + b, 0) / cluster.length;
        const currentPrice = candles[candles.length - 1][4];

        // Determine if support or resistance
        const type = currentPrice > avgLevel ? "support" : "resistance";

        levels.push({
          level: avgLevel,
          type,
          touches: cluster.length,
          strength: cluster.length >= 3 ? "STRONG" : "MODERATE",
        });
      }
    });

    // Sort by number of touches (strongest first)
    return levels.sort((a, b) => b.touches - a.touches);
  }

  /**
   * Calculate position size for scalping
   */
  calculatePositionSize(balance, entryPrice, stopLossPrice) {
    const scalpConfig = this.config.scalpingStrategy || {};
    const riskPerTrade = scalpConfig.riskPerTrade || 0.015;
    const maxPositionPercent = scalpConfig.maxPositionSize || 0.2;

    const riskAmount = balance * riskPerTrade;
    const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
    const quantity = riskAmount / riskPerUnit;

    let positionValue = quantity * entryPrice;

    const maxPositionValue = balance * maxPositionPercent;
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
      riskPercent: riskPerTrade * 100,
    };
  }

  /**
   * Calculate scalping exit prices
   */
  calculateExitPrices(entryPrice, side = "buy") {
    if (side === "buy") {
      return {
        stopLoss: entryPrice * (1 - this.stopLossPercent / 100),
        takeProfit: entryPrice * (1 + this.takeProfitPercent / 100),
      };
    } else {
      return {
        stopLoss: entryPrice * (1 + this.stopLossPercent / 100),
        takeProfit: entryPrice * (1 - this.takeProfitPercent / 100),
      };
    }
  }
}

export default ScalpingStrategy;
