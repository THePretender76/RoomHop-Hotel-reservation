-- =============================================
-- RoomHop Booking Platform — Schema Migration V2
-- Drops legacy tables and creates the target schema
-- Requirements: 2.1, 2.2, 2.3, 2.4
-- =============================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================
-- Drop legacy tables (dependency order)
-- =============================================
DROP TABLE IF EXISTS Reservations;
DROP TABLE IF EXISTS Chambre_Inventory;
DROP TABLE IF EXISTS Chambres;
DROP TABLE IF EXISTS Chambres_Type;
DROP TABLE IF EXISTS Hotel_Images;
DROP TABLE IF EXISTS Hotels;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================
-- hotel
-- =============================================
CREATE TABLE hotel (
    hotel_id     INT PRIMARY KEY AUTO_INCREMENT,
    name         VARCHAR(150) NOT NULL,
    location     VARCHAR(255) NOT NULL,       -- city / address combined for search
    description  TEXT,
    stars        TINYINT CHECK (stars BETWEEN 1 AND 5),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- room_type
-- =============================================
CREATE TABLE room_type (
    room_type_id  INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id      INT NOT NULL,
    name          VARCHAR(100) NOT NULL,
    max_occupancy INT NOT NULL,
    amenities     JSON,                        -- ["WiFi","Pool","Breakfast"]
    FOREIGN KEY (hotel_id) REFERENCES hotel(hotel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- room  (physical rooms, optional but kept for model completeness)
-- =============================================
CREATE TABLE room (
    room_id      INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id     INT NOT NULL,
    room_type_id INT NOT NULL,
    room_number  VARCHAR(20) NOT NULL,
    FOREIGN KEY (hotel_id)      REFERENCES hotel(hotel_id)          ON DELETE CASCADE,
    FOREIGN KEY (room_type_id)  REFERENCES room_type(room_type_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- room_type_rate  (price per room type per date)
-- =============================================
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

-- =============================================
-- room_type_inventory  (availability counter per room type per date)
-- =============================================
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

-- =============================================
-- guest
-- =============================================
CREATE TABLE guest (
    guest_id   INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(100) NOT NULL,
    last_name  VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- reservation
-- =============================================
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
    idempotency_key VARCHAR(64) UNIQUE,        -- nullable, client-supplied UUID
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hotel_id)      REFERENCES hotel(hotel_id)          ON DELETE RESTRICT,
    FOREIGN KEY (room_type_id)  REFERENCES room_type(room_type_id)  ON DELETE RESTRICT,
    FOREIGN KEY (guest_id)      REFERENCES guest(guest_id)          ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- hotel_images  (FK updated to new hotel table)
-- =============================================
CREATE TABLE hotel_images (
    image_id    INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id    INT NOT NULL,
    image_url   VARCHAR(500) NOT NULL,         -- MinIO object key, e.g. "hotel_beaux_arts.png"
    is_primary  BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (hotel_id) REFERENCES hotel(hotel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- Performance indexes
-- =============================================
CREATE INDEX idx_hotel_location    ON hotel(location);
CREATE INDEX idx_inventory_date    ON room_type_inventory(date);
CREATE INDEX idx_rate_date         ON room_type_rate(date);
CREATE INDEX idx_reservation_guest ON reservation(guest_id, created_at DESC);
CREATE INDEX idx_reservation_dates ON reservation(start_date, end_date);
