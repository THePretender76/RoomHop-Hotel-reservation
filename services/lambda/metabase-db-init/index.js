'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const mysql = require('mysql2/promise');

const secrets = new SecretsManagerClient({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || 'us-east-1',
});

async function readSecret(secretId, client = secrets) {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) throw new Error(`Secret ${secretId} has no SecretString`);
  return JSON.parse(response.SecretString);
}

async function initialiseDatabase(admin, metabase, createConnection = mysql.createConnection) {
  const connection = await createConnection({
    host: admin.host,
    port: admin.port || 3306,
    user: admin.username,
    password: admin.password,
    connectTimeout: 30000,
  });

  try {
    await connection.query(
      'CREATE DATABASE IF NOT EXISTS `metabase_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    await connection.query("CREATE USER IF NOT EXISTS 'metabase_user'@'%' IDENTIFIED BY ?", [metabase.password]);
    await connection.query("ALTER USER 'metabase_user'@'%' IDENTIFIED BY ?", [metabase.password]);
    await connection.query("GRANT ALL PRIVILEGES ON `metabase_db`.* TO 'metabase_user'@'%'");
  } finally {
    await connection.end();
  }
}

exports.handler = async (event) => {
  const physicalResourceId = event.PhysicalResourceId || 'roomhop-metabase-db';
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: physicalResourceId };
  }

  const [admin, metabase] = await Promise.all([
    readSecret(process.env.ADMIN_SECRET_ARN),
    readSecret(process.env.METABASE_SECRET_ARN),
  ]);
  if (!metabase.password) throw new Error('Metabase database password is missing');
  await initialiseDatabase(admin, metabase);

  return {
    PhysicalResourceId: physicalResourceId,
    Data: { DatabaseName: 'metabase_db', Username: 'metabase_user' },
  };
};

exports.readSecret = readSecret;
exports.initialiseDatabase = initialiseDatabase;
