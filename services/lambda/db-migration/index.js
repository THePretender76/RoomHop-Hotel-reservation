'use strict';
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const mysql = require('mysql2/promise');

// Migration SQL embedded directly (avoiding S3 dependency)
const MIGRATION_SQL = `
-- =============================================
-- RoomHop Booking Platform — Schema Migration V2
-- Drops legacy tables and creates the target schema
-- =============================================

SET FOREIGN_KEY_CHECKS = 0;

-- Drop legacy tables (dependency order)
DROP TABLE IF EXISTS Reservations;
DROP TABLE IF EXISTS Chambre_Inventory;
DROP TABLE IF EXISTS Chambres;
DROP TABLE IF EXISTS Chambres_Type;
DROP TABLE IF EXISTS Hotel_Images;
DROP TABLE IF EXISTS Hotels;

-- Drop current tables for clean re-creation
DROP TABLE IF EXISTS hotel_admin_properties;
DROP TABLE IF EXISTS hotel_administrators;
DROP TABLE IF EXISTS reservation;
DROP TABLE IF EXISTS room_type_inventory;
DROP TABLE IF EXISTS room_type_rate;
DROP TABLE IF EXISTS hotel_images;
DROP TABLE IF EXISTS room;
DROP TABLE IF EXISTS room_type;
DROP TABLE IF EXISTS guest;
DROP TABLE IF EXISTS hotel;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE hotel (
    hotel_id     INT PRIMARY KEY AUTO_INCREMENT,
    name         VARCHAR(150) NOT NULL,
    location     VARCHAR(255) NOT NULL,
    description  TEXT,
    stars        TINYINT CHECK (stars BETWEEN 1 AND 5),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at   TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_type (
    room_type_id  INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id      INT NOT NULL,
    name          VARCHAR(100) NOT NULL,
    max_occupancy INT NOT NULL,
    amenities     JSON,
    FOREIGN KEY (hotel_id) REFERENCES hotel(hotel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room (
    room_id      INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id     INT NOT NULL,
    room_type_id INT NOT NULL,
    room_number  VARCHAR(20) NOT NULL,
    FOREIGN KEY (hotel_id)      REFERENCES hotel(hotel_id)          ON DELETE CASCADE,
    FOREIGN KEY (room_type_id)  REFERENCES room_type(room_type_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_type_rate (
    rate_id      INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id     INT NOT NULL,
    room_type_id INT NOT NULL,
    date         DATE NOT NULL,
    nightly_rate DECIMAL(10,2) NOT NULL,
    UNIQUE KEY uq_rate (hotel_id, room_type_id, date),
    FOREIGN KEY (hotel_id)      REFERENCES hotel(hotel_id)          ON DELETE CASCADE,
    FOREIGN KEY (room_type_id)  REFERENCES room_type(room_type_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_type_inventory (
    inventory_id    INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id        INT NOT NULL,
    room_type_id    INT NOT NULL,
    date            DATE NOT NULL,
    total_inventory INT NOT NULL DEFAULT 0,
    total_reserved  INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_inventory (hotel_id, room_type_id, date),
    FOREIGN KEY (hotel_id)      REFERENCES hotel(hotel_id)          ON DELETE CASCADE,
    FOREIGN KEY (room_type_id)  REFERENCES room_type(room_type_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE guest (
    guest_id   INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(100) NOT NULL,
    last_name  VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    cognito_sub VARCHAR(255) NULL,
    phone      VARCHAR(30),
    date_of_birth DATE,
    nationality VARCHAR(60),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_guest_cognito_sub (cognito_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservation (
    reservation_id  INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id        INT NOT NULL,
    room_type_id    INT NOT NULL,
    guest_id        INT NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    status          ENUM('CONFIRMED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
    room_count      INT NOT NULL DEFAULT 1,
    amount          DECIMAL(10,2) NOT NULL,
    idempotency_key VARCHAR(64) UNIQUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hotel_id)      REFERENCES hotel(hotel_id)          ON DELETE RESTRICT,
    FOREIGN KEY (room_type_id)  REFERENCES room_type(room_type_id)  ON DELETE RESTRICT,
    FOREIGN KEY (guest_id)      REFERENCES guest(guest_id)          ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE hotel_images (
    image_id    INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id    INT NOT NULL,
    image_url   VARCHAR(500) NOT NULL,
    is_primary  BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (hotel_id) REFERENCES hotel(hotel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_hotel_location    ON hotel(location);
CREATE INDEX idx_inventory_date    ON room_type_inventory(date);
CREATE INDEX idx_rate_date         ON room_type_rate(date);
CREATE INDEX idx_reservation_guest ON reservation(guest_id, created_at DESC);
CREATE INDEX idx_reservation_dates ON reservation(start_date, end_date);
`;

