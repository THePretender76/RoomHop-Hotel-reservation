'use strict';

const logger = require('./logger');

async function sendEmail(to, subject, body) {
  logger.info('Email sent', { to, subject });
  logger.debug('Email body', { to, body });
}

module.exports = { sendEmail };
