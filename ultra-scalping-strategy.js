import Indicators from "./indicators.js";
import logger from "./logger.js";

/**
 * ULTRA-OPTIMIZED PRICE ACTION SCALPING Strategy
 *
 * Optimized for maximum win rates through:
 * 1. Ultra-strict entry filtering
 * 2. Multi-pattern confirmation
 * 3. Advanced market condition analysis
 * 4. Dynamic risk management
 * 5. Momentum-based filtering
 * 6. Confluence-based scoring
 */
export class UltraScalpingStrategy {
  constructor(config) {
    this.config = config;

    // Get settings from config (which reads from env)
    const scalpConfig = config.scalpingStrategy || {};

    // Ultra-optimized pattern detection settings (Balanced for profitability)
    this.doubleTolerance = scalpConfig.doubleTolerance || 0.0018; // Balanced tolerance
    this.barPlayLength = 4;
    this.srTolerance = 0.0025; // Balanced S/R tolerance
    this.minSRTouches = 3; // Balanced touches required

    // Ultra-conservative risk management (Balanced for profitability)
    this.stopLossPercent = scalpConfig.stopLossPercent || 0.22; // Balanced stops
    this.takeProfitPercent = scalpConfig.takeProfitPercent || 0.45; // Balanced profits
    this.minScore = scalpConfig.minScore || 7; // Balanced minimum score
    this.maxScore = 30; // Higher cap for very high scores

    // Balanced market condition filters (Quality signals)
    this.minVolumeRatio = scalpConfig.minVolumeRatio || 1.3; // Balanced volume requirement
    this.maxVolatility = scalpConfig.maxVolatility || 0.018; // Balanced volatility tolerance
    this.minTrendStrength = scalpConfig.minTrendStrength || 0.65; // Balanced trend requirement
    this.minMomentumScore = scalpConfig.minMomentumScore || 0.65; // Balanced momentum requirement

    // Enhanced cooldown tracking
    this.lastDoubleBottomLevel = null;
    this.lastDoubleBottomCandle = 0;
    this.lastBarPlayCandle = 0;
    this.lastBreakRetestLevel = null;
    this.lastBreakRetestCandle = 0;
    this.patternCooldown = scalpConfig.patternCooldown || 25; // Longer cooldown

    // Performance tracking
    this.recentTrades = [];
    this.maxRecentTrades = 15;

    // Multi-pattern confirmation (Balanced for profitability)
    this.requireMultiplePatterns = scalpConfig.requireMultiplePatterns || false;
    this.minPatternConfluence = scalpConfig.minPatternConfluence || 1;

    // Log configuration
    logger.info("Ultra-Optimized Scalping Strategy Configured", {
      stopLoss: this.stopLossPercent + "%",
      takeProfit: this.takeProfitPercent + "%",
      minScore: this.minScore,
      cooldown: this.patternCooldown + " candles",
      doubleTolerance: (this.doubleTolerance * 100).toFixed(2) + "%",
      minVolumeRatio: this.minVolumeRatio,
      maxVolatility: (this.maxVolatility * 100).toFixed(2) + "%",
      minTrendStrength: this.minTrendStrength,
      minMomentumScore: this.minMomentumScore,
    });
  }

