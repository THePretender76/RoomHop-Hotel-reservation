'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || 'us-east-1',
});

function analyticsObjectFor(record) {
  const envelope = JSON.parse(record.body);
  const detail = envelope.detail || envelope;
  const detailType = envelope['detail-type'] || 'Unknown';
  const timestamp = envelope.time || new Date().toISOString();
  const [year, month, day] = timestamp.slice(0, 10).split('-');
  const safeType = detailType.replace(/[^A-Za-z0-9_-]/g, '_');
  const identifier = record.messageId || detail.reservationId || Date.now();

  return {
    key: `reservations/year=${year}/month=${month}/day=${day}/${safeType}_${identifier}.json`,
    body: {
      eventType: detailType,
      reservationId: detail.reservationId,
      guestEmail: detail.guestEmail,
      guestName: detail.guestName,
      hotelId: detail.hotelId,
      hotelName: detail.hotelName,
      roomType: detail.roomType,
      checkIn: detail.checkIn,
      checkOut: detail.checkOut,
      totalAmount: detail.totalAmount,
      currency: detail.currency || 'EUR',
      timestamp,
    },
  };
}

async function processRecord(record, client = s3Client) {
  const bucket = process.env.ANALYTICS_BUCKET;
  if (!bucket) throw new Error('ANALYTICS_BUCKET is not configured');
  const object = analyticsObjectFor(record);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: object.key,
    Body: JSON.stringify(object.body),
    ContentType: 'application/json',
  }));
  return object.key;
}

exports.handler = async (event) => {
  const failures = [];
  for (const record of event.Records || []) {
    try {
      const key = await processRecord(record);
      console.log(JSON.stringify({ message: 'Analytics record written', key }));
    } catch (error) {
      console.error(JSON.stringify({
        message: 'Analytics record failed',
        messageId: record.messageId,
        error: error.message,
      }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};

exports.analyticsObjectFor = analyticsObjectFor;
exports.processRecord = processRecord;
