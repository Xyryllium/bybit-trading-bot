/**
 * Technical Indicators for Trading Strategy
 */

export class Indicators {
  /**
   * Calculate RSI (Relative Strength Index)
   * @param {Array} prices - Array of closing prices
   * @param {number} period - RSI period (default: 14)
   * @returns {number} RSI value (0-100)
   */
  static calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) {
      return null;
    }

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI using smoothed moving average
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      const gain = change >= 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      return 100;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   * @param {Array} prices - Array of closing prices
   * @param {number} period - EMA period
   * @returns {number} EMA value
   */
  static calculateEMA(prices, period) {
    if (prices.length < period) {
      return null;
    }

    const multiplier = 2 / (period + 1);

    // Calculate initial SMA
    let ema =
      prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

    // Calculate EMA
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate SMA (Simple Moving Average)
   * @param {Array} prices - Array of closing prices
   * @param {number} period - SMA period
   * @returns {number} SMA value
   */
  static calculateSMA(prices, period) {
    if (prices.length < period) {
      return null;
    }

    const slice = prices.slice(-period);
    const sum = slice.reduce((acc, price) => acc + price, 0);
    return sum / period;
  }

  /**
   * Calculate average volume
   * @param {Array} volumes - Array of volumes
   * @param {number} period - Period
   * @returns {number} Average volume
   */
  static calculateAverageVolume(volumes, period = 20) {
    if (volumes.length < period) {
      return null;
    }

    const slice = volumes.slice(-period);
    const sum = slice.reduce((acc, vol) => acc + vol, 0);
    return sum / period;
  }

  /**
   * Detect EMA crossover
   * @param {Array} prices - Array of closing prices
   * @param {number} fastPeriod - Fast EMA period
   * @param {number} slowPeriod - Slow EMA period
   * @returns {string} 'bullish', 'bearish', or 'none'
   */
  static detectEMACrossover(prices, fastPeriod, slowPeriod) {
    if (prices.length < slowPeriod + 1) {
      return "none";
    }

    // Current EMAs
    const currentFastEMA = this.calculateEMA(prices, fastPeriod);
    const currentSlowEMA = this.calculateEMA(prices, slowPeriod);

    // Previous EMAs (using prices up to previous candle)
    const previousPrices = prices.slice(0, -1);
    const previousFastEMA = this.calculateEMA(previousPrices, fastPeriod);
    const previousSlowEMA = this.calculateEMA(previousPrices, slowPeriod);

    if (
      !currentFastEMA ||
      !currentSlowEMA ||
      !previousFastEMA ||
      !previousSlowEMA
    ) {
      return "none";
    }

    // Bullish crossover: fast crosses above slow
    if (previousFastEMA <= previousSlowEMA && currentFastEMA > currentSlowEMA) {
      return "bullish";
    }

    // Bearish crossover: fast crosses below slow
    if (previousFastEMA >= previousSlowEMA && currentFastEMA < currentSlowEMA) {
      return "bearish";
    }

    return "none";
  }

  /**
   * Calculate volatility (standard deviation)
   * @param {Array} prices - Array of closing prices
   * @param {number} period - Period
   * @returns {number} Standard deviation
   */
  static calculateVolatility(prices, period = 20) {
    if (prices.length < period) {
      return null;
    }

    const slice = prices.slice(-period);
    const mean = slice.reduce((sum, price) => sum + price, 0) / period;
    const squaredDiffs = slice.map((price) => Math.pow(price - mean, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / period;

    return Math.sqrt(variance);
  }

  /**
   * Calculate ATR (Average True Range) - simplified version
   * @param {Array} highs - Array of high prices
   * @param {Array} lows - Array of low prices
   * @param {Array} closes - Array of closing prices
   * @param {number} period - ATR period
   * @returns {number} ATR value
   */
  static calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) {
      return null;
    }

    const trueRanges = [];

    for (let i = 1; i < highs.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    // Calculate ATR as SMA of true ranges
    return this.calculateSMA(trueRanges, period);
  }
}

export default Indicators;
