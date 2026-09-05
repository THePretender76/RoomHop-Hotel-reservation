'use strict';

const mysql = require('mysql2/promise');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

let pool = null;

async function getPool() {
  if (pool) return pool;

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const secret = await client.send(new GetSecretValueCommand({
    SecretId: process.env.DB_SECRET_ARN,
  }));

  const credentials = JSON.parse(secret.SecretString);

  pool = mysql.createPool({
    host: credentials.host,
    port: credentials.port,
    user: credentials.username,
    password: credentials.password,
    database: process.env.DB_NAME || 'hotel_db',
    waitForConnections: true,
    connectionLimit: 10,
  });

  return pool;
}

// Proxy that lazily initializes the pool
module.exports = {
  query: async (...args) => { const p = await getPool(); return p.query(...args); },
  getConnection: async () => { const p = await getPool(); return p.getConnection(); },
};
