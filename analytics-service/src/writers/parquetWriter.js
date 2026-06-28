'use strict';

// =====================================================================
// PARQUET WRITER
//
// Writes analytical event data as Apache Parquet files to MinIO.
//
// WHY PARQUET?
// - Columnar format: only reads columns needed for a query (column pruning)
// - Compressed: 5-10x smaller than JSON/CSV
// - Typed: schema-embedded, no parsing ambiguity
// - Predicate pushdown: Trino can skip row groups based on min/max stats
// - Industry standard for data lakes (Spark, Trino, Athena, BigQuery)
//
// Each batch of events is written as a single Parquet file, partitioned
// by year/month for efficient time-range queries.
// =====================================================================

const parquet = require('@dsnp/parquetjs');
const { v4: uuidv4 } = require('uuid');
const { uploadBuffer } = require('../storage/minioClient');
const logger = require('../logger');

// Schema for reservation analytics
const reservationSchema = new parquet.ParquetSchema({
  reservation_id: { type: 'INT64' },
  hotel_id: { type: 'INT64' },
  guest_id: { type: 'INT64' },
  room_type: { type: 'UTF8', optional: true },
  event_type: { type: 'UTF8' },
  booking_date: { type: 'UTF8' },
  check_in: { type: 'UTF8', optional: true },
  check_out: { type: 'UTF8', optional: true },
  room_count: { type: 'INT32', optional: true },
  amount: { type: 'DOUBLE', optional: true },
  guest_email: { type: 'UTF8', optional: true },
  hotel_name: { type: 'UTF8', optional: true },
  occurred_at: { type: 'UTF8' },
  year: { type: 'INT32' },
  month: { type: 'INT32' },
});

/**
 * Write a batch of reservation events as a Parquet file to MinIO.
 * @param {Array} events - Array of transformed reservation event objects
 */
async function writeReservationBatch(events) {
  if (!events || events.length === 0) return;

  // Determine partition from first event
  const firstEvent = events[0];
  const year = firstEvent.year;
  const month = String(firstEvent.month).padStart(2, '0');
  const filename = `${uuidv4()}.parquet`;
  const objectPath = `reservations/year=${year}/month=${month}/${filename}`;

  // Write to a temporary local file, then upload to MinIO
  const fs = require('fs');
  const path = require('path');
  const tmpDir = path.join(__dirname, '../../tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, filename);

  const fileWriter = await parquet.ParquetWriter.openFile(reservationSchema, tmpFile);
  for (const event of events) {
    await fileWriter.appendRow(event);
  }
  await fileWriter.close();

  // Read the file and upload to MinIO
  const buffer = fs.readFileSync(tmpFile);
  await uploadBuffer(objectPath, buffer);

  // Clean up temp file
  fs.unlinkSync(tmpFile);

  logger.info('Parquet batch written', {
    path: objectPath,
    records: events.length,
    sizeBytes: buffer.length,
    partition: `year=${year}/month=${month}`,
  });
}

module.exports = { writeReservationBatch, reservationSchema };
