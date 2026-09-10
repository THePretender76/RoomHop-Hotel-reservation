'use strict';

const { shutdownTracing, startTracing, tracingMiddleware } = require('./tracing');
startTracing();

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
    : '*',
  maxAge: 3600,
}));

// JSON body parsing
app.use(express.json());

function reservationOperation(req) {
  if (req.method === 'POST' && req.path === '/v1/reservations') return 'reservation.create';
  if (req.method === 'DELETE' && req.path.startsWith('/v1/reservations/')) return 'reservation.cancel';
  if (req.path.startsWith('/v1/admin/')) return 'admin.request';
  return 'reservation.request';
}

app.use(tracingMiddleware(reservationOperation));

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
function startServer(port = PORT) {
  return app.listen(port, () => {
    logger.info('Reservation service started', { port });
  });
}

if (require.main === module) {
  const server = startServer();
  const stop = () => server.close(async () => {
    await shutdownTracing();
    process.exit(0);
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

module.exports = { app, reservationOperation, startServer };