const SEED_SQL = `
-- =============================================
-- RoomHop Booking Platform — Seed Data V2
-- =============================================

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE reservation;
TRUNCATE TABLE room_type_inventory;
TRUNCATE TABLE room_type_rate;
TRUNCATE TABLE hotel_images;
TRUNCATE TABLE room;
TRUNCATE TABLE room_type;
TRUNCATE TABLE guest;
TRUNCATE TABLE hotel;

SET FOREIGN_KEY_CHECKS = 1;

-- Hotels
INSERT INTO hotel (hotel_id, name, location, description, stars) VALUES
(1, 'Hotel Beaux Arts',  'Paris, 12 Rue de Rivoli',       'Elegant 19th-century hotel steps from the Louvre, blending classical architecture with modern comfort.',   4),
(2, 'Hotel Grand Palais','Paris, 45 Avenue Montaigne',    'Luxurious five-star retreat on the Golden Triangle, offering panoramic views of the Eiffel Tower.',          5),
(3, 'Hotel Marina Bay',  'Nice, 8 Promenade des Anglais', 'Contemporary beachfront property on the Cote d''Azur with direct access to the Mediterranean.',            4);

-- Hotel Images
INSERT INTO hotel_images (hotel_id, image_url, is_primary) VALUES
(1, 'hotel_beaux_arts.png',         TRUE),
(1, 'hotel_beaux_arts_lobby.png',   FALSE),
(1, 'hotel_beaux_arts_room.png',    FALSE),
(2, 'hotel_grand_palais.png',       TRUE),
(2, 'hotel_grand_palais_suite.png', FALSE),
(2, 'hotel_grand_palais_pool.png',  FALSE),
(3, 'hotel_marina.png',             TRUE),
(3, 'hotel_marina_beach.png',       FALSE),
(3, 'hotel_marina_room.png',        FALSE);

-- Room Types
INSERT INTO room_type (room_type_id, hotel_id, name, max_occupancy, amenities) VALUES
(1,  1, 'Classic Double',   2, '["WiFi","Air Conditioning","Safe","Flat-screen TV"]'),
(2,  1, 'Deluxe Twin',      2, '["WiFi","Air Conditioning","Safe","Flat-screen TV","City View"]'),
(3,  1, 'Junior Suite',     3, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Mini Bar","Lounge Area"]'),
(4,  2, 'Superior Room',    2, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Breakfast Included"]'),
(5,  2, 'Prestige Suite',   4, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Mini Bar","Jacuzzi","Butler Service"]'),
(6,  2, 'Penthouse',        4, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Mini Bar","Jacuzzi","Private Terrace","Butler Service"]'),
(7,  3, 'Sea View Double',  2, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Sea View","Beach Access"]'),
(8,  3, 'Family Room',      4, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Sea View","Beach Access","Extra Beds"]');

-- Physical Rooms
INSERT INTO room (hotel_id, room_type_id, room_number) VALUES
(1, 1, '101'), (1, 1, '102'), (1, 1, '103'),
(1, 2, '201'), (1, 2, '202'),
(1, 3, '301'),
(2, 4, '101'), (2, 4, '102'), (2, 4, '103'), (2, 4, '104'),
(2, 5, '201'), (2, 5, '202'),
(2, 6, 'PH1'),
(3, 7, '101'), (3, 7, '102'), (3, 7, '103'),
(3, 8, '201'), (3, 8, '202');

-- Guests
INSERT INTO guest (guest_id, first_name, last_name, email) VALUES
(1, 'Alice',  'Martin',   'alice.martin@example.com'),
(2, 'Bob',    'Dupont',   'bob.dupont@example.com'),
(3, 'Claire', 'Lefebvre', 'claire.lefebvre@example.com');

`;

