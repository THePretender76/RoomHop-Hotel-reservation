'use strict';

const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 3 });

async function createHotelImageUpload({ contentType, contentLength }, cognitoSub) {
  const bucket = process.env.IMAGES_BUCKET;
  const extension = CONTENT_TYPES.get(String(contentType || '').toLowerCase());
  const size = Number(contentLength);
  if (!bucket) throw new Error('IMAGES_BUCKET is not configured');
  if (!extension) {
    const error = new Error('Image must be a JPEG, PNG, or WebP file');
    error.status = 422;
    throw error;
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_IMAGE_BYTES) {
    const error = new Error('Image must be smaller than 10 MB');
    error.status = 422;
    throw error;
  }

  const imageKey = `properties/${cognitoSub}/${crypto.randomUUID()}.${extension}`;
  const objectKey = `images/${imageKey}`;
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
  }), { expiresIn: 300 });

  return { uploadUrl, imageKey, expiresIn: 300 };
}

module.exports = { CONTENT_TYPES, MAX_IMAGE_BYTES, createHotelImageUpload };
