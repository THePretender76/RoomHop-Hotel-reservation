'use strict';

const express = require('express');
const cors = require('cors');
const logger = require('./logger');
const reservationRoutes = require('./routes/reservations');
const adminRoutes = require('./routes/admin');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — allow ALB and CloudFront origins
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['*'],
}));

// JSON body parsing
app.use(express.json());

// Health check for ALB target group
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy', service: 'reservation-service' }));

// Routes
app.use('/v1/reservations', authenticate, reservationRoutes);
app.use('/v1/admin', authenticate, adminRoutes);

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info('Reservation service started', { port: PORT });
});