  /**
   * Ultra-optimized market analysis with strict filtering
   */
  analyze(candles, position = null) {
    if (!candles || candles.length < 150) {
      return {
        action: "HOLD",
        reason: "Insufficient data for ultra scalping",
      };
    }

    const currentPrice = candles[candles.length - 1][4];
    const currentCandle = candles[candles.length - 1];
    const currentCandleIndex = candles.length - 1;

    // Check ultra-strict market conditions first
    const marketConditions = this.analyzeUltraMarketConditions(candles);

    // Debug market conditions
    logger.debug("Market conditions analysis", {
      suitable: marketConditions.suitable,
      reason: marketConditions.reason,
      volumeRatio: marketConditions.volumeRatio,
      volatility: marketConditions.volatility,
      trendAlignment: marketConditions.trendAlignment,
      rsi: marketConditions.rsi,
      momentumScore: marketConditions.momentumScore,
      thresholds: {
        minVolumeRatio: this.minVolumeRatio,
        maxVolatility: this.maxVolatility,
        minTrendStrength: this.minTrendStrength,
        minMomentumScore: this.minMomentumScore,
      },
    });

    if (!marketConditions.suitable) {
      return {
        action: "HOLD",
        reason: `Market conditions not suitable: ${marketConditions.reason}`,
      };
    }

    // Detect patterns with ultra-enhanced logic
    let doubleBottom = this.detectUltraDoubleBottom(candles);
    const doubleTop = this.detectUltraDoubleTop(candles);
    let barPlay = this.detectUltraBarPlay(candles);
    let breakRetest = this.detectUltraBreakAndRetest(candles);

    // Debug pattern detection
    logger.debug("Pattern detection", {
      doubleBottom: doubleBottom,
      doubleTop: doubleTop,
      barPlay: barPlay,
      breakRetest: breakRetest,
    });

    // Apply ultra-enhanced cooldown logic
    if (doubleBottom.detected) {
      const levelSimilar =
        this.lastDoubleBottomLevel &&
        Math.abs(doubleBottom.level - this.lastDoubleBottomLevel) /
          doubleBottom.level <
          0.002; // Ultra-tight level similarity
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
          0.002;
      const tooSoon =
        currentCandleIndex - this.lastBreakRetestCandle < this.patternCooldown;

      if (levelSimilar && tooSoon) {
        breakRetest = { detected: false, level: 0, type: null };
      }
    }

    // Position management
    if (position) {
      return this.manageUltraPosition(candles, position, currentPrice);
    }

    // Ultra-strict entry signal analysis with confluence
    let bestSignal = null;
    let bestScore = 0;
    let patternCount = 0;

    // Analyze each pattern with ultra-enhanced scoring
    if (doubleBottom.detected) {
      const signal = this.analyzeUltraDoubleBottomSignal(
        candles,
        doubleBottom,
        marketConditions
      );
      if (signal.score > bestScore && signal.score >= this.minScore) {
        bestSignal = signal;
        bestScore = signal.score;
        patternCount++;
      }
    }

    if (barPlay.type === "BULLISH") {
      const signal = this.analyzeUltraBarPlaySignal(
        candles,
        barPlay,
        marketConditions
      );
      if (signal.score > bestScore && signal.score >= this.minScore) {
        bestSignal = signal;
        bestScore = signal.score;
        patternCount++;
      }
    }

    if (breakRetest.detected && breakRetest.type === "BULLISH") {
      const signal = this.analyzeUltraBreakRetestSignal(
        candles,
        breakRetest,
        marketConditions
      );
      if (signal.score > bestScore && signal.score >= this.minScore) {
        bestSignal = signal;
        bestScore = signal.score;
        patternCount++;
      }
    }

    // Balanced filters for entry
    if (bestSignal) {
      // Optional multiple pattern confirmation
      if (
        this.requireMultiplePatterns &&
        patternCount < this.minPatternConfluence
      ) {
        return { action: "HOLD", reason: "Insufficient pattern confluence" };
      }

      // Check recent performance
      if (this.hasRecentLosses()) {
        bestSignal.score -= 3; // Reduce score more if recent losses
      }

      // Check momentum (bonus only)
      const momentumScore = this.calculateMomentumScore(candles);
      if (momentumScore >= this.minMomentumScore) {
        bestSignal.score += 1; // Bonus for good momentum
      }

      // Require balanced score after all adjustments
      if (bestSignal.score >= this.minScore) {
        // Update cooldown tracking
        if (bestSignal.setup === "DOUBLE_BOTTOM") {
          this.lastDoubleBottomLevel = doubleBottom.level;
          this.lastDoubleBottomCandle = currentCandleIndex;
        } else if (bestSignal.setup === "BAR_PLAY") {
          this.lastBarPlayCandle = currentCandleIndex;
        } else if (bestSignal.setup === "BREAK_RETEST") {
          this.lastBreakRetestLevel = breakRetest.level;
          this.lastBreakRetestCandle = currentCandleIndex;
        }

        logger.info("⚡ ULTRA SCALPING BUY", {
          price: currentPrice.toFixed(2),
          score: bestSignal.score.toFixed(1),
          setup: bestSignal.setup,
          reasons: bestSignal.reasons,
          patternCount: patternCount,
          momentumScore: momentumScore.toFixed(2),
        });

        return {
          action: "BUY",
          reason: bestSignal.reasons,
          score: bestSignal.score,
          setup: bestSignal.setup,
        };
      }
    }

    return { action: "HOLD", reason: "No high-quality scalping signals" };
  }

