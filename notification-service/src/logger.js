'use strict';

// =====================================================================
// STRUCTURED LOGGER — Winston with optional CloudWatch transport
//
// Configuration via environment variables:
//   NODE_ENV       — 'production' enables CloudWatch transport
//   AWS_REGION     — AWS region for CloudWatch (e.g., 'eu-west-1')
//   LOG_LEVEL      — Minimum log level (default: 'info')
//   LOG_GROUP      — CloudWatch log group name (default: 'roomhop/<service>')
//   SERVICE_NAME   — Service identifier in log entries
//
// All logs are JSON-formatted with:
//   timestamp, level, service, message, and any additional metadata
// =====================================================================

const winston = require('winston');

// Service name — differs per service
const SERVICE_NAME = process.env.SERVICE_NAME || 'notification-service';

// Determine environment
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Custom JSON format with timestamp, service name, and structured metadata
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console transport — always active
const transports = [
  new winston.transports.Console({
    format: isProduction
      ? structuredFormat
      : winston.format.combine(
          winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}] [${service || SERVICE_NAME}] ${message}${metaStr}`;
          })
        ),
  }),
];

// File transport — write JSON logs to a file locally (useful for debugging)
if (!isProduction) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/app.log',
      format: structuredFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
    })
  );
}

// Create the logger instance
const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: SERVICE_NAME },
  format: structuredFormat,
  transports,
});

// CloudWatch transport — only in production when AWS_REGION is set
if (isProduction && process.env.AWS_REGION) {
  const WinstonCloudWatch = require('winston-cloudwatch');

  logger.add(new WinstonCloudWatch({
    logGroupName: process.env.LOG_GROUP || `roomhop/${SERVICE_NAME}`,
    logStreamName: `${SERVICE_NAME}-${new Date().toISOString().split('T')[0]}-${process.pid}`,
    awsRegion: process.env.AWS_REGION,
    jsonMessage: true,
    retentionInDays: 14,
    // AWS credentials are picked up automatically from:
    //   - IAM role (EC2/ECS/Lambda)
    //   - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    //   - ~/.aws/credentials
  }));

  logger.info('CloudWatch logging enabled', {
    logGroup: process.env.LOG_GROUP || `roomhop/${SERVICE_NAME}`,
    region: process.env.AWS_REGION,
  });
}

module.exports = logger;