const ADMIN_APPLICATIONS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS hotel_administrators (
  admin_id              INT PRIMARY KEY AUTO_INCREMENT,
  cognito_sub           VARCHAR(255) NOT NULL,
  cognito_username      VARCHAR(255) NULL,
  company_name          VARCHAR(255) NOT NULL,
  tax_id                VARCHAR(100) NOT NULL,
  full_name             VARCHAR(200) NOT NULL,
  corporate_email       VARCHAR(255) NOT NULL,
  phone_number          VARCHAR(50),
  head_office_address   TEXT,
  estimated_properties  INT DEFAULT 0,
  primary_city          VARCHAR(150),
  website_url           VARCHAR(500),
  status                ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  hotel_id              INT NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hotel_administrator_cognito_sub (cognito_sub),
  FOREIGN KEY (hotel_id) REFERENCES hotel(hotel_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_admin_properties (
  admin_id  INT NOT NULL,
  hotel_id  INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id, hotel_id),
  FOREIGN KEY (admin_id) REFERENCES hotel_administrators(admin_id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotel(hotel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function indexExists(conn, tableName, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function applyIncrementalMigrations(conn) {
  await conn.query(ADMIN_APPLICATIONS_MIGRATION_SQL);

  // Keep enough RDS binary logs for DMS to resume CDC after interruptions.
  // This RDS-provided procedure is idempotent.
  await conn.query("CALL mysql.rds_set_configuration('binlog retention hours', 24)");

  if (!(await columnExists(conn, 'hotel', 'deleted_at'))) {
    await conn.query('ALTER TABLE hotel ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL');
  }
  if (!(await columnExists(conn, 'hotel_administrators', 'cognito_username'))) {
    await conn.query('ALTER TABLE hotel_administrators ADD COLUMN cognito_username VARCHAR(255) NULL AFTER cognito_sub');
  }
  if (!(await columnExists(conn, 'guest', 'cognito_sub'))) {
    await conn.query('ALTER TABLE guest ADD COLUMN cognito_sub VARCHAR(255) NULL AFTER email');
  }
  if (!(await indexExists(conn, 'guest', 'uq_guest_cognito_sub'))) {
    await conn.query('ALTER TABLE guest ADD UNIQUE KEY uq_guest_cognito_sub (cognito_sub)');
  }
  if (!(await indexExists(conn, 'hotel_administrators', 'uq_hotel_administrator_cognito_sub'))) {
    await conn.query('ALTER TABLE hotel_administrators ADD UNIQUE KEY uq_hotel_administrator_cognito_sub (cognito_sub)');
  }
}

function migrationPlanFor(event) {
  return {
    bootstrapBaseSchema: event.RequestType === 'Create',
    applyPartnerMigration: event.RequestType !== 'Delete',
  };
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));

  const physicalResourceId = event.PhysicalResourceId || 'roomhop-db-migration';

  // The CDK custom-resources.Provider framework sends the CloudFormation
  // response. The handler only returns a PhysicalResourceId and must not PUT
  // directly to event.ResponseURL.
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: physicalResourceId };
  }

  let conn;
  try {
    // Get DB credentials from Secrets Manager
    const sm = new SecretsManagerClient({});
    const secret = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
    const creds = JSON.parse(secret.SecretString);

    // Connect to MySQL
    conn = await mysql.createConnection({
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      database: process.env.DB_NAME || 'hotel_db',
      multipleStatements: true,
      connectTimeout: 30000,
    });

    console.log('Connected to RDS, running migration...');

    const migrationVersion = event.ResourceProperties?.migrationVersion || 'unknown';

    // A brand-new RDS database always needs the complete base schema, whatever
    // the latest incremental migration version happens to be. Updates must not
    // replay the destructive bootstrap migration and erase application data.
    const migrationPlan = migrationPlanFor(event);
    // An RDS replacement can present an empty database during a CloudFormation
    // UPDATE. Detect that state so the new database is bootstrapped without
    // ever replaying the destructive migration over an existing schema.
    const needsBootstrap = migrationPlan.bootstrapBaseSchema
      || !(await tableExists(conn, 'hotel'));
    if (needsBootstrap) {
      await conn.query(MIGRATION_SQL);
      console.log('Migration SQL executed successfully');

      // Run seed data (static: hotels, rooms, guests, images)
      await conn.query(SEED_SQL);
      console.log('Seed SQL executed successfully');

      // Generate 30-day rates and inventory dynamically
      // (avoids DELIMITER/stored procedure which doesn't work with multipleStatements)
      console.log('Generating 30-day rates and inventory...');
      const roomTypeConfig = [
        // [hotel_id, room_type_id, nightly_rate, total_inventory]
        [1, 1, 120.00, 3],
        [1, 2, 150.00, 2],
        [1, 3, 250.00, 1],
        [2, 4, 200.00, 4],
        [2, 5, 450.00, 2],
        [2, 6, 900.00, 1],
        [3, 7, 175.00, 3],
        [3, 8, 220.00, 2],
      ];

      for (let i = 0; i < 30; i++) {
        for (const [hotelId, roomTypeId, rate, inventory] of roomTypeConfig) {
          await conn.query(
            `INSERT IGNORE INTO room_type_rate (hotel_id, room_type_id, date, nightly_rate) VALUES (?, ?, CURDATE() + INTERVAL ? DAY, ?)`,
            [hotelId, roomTypeId, i, rate]
          );
          await conn.query(
            `INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (?, ?, CURDATE() + INTERVAL ? DAY, ?, 0)`,
            [hotelId, roomTypeId, i, inventory]
          );
        }
      }
      console.log('Rates and inventory seeded for 30 days');
    }

    // Idempotent incremental migration used both after a fresh bootstrap and
    // when upgrading an existing stack from an earlier migration version.
    if (migrationPlan.applyPartnerMigration) {
      await applyIncrementalMigrations(conn);
      console.log('Partner applications migration executed successfully');
    }

    console.log('Database migration complete');

    return {
      PhysicalResourceId: physicalResourceId,
      Data: { migrationVersion },
    };
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    if (conn) {
      await conn.end();
    }
  }
};

exports.migrationPlanFor = migrationPlanFor;
exports.tableExists = tableExists;
exports.columnExists = columnExists;
exports.indexExists = indexExists;