  /**
   * Analyze ultra-strict market conditions
   */
  analyzeUltraMarketConditions(candles) {
    const recentCandles = candles.slice(-25);
    const volumes = recentCandles.map((c) => c[5]);
    const closes = recentCandles.map((c) => c[4]);
    const highs = recentCandles.map((c) => c[2]);
    const lows = recentCandles.map((c) => c[3]);

    // Volume analysis
    const avgVolume = Indicators.calculateAverageVolume(
      volumes,
      volumes.length
    );
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = currentVolume / avgVolume;

    // Volatility analysis
    const volatility = Indicators.calculateVolatility(closes, closes.length);

    // Trend analysis
    const ema15 = Indicators.calculateEMA(closes, 15);
    const ema30 = Indicators.calculateEMA(closes, 30);
    const currentPrice = closes[closes.length - 1];

    const trendAlignment = this.calculateUltraTrendAlignment(
      currentPrice,
      ema15,
      ema30
    );

    // RSI analysis
    const rsi = Indicators.calculateRSI(closes, 10);
    const currentRSI = rsi[rsi.length - 1];

    // Momentum analysis
    const momentumScore = this.calculateMomentumScore(candles);

    // Market condition assessment
    const conditions = {
      volumeRatio,
      volatility,
      trendAlignment,
      rsi: currentRSI,
      momentumScore,
      suitable: true,
      reason: "",
    };

    // Apply ultra-strict filters
    if (volumeRatio < this.minVolumeRatio) {
      conditions.suitable = false;
      conditions.reason = `Low volume (${volumeRatio.toFixed(2)}x)`;
    } else if (volatility > this.maxVolatility) {
      conditions.suitable = false;
      conditions.reason = `High volatility (${(volatility * 100).toFixed(2)}%)`;
    } else if (trendAlignment < this.minTrendStrength) {
      conditions.suitable = false;
      conditions.reason = `Weak trend alignment (${trendAlignment.toFixed(2)})`;
    } else if (currentRSI > 75 || currentRSI < 25) {
      conditions.suitable = false;
      conditions.reason = `Extreme RSI (${currentRSI.toFixed(1)})`;
    } else if (momentumScore < this.minMomentumScore) {
      conditions.suitable = false;
      conditions.reason = `Weak momentum (${momentumScore.toFixed(2)})`;
    }

    return conditions;
  }

  /**
   * Calculate ultra-trend alignment score
   */
  calculateUltraTrendAlignment(currentPrice, ema15, ema30) {
    const priceAboveEMA15 = currentPrice > ema15 ? 1 : 0;
    const priceAboveEMA30 = currentPrice > ema30 ? 1 : 0;
    const ema15AboveEMA30 = ema15 > ema30 ? 1 : 0;
    const priceSlope = currentPrice > ema15 * 1.001 ? 1 : 0; // Price accelerating

    return (
      (priceAboveEMA15 + priceAboveEMA30 + ema15AboveEMA30 + priceSlope) / 4
    );
  }

