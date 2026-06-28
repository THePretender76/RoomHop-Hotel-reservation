'use strict';

// =====================================================================
// CONFIGURATION
// Centralized config from environment variables with sensible defaults.
// =====================================================================

module.exports = {
  kafka: {
    broker: process.env.KAFKA_BROKER || 'localhost:9022',
    groupId: 'analytics-service',
    topic: 'hotel.events.reservations',
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'miniopassword',
    useSSL: false,
    bucket: 'hotel-analytic-roomhop-76700',
  },
  service: {
    name: 'analytics-service',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};
