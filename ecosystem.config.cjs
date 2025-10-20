// PM2 Ecosystem Configuration for Multiple Trading Bots
module.exports = {
  apps: [
    {
      name: "smc-refined-bot",
      script: "index.js",
      env_file: ".env",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      error_file: "./logs/pm2-smc-error.log",
      out_file: "./logs/pm2-smc-out.log",
      time: true,
      env: {
        NODE_ENV: "production",
        STRATEGY: "smc-refined",
      },
    },
    {
      name: "upbit-listing-bot",
      script: "upbit-official-api-bot.js", // ULTRA-FAST: Official API (2s detection!)
      env_file: "./env.upbit-listing",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      error_file: "./logs/pm2-upbit-error.log",
      out_file: "./logs/pm2-upbit-out.log",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "scalping-bot",
      script: "ultra-top-performer-bot.js", // Live trading bot
      env_file: "./env.ultra-scalping",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      error_file: "./logs/pm2-ultra-scalping-error.log",
      out_file: "./logs/pm2-ultra-scalping-out.log",
      time: true,
      env: {
        NODE_ENV: "production",
        STRATEGY_TYPE: "ULTRA_SCALPING",
        SCALP_INITIAL_BALANCE: "100",
        SCALP_LEVERAGE: "10",
        SCALP_MARGIN_MODE: "cross",
      },
    },
  ],
};