  /**
   * Calculate momentum score
   */
  calculateMomentumScore(candles) {
    const recentCandles = candles.slice(-10);
    const closes = recentCandles.map((c) => c[4]);
    const volumes = recentCandles.map((c) => c[5]);

    // Price momentum
    const priceMomentum =
      closes.slice(1).reduce((sum, close, i) => {
        return sum + (close > closes[i] ? 1 : 0);
      }, 0) /
      (closes.length - 1);

    // Volume momentum
    const avgVolume = Indicators.calculateAverageVolume(
      volumes,
      volumes.length
    );
    const volumeMomentum =
      volumes.slice(-3).reduce((sum, vol) => {
        return sum + (vol > avgVolume ? 1 : 0);
      }, 0) / 3;

    // Combined momentum
    return (priceMomentum + volumeMomentum) / 2;
  }

  /**
   * Ultra-enhanced double bottom detection
   */
  detectUltraDoubleBottom(candles) {
    const recentCandles = candles.slice(-40);
    const lows = recentCandles.map((c) => c[3]);

    let bestLevel = 0;
    let maxTouches = 0;

    // Look for support levels with multiple touches
    for (let i = 0; i < lows.length - 8; i++) {
      const level = lows[i];
      let touches = 1;

      // Count touches within ultra-tight tolerance
      for (let j = i + 1; j < lows.length; j++) {
        if (Math.abs(lows[j] - level) / level <= this.doubleTolerance) {
          touches++;
        }
      }

      if (touches > maxTouches && touches >= 3) {
        maxTouches = touches;
        bestLevel = level;
      }
    }

    return {
      detected: maxTouches >= 3,
      level: bestLevel,
      touches: maxTouches,
    };
  }

  /**
   * Ultra-enhanced double top detection
   */
  detectUltraDoubleTop(candles) {
    const recentCandles = candles.slice(-40);
    const highs = recentCandles.map((c) => c[2]);

    let bestLevel = 0;
    let maxTouches = 0;

    for (let i = 0; i < highs.length - 8; i++) {
      const level = highs[i];
      let touches = 1;

      for (let j = i + 1; j < highs.length; j++) {
        if (Math.abs(highs[j] - level) / level <= this.doubleTolerance) {
          touches++;
        }
      }

      if (touches > maxTouches && touches >= 3) {
        maxTouches = touches;
        bestLevel = level;
      }
    }

    return {
      detected: maxTouches >= 3,
      level: bestLevel,
      touches: maxTouches,
    };
  }

  /**
   * Ultra-enhanced bar play detection
   */
  detectUltraBarPlay(candles) {
    const recentCandles = candles.slice(-12);

    // Look for 3-4 bar bullish patterns with ultra-strict criteria
    for (let i = 4; i < recentCandles.length; i++) {
      const bars = recentCandles.slice(i - 4, i + 1);

      // Check for ultra-bullish bar play
      const isUltraBullish = bars.every((bar, index) => {
        if (index === 0) return true; // First bar can be anything
        const bodySize = Math.abs(bar[4] - bar[1]) / bar[1];
        return bar[4] > bar[1] && bodySize > 0.005; // Close > Open and significant body
      });

      if (isUltraBullish) {
        // Check ultra-strength based on body size and volume
        const avgBodySize =
          bars.slice(1).reduce((sum, bar) => {
            return sum + Math.abs(bar[4] - bar[1]) / bar[1];
          }, 0) / 4;

        const strength = avgBodySize > 0.015 ? "STRONG" : "WEAK";

        return {
          type: "BULLISH",
          bars: bars.length,
          strength: strength,
        };
      }
    }

    return { type: null, bars: 0, strength: "WEAK" };
  }

