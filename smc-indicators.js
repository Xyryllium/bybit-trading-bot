/**
 * Smart Money Concepts (SMC) Indicators
 * - Order Blocks (OB)
 * - Fair Value Gaps (FVG)
 * - Break of Structure (BOS)
 * - Change of Character (CHoCH)
 * - Market Structure
 * - Liquidity Zones
 */

export class SMCIndicators {
  /**
   * Detect Fair Value Gaps (FVG)
   * A gap where the wick of candle 1 doesn't touch the wick of candle 3
   */
  static detectFVG(candles, lookback = 50) {
    const fvgs = {
      bullish: [],
      bearish: [],
    };

    // Need at least 3 candles
    for (let i = candles.length - lookback; i < candles.length - 2; i++) {
      if (i < 0) continue;

      const candle1 = candles[i];
      const candle2 = candles[i + 1];
      const candle3 = candles[i + 2];

      const high1 = candle1[2];
      const low1 = candle1[3];
      const high2 = candle2[2];
      const low2 = candle2[3];
      const high3 = candle3[2];
      const low3 = candle3[3];

      // Bullish FVG: low3 > high1 (gap up)
      if (low3 > high1) {
        fvgs.bullish.push({
          index: i + 2,
          top: low3,
          bottom: high1,
          middle: (low3 + high1) / 2,
          size: low3 - high1,
          timestamp: candle3[0],
        });
      }

      // Bearish FVG: high3 < low1 (gap down)
      if (high3 < low1) {
        fvgs.bearish.push({
          index: i + 2,
          top: low1,
          bottom: high3,
          middle: (low1 + high3) / 2,
          size: low1 - high3,
          timestamp: candle3[0],
        });
      }
    }

    return fvgs;
  }

  /**
   * Detect Order Blocks (OB)
   * The last up/down candle before a strong move in opposite direction
   */
  static detectOrderBlocks(candles, lookback = 100, threshold = 0.02) {
    const orderBlocks = {
      bullish: [],
      bearish: [],
    };

    for (let i = candles.length - lookback; i < candles.length - 5; i++) {
      if (i < 1) continue;

      const candle = candles[i];
      const open = candle[1];
      const high = candle[2];
      const low = candle[3];
      const close = candle[4];

      // Check next 5 candles for strong move
      let strongMoveUp = false;
      let strongMoveDown = false;

      for (let j = i + 1; j < Math.min(i + 6, candles.length); j++) {
        const futureClose = candles[j][4];
        const movePercent = (futureClose - close) / close;

        if (movePercent > threshold) strongMoveUp = true;
        if (movePercent < -threshold) strongMoveDown = true;
      }

      // Bearish Order Block: Down candle before strong move up
      if (close < open && strongMoveUp) {
        orderBlocks.bullish.push({
          index: i,
          top: open,
          bottom: low,
          middle: (open + low) / 2,
          timestamp: candle[0],
          strength: "strong",
        });
      }

      // Bullish Order Block: Up candle before strong move down
      if (close > open && strongMoveDown) {
        orderBlocks.bearish.push({
          index: i,
          top: high,
          bottom: close,
          middle: (high + close) / 2,
          timestamp: candle[0],
          strength: "strong",
        });
      }
    }

    return orderBlocks;
  }

  /**
   * Detect Market Structure (Swing Highs and Lows)
   */
  static detectMarketStructure(candles, swingLength = 5) {
    const structure = {
      swingHighs: [],
      swingLows: [],
    };

    for (let i = swingLength; i < candles.length - swingLength; i++) {
      const currentHigh = candles[i][2];
      const currentLow = candles[i][3];

      // Check if it's a swing high
      let isSwingHigh = true;
      for (let j = i - swingLength; j <= i + swingLength; j++) {
        if (j !== i && candles[j][2] >= currentHigh) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        structure.swingHighs.push({
          index: i,
          price: currentHigh,
          timestamp: candles[i][0],
        });
      }

      // Check if it's a swing low
      let isSwingLow = true;
      for (let j = i - swingLength; j <= i + swingLength; j++) {
        if (j !== i && candles[j][3] <= currentLow) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        structure.swingLows.push({
          index: i,
          price: currentLow,
          timestamp: candles[i][0],
        });
      }
    }

    return structure;
  }

