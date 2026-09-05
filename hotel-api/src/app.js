// ==============================
// IMPORT EXPRESS
// ==============================
const express = require('express');

const logger = require('./logger');
const requestLogger = require('./middleware/requestLogger');
const searchRoutes = require('./routes/search');
const v1SearchRoutes = require('./routes/v1/search');
const v1ReservationRoutes = require('./routes/v1/reservations');
const v1AdminRoutes = require('./routes/v1/admin');
const { initProducer } = require('./services/kafkaProducer');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:8080',
    'https://d2cnkscot7burf.cloudfront.net',
  ],
}));

// ==============================
// MIDDLEWARE
// ==============================
// Request logging — assigns requestId and logs lifecycle
app.use(requestLogger);

// Permet de lire les JSON envoyés par le client
app.use(express.json());

// ==============================
// ROUTES
// ==============================
// Toutes les routes "hotels" seront gérées ici
app.use('/hotels', require('./routes/hotels'));
app.use('/search', searchRoutes);
app.use('/v1/search', v1SearchRoutes);
app.use('/v1/reservations', v1ReservationRoutes);
app.use('/v1/admin', v1AdminRoutes);

// ==============================
// START SERVER
// ==============================
app.listen(3000, () => {
  logger.info('Hotel API started', { port: 3000 });
});

// ==============================
// KAFKA INIT (non-blocking)
// ==============================
initProducer().catch(err => logger.error('Kafka initialization failed', { error: err.message, stack: err.stack }));