  /**
   * Ultra-enhanced break and retest detection
   */
  detectUltraBreakAndRetest(candles) {
    const recentCandles = candles.slice(-25);
    const closes = recentCandles.map((c) => c[4]);
    const highs = recentCandles.map((c) => c[2]);
    const lows = recentCandles.map((c) => c[3]);

    // Look for recent breakouts with ultra-strict criteria
    for (let i = 8; i < recentCandles.length - 4; i++) {
      const breakoutLevel = highs[i];
      const retestCandles = recentCandles.slice(i + 1, i + 5);

      // Check if price retested the breakout level with ultra-tight tolerance
      const retestOccurred = retestCandles.some((candle) => {
        return (
          Math.abs(candle[3] - breakoutLevel) / breakoutLevel <=
          this.srTolerance
        );
      });

      if (retestOccurred) {
        const currentPrice = closes[closes.length - 1];
        const isBullish = currentPrice > breakoutLevel * 1.002; // Require 0.2% above breakout

        return {
          detected: true,
          level: breakoutLevel,
          type: isBullish ? "BULLISH" : "BEARISH",
        };
      }
    }

    return { detected: false, level: 0, type: null };
  }

  /**
   * Analyze ultra double bottom signal with enhanced scoring
   */
  analyzeUltraDoubleBottomSignal(candles, pattern, marketConditions) {
    let score = 6; // Higher base score
    const reasons = [];

    // Pattern strength
    score += pattern.touches * 3; // More touches = much higher score
    reasons.push(
      `Ultra Double Bottom at ${pattern.level.toFixed(2)} (${
        pattern.touches
      } touches)`
    );

    // Volume confirmation
    const recentVolumes = candles.slice(-7).map((c) => c[5]);
    const avgVolume = Indicators.calculateAverageVolume(
      recentVolumes,
      recentVolumes.length
    );
    const currentVolume = recentVolumes[recentVolumes.length - 1];

    if (currentVolume > avgVolume * 2.0) {
      score += 4;
      reasons.push("Ultra Volume Confirmation");
    } else if (currentVolume > avgVolume * 1.5) {
      score += 2;
      reasons.push("Volume Confirmation");
    } else if (currentVolume < avgVolume * 0.9) {
      score -= 3;
      reasons.push("⚠️ Low Volume (Risk)");
    }

    // Support level strength
    const supportLevels = this.findUltraSupportLevels(candles);
    const nearSupport = supportLevels.some(
      (level) => Math.abs(pattern.level - level) / level <= this.srTolerance
    );

    if (nearSupport) {
      score += 3;
      reasons.push("At Ultra Key Support Level");
    }

    // Trend alignment bonus
    if (marketConditions.trendAlignment > 0.8) {
      score += 3;
      reasons.push("Ultra Strong Trend Alignment");
    } else if (marketConditions.trendAlignment > 0.7) {
      score += 1;
      reasons.push("Strong Trend Alignment");
    }

    // Momentum bonus
    if (marketConditions.momentumScore > 0.8) {
      score += 2;
      reasons.push("Ultra Strong Momentum");
    }

    return {
      score: Math.min(score, this.maxScore),
      setup: "DOUBLE_BOTTOM",
      reasons: reasons.join(" | "),
    };
  }

  /**
   * Analyze ultra bar play signal with enhanced scoring
   */
  analyzeUltraBarPlaySignal(candles, pattern, marketConditions) {
    let score = 5; // Higher base score
    const reasons = [];

    // Pattern strength
    if (pattern.strength === "STRONG") {
      score += 4;
      reasons.push(`${pattern.bars}-Bar Ultra Bullish Play (STRONG)`);
    } else {
      score += 1;
      reasons.push(`${pattern.bars}-Bar Bullish Play (WEAK)`);
    }

    // Momentum confirmation
    const recentCandles = candles.slice(-7);
    const momentumBars = recentCandles.filter((c) => c[4] > c[1]).length;
    const momentumRatio = momentumBars / recentCandles.length;

    if (momentumRatio > 0.9) {
      score += 3;
      reasons.push("Ultra Strong Momentum Bars");
    } else if (momentumRatio > 0.8) {
      score += 2;
      reasons.push("Strong Momentum Bars");
    }

    // Volume breakout
    const volumes = recentCandles.map((c) => c[5]);
    const avgVolume = Indicators.calculateAverageVolume(
      volumes,
      volumes.length
    );
    const currentVolume = volumes[volumes.length - 1];

    if (currentVolume > avgVolume * 1.8) {
      score += 3;
      reasons.push("Ultra High Volume Breakout");
    } else if (currentVolume > avgVolume * 1.4) {
      score += 2;
      reasons.push("High Volume Breakout");
    }

    return {
      score: Math.min(score, this.maxScore),
      setup: "BAR_PLAY",
      reasons: reasons.join(" | "),
    };
  }

