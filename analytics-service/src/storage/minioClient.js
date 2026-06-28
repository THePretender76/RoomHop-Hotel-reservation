'use strict';

// =====================================================================
// MINIO CLIENT
// S3-compatible object storage client for the analytics data lake.
// Creates the analytics bucket on startup if it doesn't exist.
// =====================================================================

const Minio = require('minio');
const config = require('../config');
const logger = require('../logger');

const minioClient = new Minio.Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

/**
 * Ensure the analytics bucket exists. Creates it if missing.
 */
async function ensureBucket() {
  const exists = await minioClient.bucketExists(config.minio.bucket);
  if (!exists) {
    await minioClient.makeBucket(config.minio.bucket);
    logger.info('Analytics bucket created', { bucket: config.minio.bucket });
  } else {
    logger.info('Analytics bucket exists', { bucket: config.minio.bucket });
  }
}

/**
 * Upload a buffer to MinIO at the given object path.
 * @param {string} objectPath - e.g. 'reservations/year=2026/month=06/data_001.parquet'
 * @param {Buffer} buffer - Parquet file buffer
 */
async function uploadBuffer(objectPath, buffer) {
  await minioClient.putObject(config.minio.bucket, objectPath, buffer, {
    'Content-Type': 'application/octet-stream',
  });
  logger.debug('Object uploaded to MinIO', { bucket: config.minio.bucket, path: objectPath, size: buffer.length });
}

module.exports = { minioClient, ensureBucket, uploadBuffer };
