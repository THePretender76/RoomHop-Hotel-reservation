'use strict';

// =====================================================================
// REQUEST LOGGER MIDDLEWARE
//
// Assigns a unique request ID to each incoming request and logs:
//   - Request start (method, path, query params)
//   - Request completion (status code, duration)
//
// The request ID is attached to req.requestId for use in route handlers.
// =====================================================================

const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

function requestLogger(req, res, next) {
  // Generate unique request ID
  req.requestId = req.headers['x-request-id'] || uuidv4();
  const startTime = Date.now();

  // Log incoming request
  logger.info('Request received', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
  });

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('Request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

module.exports = requestLogger;
