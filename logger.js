import winston from "winston";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = join(__dirname, "logs");
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(meta).length > 0 && meta.stack === undefined) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (meta.stack) {
      log += `\n${meta.stack}`;
    }
    return log;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
    // File output - all logs
    new winston.transports.File({
      filename: join(logsDir, "bot.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File output - errors only
    new winston.transports.File({
      filename: join(logsDir, "error.log"),
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // File output - trades only
    new winston.transports.File({
      filename: join(logsDir, "trades.log"),
      level: "info",
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

export default logger;
