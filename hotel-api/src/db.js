// ==============================
// MYSQL CONNECTION POOL
// ==============================
// On crée une connexion réutilisable vers MySQL

const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: 'localhost',          // ton MySQL Docker
  user: 'root',               // utilisateur
  password: 'rootpassword',   // mot de passe
  database: 'hotel_db',       // base de données
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = db;