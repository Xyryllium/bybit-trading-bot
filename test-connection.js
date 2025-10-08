#!/usr/bin/env node

/**
 * Test connection to Bybit API
 * This script helps diagnose network/SSL issues
 */

import ccxt from "ccxt";
import { setupDNS } from "./dns-setup.js";

async function testConnection() {
  console.log("=".repeat(60));
  console.log("🔍 Testing Connection to Bybit API");
  console.log("=".repeat(60));
  console.log("\nSystem Information:");
  console.log(`- Platform: ${process.platform}`);
  console.log(`- Node Version: ${process.version}`);
  console.log(
    `- TLS Reject Unauthorized: ${
      process.env.NODE_TLS_REJECT_UNAUTHORIZED || "default (1)"
    }`
  );
  console.log(`- HTTPS Proxy: ${process.env.HTTPS_PROXY || "not set"}`);

  // Setup DNS if specified
  const dnsProvider =
    process.env.DNS_PROVIDER || process.env.USE_GOOGLE_DNS === "true"
      ? "google"
      : null;
  if (dnsProvider) {
    console.log(`- DNS Provider: Using ${dnsProvider.toUpperCase()} DNS`);
    setupDNS(dnsProvider);
  } else {
    console.log("- DNS Provider: System default");
  }

  console.log("\n" + "-".repeat(60));
  console.log("Test 1: Creating Bybit exchange instance...");

  try {
    const exchange = new ccxt.bybit({
      enableRateLimit: true,
      timeout: 30000,
    });
    console.log("✅ Exchange instance created successfully");

    console.log("\n" + "-".repeat(60));
    console.log("Test 2: Fetching server time...");

    const time = await exchange.fetchTime();
    console.log(`✅ Server time: ${new Date(time).toISOString()}`);

    console.log("\n" + "-".repeat(60));
    console.log("Test 3: Loading markets...");

    await exchange.loadMarkets();
    console.log(
      `✅ Markets loaded: ${Object.keys(exchange.markets).length} trading pairs`
    );

    console.log("\n" + "-".repeat(60));
    console.log("Test 4: Fetching ticker for BTC/USDT...");

    const ticker = await exchange.fetchTicker("BTC/USDT");
    console.log(`✅ Current BTC/USDT price: $${ticker.last.toFixed(2)}`);

    console.log("\n" + "-".repeat(60));
    console.log("Test 5: Fetching recent candles...");

    const candles = await exchange.fetchOHLCV("BTC/USDT", "5m", undefined, 10);
    console.log(`✅ Fetched ${candles.length} candles`);
    console.log(
      `   Latest candle close: $${candles[candles.length - 1][4].toFixed(2)}`
    );

    console.log("\n" + "=".repeat(60));
    console.log("✅ ALL TESTS PASSED - Connection is working!");
    console.log("=".repeat(60));
    console.log("\nYou can now run the backtest with: npm run backtest");
  } catch (error) {
    console.log("\n" + "=".repeat(60));
    console.log("❌ CONNECTION TEST FAILED");
    console.log("=".repeat(60));
    console.log("\nError:", error.message);

    if (
      error.message.includes("fetch failed") ||
      error.message.includes("Network")
    ) {
      console.log("\n🔧 Troubleshooting Steps:\n");
      console.log("1. Check Internet Connection:");
      console.log("   - Can you browse websites?");
      console.log("   - Try: curl https://api.bybit.com/v5/market/time");

      console.log("\n2. Windows SSL Certificate Issue (Most Common):");
      console.log("   Option A - Install win-ca (Recommended):");
      console.log("     npm install -g win-ca");
      console.log("     win-ca-update");

      console.log("\n   Option B - Temporary bypass (Testing only):");
      console.log("     set NODE_TLS_REJECT_UNAUTHORIZED=0");
      console.log("     node test-connection.js");

      console.log("\n3. Firewall/Antivirus:");
      console.log("   - Temporarily disable and test");
      console.log("   - Add Node.js to firewall exceptions");

      console.log("\n4. Corporate Proxy:");
      console.log("   - Set proxy: set HTTPS_PROXY=http://proxy:port");
      console.log("   - Contact IT if on corporate network");

      console.log("\n5. Try Different API:");
      console.log("   - Test with Binance: node test-connection.js binance");
    }

    console.log("\n" + "=".repeat(60));
    process.exit(1);
  }
}

// Run test
testConnection().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