  /**
   * Analyze ultra break and retest signal with enhanced scoring
   */
  analyzeUltraBreakRetestSignal(candles, pattern, marketConditions) {
    let score = 5; // Higher base score
    const reasons = [];

    // Breakout strength
    const currentPrice = candles[candles.length - 1][4];
    const breakoutStrength = (currentPrice - pattern.level) / pattern.level;

    if (breakoutStrength > 0.015) {
      score += 3;
      reasons.push(
        `Ultra Break & Retest of ${pattern.level.toFixed(2)} (ULTRA STRONG)`
      );
    } else if (breakoutStrength > 0.01) {
      score += 2;
      reasons.push(`Break & Retest of ${pattern.level.toFixed(2)} (STRONG)`);
    } else {
      score += 1;
      reasons.push(`Break & Retest of ${pattern.level.toFixed(2)} (WEAK)`);
    }

    // Retest quality
    const retestCandles = candles.slice(-4);
    const cleanRetest = retestCandles.every((c) => c[4] > pattern.level);

    if (cleanRetest) {
      score += 3;
      reasons.push("Ultra Clean Retest Hold");
    } else {
      score += 1;
      reasons.push("Messy Retest");
    }

    // Volume confirmation
    const volumes = candles.slice(-7).map((c) => c[5]);
    const avgVolume = Indicators.calculateAverageVolume(
      volumes,
      volumes.length
    );
    const currentVolume = volumes[volumes.length - 1];

    if (currentVolume > avgVolume * 1.5) {
      score += 3;
      reasons.push("Ultra Strong Breakout Volume");
    } else if (currentVolume > avgVolume * 1.2) {
      score += 1;
      reasons.push("Strong Breakout Volume");
    }

    return {
      score: Math.min(score, this.maxScore),
      setup: "BREAK_RETEST",
      reasons: reasons.join(" | "),
    };
  }

  /**
   * Find ultra support and resistance levels
   */
  findUltraSupportLevels(candles) {
    const levels = [];
    const lows = candles.map((c) => c[3]);

    // Find significant lows with ultra-strict criteria
    for (let i = 3; i < lows.length - 3; i++) {
      const level = lows[i];
      let touches = 1;

      // Count touches within ultra-tight tolerance
      for (let j = 0; j < lows.length; j++) {
        if (j !== i && Math.abs(lows[j] - level) / level <= this.srTolerance) {
          touches++;
        }
      }

      if (touches >= this.minSRTouches) {
        levels.push(level);
      }
    }

    return levels;
  }

  /**
   * Check for recent losses to avoid overtrading
   */
  hasRecentLosses() {
    if (this.recentTrades.length < 2) return false;

    const recentLosses = this.recentTrades
      .slice(-2)
      .filter((trade) => trade.profit < 0).length;
    return recentLosses >= 1;
  }

  /**
   * Ultra-enhanced position management
   */
  manageUltraPosition(candles, position, currentPrice) {
    const { stopLoss, takeProfit } = this.calculateExitPrices(currentPrice);

    // Check stop loss
    if (currentPrice <= stopLoss) {
      this.recordTrade(position, currentPrice, "Stop loss triggered");
      return {
        action: "SELL",
        reason: "Stop loss triggered",
        price: currentPrice,
      };
    }

    // Check take profit
    if (currentPrice >= takeProfit) {
      this.recordTrade(position, currentPrice, "Ultra scalping take profit");
      return {
        action: "SELL",
        reason: "Ultra scalping take profit",
        price: currentPrice,
      };
    }

    // Dynamic exit based on market conditions
    const marketConditions = this.analyzeUltraMarketConditions(candles);
    if (!marketConditions.suitable) {
      this.recordTrade(position, currentPrice, "Market conditions changed");
      return {
        action: "SELL",
        reason: "Market conditions changed",
        price: currentPrice,
      };
    }

    // Check for reversal patterns
    const doubleTop = this.detectUltraDoubleTop(candles);
    if (doubleTop.detected && currentPrice < doubleTop.level) {
      this.recordTrade(position, currentPrice, "Double Top Exit");
      return {
        action: "SELL",
        reason: "Double Top Exit",
        price: currentPrice,
      };
    }

    return { action: "HOLD", reason: "Ultra position management" };
  }

