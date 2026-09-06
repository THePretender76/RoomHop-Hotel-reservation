'use strict';

const winston = require('winston');
const { currentTraceContext } = require('./tracing');

const SERVICE_NAME = process.env.SERVICE_NAME || 'search-service';
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const traceContextFormat = winston.format((info) => {
  Object.assign(info, currentTraceContext());
  return info;
})();

const structuredFormat = winston.format.combine(
  traceContextFormat,
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const transports = [
  new winston.transports.Console({
    format: isProduction
      ? structuredFormat
      : winston.format.combine(
          traceContextFormat,
          winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}] [${service || SERVICE_NAME}] ${message}${metaStr}`;
          })
        ),
  }),
];

const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: SERVICE_NAME },
  format: structuredFormat,
  transports,
});

module.exports = logger;
