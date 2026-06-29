'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'eu-west-1' });

exports.handler = async (event) => {
  const BUCKET = process.env.ANALYTICS_BUCKET;

  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    const detail = body.detail || body;
    const detailType = body['detail-type'] || 'Unknown';
    const timestamp = new Date().toISOString();
    const [year, month, day] = timestamp.split('T')[0].split('-');

    const key = `reservations/year=${year}/month=${month}/day=${day}/${detailType}_${detail.reservationId || Date.now()}.json`;

    const analyticsRecord = {
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
    };

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(analyticsRecord),
      ContentType: 'application/json',
    }));

    console.log(`Analytics record written: ${key}`);
  }
};