  /**
   * Calculate exit prices with ultra-conservative adjustment
   */
  calculateExitPrices(entryPrice) {
    const stopLoss = entryPrice * (1 - this.stopLossPercent / 100);
    const takeProfit = entryPrice * (1 + this.takeProfitPercent / 100);

    return { stopLoss, takeProfit };
  }

  /**
   * Calculate position size with ultra-conservative risk management and leverage
   * Supports both isolated and cross margin modes
   */
  calculatePositionSize(balance, entryPrice, stopLoss) {
    // Get leverage and margin mode from config
    const leverage = this.config.trading?.leverage || 1;
    const marginMode = this.config.trading?.marginMode || "isolated";
    const effectiveBalance = balance * leverage; // Leveraged balance for position sizing

    // Risk management: Different calculation for cross vs isolated margin
    let riskAmount;
    let leverageAdjustedRisk;
    if (marginMode === "cross") {
      // Cross margin: Use entire account balance as collateral
      // With leverage, we can risk more per trade (up to leverage amount)
      const baseRiskPercent = 0.005; // 0.5% base risk for cross margin
      leverageAdjustedRisk = baseRiskPercent * leverage; // Multiply risk with leverage
      riskAmount = balance * leverageAdjustedRisk;
    } else {
      // Isolated margin: Each position has its own collateral
      const baseRiskPercent = 0.009; // 0.9% base risk for isolated margin
      leverageAdjustedRisk = baseRiskPercent * leverage; // Multiply risk with leverage
      riskAmount = balance * leverageAdjustedRisk;
    }

    const riskPerShare = entryPrice - stopLoss;
    const quantity = riskAmount / riskPerShare;
    const positionValue = quantity * entryPrice;

    // Cap position size using leveraged balance (more conservative with leverage)
    const maxPositionPercent =
      marginMode === "cross" ? 0.2 / leverage : 0.3 / leverage; // Higher max for better leverage utilization
    const maxPositionValue = effectiveBalance * maxPositionPercent;
    const finalPositionValue = Math.min(positionValue, maxPositionValue);
    const finalQuantity = finalPositionValue / entryPrice;

    return {
      quantity: finalQuantity,
      positionValue: finalPositionValue,
      leverage: leverage,
      marginMode: marginMode,
      effectiveBalance: effectiveBalance,
      actualRisk: riskAmount,
      debug: {
        baseRiskPercent: marginMode === "cross" ? 0.005 : 0.009,
        leverageAdjustedRisk: leverageAdjustedRisk,
        riskAmount: riskAmount,
        riskPerShare: riskPerShare,
        maxPositionPercent:
          marginMode === "cross" ? 0.08 / leverage : 0.13 / leverage,
        maxPositionValue: maxPositionValue,
      },
    };
  }

  /**
   * Record trade for performance tracking
   */
  recordTrade(position, exitPrice, reason) {
    const profit = (exitPrice - position.entryPrice) * position.quantity;
    const profitPercent =
      ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    const trade = {
      entryPrice: position.entryPrice,
      exitPrice: exitPrice,
      profit: profit,
      profitPercent: profitPercent,
      reason: reason,
      timestamp: Date.now(),
    };

    this.recentTrades.push(trade);

    // Keep only recent trades
    if (this.recentTrades.length > this.maxRecentTrades) {
      this.recentTrades.shift();
    }
  }
}

export default UltraScalpingStrategy;
