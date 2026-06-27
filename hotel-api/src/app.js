// ==============================
// IMPORT EXPRESS
// ==============================
const express = require('express');

const searchRoutes = require('./routes/search');
const v1SearchRoutes = require('./routes/v1/search');
const v1ReservationRoutes = require('./routes/v1/reservations');
const { initProducer } = require('./services/kafkaProducer');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:8080'],
}));

// ==============================
// MIDDLEWARE
// ==============================
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

// ==============================
// START SERVER
// ==============================
app.listen(3000, () => {
  console.log('🚀 Hotel API running on port 3000');
});

// ==============================
// KAFKA INIT (non-blocking)
// ==============================
initProducer().catch(err => console.error('[app] Kafka init error:', err));