  /**
   * Detect Break of Structure (BOS) and Change of Character (CHoCH)
   */
  static detectBOS(candles, structure) {
    const signals = {
      bos: [],
      choch: [],
    };

    const currentPrice = candles[candles.length - 1][4];
    const { swingHighs, swingLows } = structure;

    // Get recent swing points
    const recentHighs = swingHighs.slice(-5);
    const recentLows = swingLows.slice(-5);

    if (recentHighs.length < 2 || recentLows.length < 2) {
      return signals;
    }

    // Check for bullish BOS (price breaks above recent high)
    const lastHigh = recentHighs[recentHighs.length - 1];
    const prevHigh = recentHighs[recentHighs.length - 2];

    if (currentPrice > lastHigh.price && lastHigh.price > prevHigh.price) {
      signals.bos.push({
        type: "bullish",
        price: lastHigh.price,
        strength: "strong",
      });
    }

    // Check for bearish BOS (price breaks below recent low)
    const lastLow = recentLows[recentLows.length - 1];
    const prevLow = recentLows[recentLows.length - 2];

    if (currentPrice < lastLow.price && lastLow.price < prevLow.price) {
      signals.bos.push({
        type: "bearish",
        price: lastLow.price,
        strength: "strong",
      });
    }

    // Check for CHoCH (Change of Character)
    // Bullish CHoCH: In downtrend, breaks above previous high
    if (recentLows.length >= 2) {
      const isDowntrend =
        recentLows[recentLows.length - 1].price <
        recentLows[recentLows.length - 2].price;
      if (isDowntrend && currentPrice > prevHigh.price) {
        signals.choch.push({
          type: "bullish",
          price: prevHigh.price,
        });
      }
    }

    // Bearish CHoCH: In uptrend, breaks below previous low
    if (recentHighs.length >= 2) {
      const isUptrend =
        recentHighs[recentHighs.length - 1].price >
        recentHighs[recentHighs.length - 2].price;
      if (isUptrend && currentPrice < prevLow.price) {
        signals.choch.push({
          type: "bearish",
          price: prevLow.price,
        });
      }
    }

    return signals;
  }

  /**
   * Determine if price is in Premium or Discount zone
   * Based on recent high and low
   */
  static getPremiumDiscount(candles, lookback = 50) {
    const recentCandles = candles.slice(-lookback);
    const highs = recentCandles.map((c) => c[2]);
    const lows = recentCandles.map((c) => c[3]);

    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    const range = highestHigh - lowestLow;
    const currentPrice = candles[candles.length - 1][4];

    const equilibrium = lowestLow + range / 2;
    const position = (currentPrice - lowestLow) / range;

    return {
      highestHigh,
      lowestLow,
      equilibrium,
      currentPrice,
      position: position * 100, // Percentage
      zone:
        position > 0.7
          ? "premium"
          : position < 0.3
          ? "discount"
          : "equilibrium",
      distance: currentPrice - equilibrium,
    };
  }

  /**
   * Detect Liquidity Zones (Equal Highs/Lows)
   */
  static detectLiquidityZones(candles, tolerance = 0.002) {
    const liquidity = {
      buyLiquidity: [], // Equal lows (liquidity below)
      sellLiquidity: [], // Equal highs (liquidity above)
    };

    const highs = candles.map((c) => c[2]);
    const lows = candles.map((c) => c[3]);

    // Find equal highs (within tolerance)
    for (let i = 0; i < highs.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 20, highs.length); j++) {
        const diff = Math.abs(highs[i] - highs[j]) / highs[i];
        if (diff < tolerance) {
          liquidity.sellLiquidity.push({
            price: (highs[i] + highs[j]) / 2,
            indices: [i, j],
            strength: "double_top",
          });
        }
      }
    }

    // Find equal lows (within tolerance)
    for (let i = 0; i < lows.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 20, lows.length); j++) {
        const diff = Math.abs(lows[i] - lows[j]) / lows[i];
        if (diff < tolerance) {
          liquidity.buyLiquidity.push({
            price: (lows[i] + lows[j]) / 2,
            indices: [i, j],
            strength: "double_bottom",
          });
        }
      }
    }

    return liquidity;
  }

  /**
   * Check if current price is near an FVG
   */
  static isPriceNearFVG(price, fvgs, tolerance = 0.001) {
    const bullishFVG = fvgs.bullish.find((fvg) => {
      const distanceTop = Math.abs(price - fvg.top) / price;
      const distanceBottom = Math.abs(price - fvg.bottom) / price;
      return distanceTop < tolerance || distanceBottom < tolerance;
    });

    const bearishFVG = fvgs.bearish.find((fvg) => {
      const distanceTop = Math.abs(price - fvg.top) / price;
      const distanceBottom = Math.abs(price - fvg.bottom) / price;
      return distanceTop < tolerance || distanceBottom < tolerance;
    });

    return {
      nearBullishFVG: !!bullishFVG,
      nearBearishFVG: !!bearishFVG,
      bullishFVG,
      bearishFVG,
    };
  }

  /**
   * Check if current price is near an Order Block
   */
  static isPriceNearOB(price, orderBlocks, tolerance = 0.002) {
    const bullishOB = orderBlocks.bullish.find((ob) => {
      return (
        price >= ob.bottom * (1 - tolerance) &&
        price <= ob.top * (1 + tolerance)
      );
    });

    const bearishOB = orderBlocks.bearish.find((ob) => {
      return (
        price >= ob.bottom * (1 - tolerance) &&
        price <= ob.top * (1 + tolerance)
      );
    });

    return {
      nearBullishOB: !!bullishOB,
      nearBearishOB: !!bearishOB,
      bullishOB,
      bearishOB,
    };
  }
}

export default SMCIndicators;
