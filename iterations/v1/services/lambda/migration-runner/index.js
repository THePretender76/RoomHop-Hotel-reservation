'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const mysql = require('mysql2/promise');

const s3 = new S3Client({});
const sm = new SecretsManagerClient({});

exports.handler = async (event) => {
  // Get DB credentials
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const creds = JSON.parse(secret.SecretString);
  
  // Connect to MySQL
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: process.env.DB_NAME || 'hotel_db',
    multipleStatements: true,
  });

  // Get SQL file from S3
  const bucket = process.env.S3_BUCKET;
  const key = event.sqlKey || 'migrations/migration_v2.sql';
  
  console.log(`Reading SQL from s3://${bucket}/${key}`);
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const sql = await obj.Body.transformToString();
  
  console.log(`Executing SQL (${sql.length} chars)...`);
  await conn.query(sql);
  
  console.log('Migration completed successfully');
  await conn.end();
  
  return { statusCode: 200, body: `Migration ${key} executed successfully` };
};
