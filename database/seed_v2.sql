-- =============================================
-- RoomHop Booking Platform — Seed Data V2
-- Populates the V2 schema with representative test data
-- Requirements: 2.1, 10.1
-- =============================================
-- Run AFTER migration_v2.sql has been applied.
-- All date ranges are relative to CURDATE() so the
-- 30-day window always starts from today.
-- =============================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================
-- Clean slate (safe to re-run)
-- =============================================
TRUNCATE TABLE reservation;
TRUNCATE TABLE room_type_inventory;
TRUNCATE TABLE room_type_rate;
TRUNCATE TABLE hotel_images;
TRUNCATE TABLE room;
TRUNCATE TABLE room_type;
TRUNCATE TABLE guest;
TRUNCATE TABLE hotel;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================
-- Hotels  (3 properties)
-- =============================================
INSERT INTO hotel (hotel_id, name, location, description, stars) VALUES
(1, 'Hotel Beaux Arts',  'Paris, 12 Rue de Rivoli',       'Elegant 19th-century hotel steps from the Louvre, blending classical architecture with modern comfort.',   4),
(2, 'Hotel Grand Palais','Paris, 45 Avenue Montaigne',    'Luxurious five-star retreat on the Golden Triangle, offering panoramic views of the Eiffel Tower.',          5),
(3, 'Hotel Marina Bay',  'Nice, 8 Promenade des Anglais', 'Contemporary beachfront property on the Côte d''Azur with direct access to the Mediterranean.',            4);

-- =============================================
-- Hotel Images  (MinIO object keys)
-- =============================================
INSERT INTO hotel_images (hotel_id, image_url, is_primary) VALUES
-- Beaux Arts
(1, 'hotel_beaux_arts.png',         TRUE),
(1, 'hotel_beaux_arts_lobby.png',   FALSE),
(1, 'hotel_beaux_arts_room.png',    FALSE),
-- Grand Palais
(2, 'hotel_grand_palais.png',       TRUE),
(2, 'hotel_grand_palais_suite.png', FALSE),
(2, 'hotel_grand_palais_pool.png',  FALSE),
-- Marina Bay
(3, 'hotel_marina.png',             TRUE),
(3, 'hotel_marina_beach.png',       FALSE),
(3, 'hotel_marina_room.png',        FALSE);

-- =============================================
-- Room Types  (2–3 per hotel)
-- =============================================
INSERT INTO room_type (room_type_id, hotel_id, name, max_occupancy, amenities) VALUES
-- Beaux Arts
(1,  1, 'Classic Double',   2, '["WiFi","Air Conditioning","Safe","Flat-screen TV"]'),
(2,  1, 'Deluxe Twin',      2, '["WiFi","Air Conditioning","Safe","Flat-screen TV","City View"]'),
(3,  1, 'Junior Suite',     3, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Mini Bar","Lounge Area"]'),
-- Grand Palais
(4,  2, 'Superior Room',    2, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Breakfast Included"]'),
(5,  2, 'Prestige Suite',   4, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Mini Bar","Jacuzzi","Butler Service"]'),
(6,  2, 'Penthouse',        4, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Mini Bar","Jacuzzi","Private Terrace","Butler Service"]'),
-- Marina Bay
(7,  3, 'Sea View Double',  2, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Sea View","Beach Access"]'),
(8,  3, 'Family Room',      4, '["WiFi","Air Conditioning","Safe","Flat-screen TV","Sea View","Beach Access","Extra Beds"]');

-- =============================================
-- Physical Rooms  (2–4 per room type)
-- =============================================
INSERT INTO room (hotel_id, room_type_id, room_number) VALUES
-- Beaux Arts — Classic Double (rt 1)
(1, 1, '101'), (1, 1, '102'), (1, 1, '103'),
-- Beaux Arts — Deluxe Twin (rt 2)
(1, 2, '201'), (1, 2, '202'),
-- Beaux Arts — Junior Suite (rt 3)
(1, 3, '301'),
-- Grand Palais — Superior Room (rt 4)
(2, 4, '101'), (2, 4, '102'), (2, 4, '103'), (2, 4, '104'),
-- Grand Palais — Prestige Suite (rt 5)
(2, 5, '201'), (2, 5, '202'),
-- Grand Palais — Penthouse (rt 6)
(2, 6, 'PH1'),
-- Marina Bay — Sea View Double (rt 7)
(3, 7, '101'), (3, 7, '102'), (3, 7, '103'),
-- Marina Bay — Family Room (rt 8)
(3, 8, '201'), (3, 8, '202');

-- =============================================
-- Guests  (at least 2)
-- =============================================
INSERT INTO guest (guest_id, first_name, last_name, email) VALUES
(1, 'Alice',  'Martin',   'alice.martin@example.com'),
(2, 'Bob',    'Dupont',   'bob.dupont@example.com'),
(3, 'Claire', 'Lefebvre', 'claire.lefebvre@example.com');

-- =============================================
-- 30-Day Rates and Inventory
-- Generated via a stored procedure so CURDATE() anchors all dates.
-- =============================================

DROP PROCEDURE IF EXISTS seed_rates_and_inventory;

DELIMITER $$

CREATE PROCEDURE seed_rates_and_inventory()
BEGIN
    DECLARE i INT DEFAULT 0;
    DECLARE cur_date DATE;

    -- (room_type_id, nightly_rate, total_inventory)
    -- Rates: flat for simplicity; inventory reflects physical room count above.

    WHILE i < 30 DO
        SET cur_date = CURDATE() + INTERVAL i DAY;

        -- ── Hotel 1 · Beaux Arts ────────────────────────────────────────
        -- rt 1  Classic Double   120.00  3 rooms
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (1, 1, cur_date, 120.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (1, 1, cur_date, 3, 0);

        -- rt 2  Deluxe Twin      150.00  2 rooms
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (1, 2, cur_date, 150.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (1, 2, cur_date, 2, 0);

        -- rt 3  Junior Suite     250.00  1 room
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (1, 3, cur_date, 250.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (1, 3, cur_date, 1, 0);

        -- ── Hotel 2 · Grand Palais ──────────────────────────────────────
        -- rt 4  Superior Room    200.00  4 rooms
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (2, 4, cur_date, 200.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (2, 4, cur_date, 4, 0);

        -- rt 5  Prestige Suite   450.00  2 rooms
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (2, 5, cur_date, 450.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (2, 5, cur_date, 2, 0);

        -- rt 6  Penthouse        900.00  1 room
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (2, 6, cur_date, 900.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (2, 6, cur_date, 1, 0);

        -- ── Hotel 3 · Marina Bay ────────────────────────────────────────
        -- rt 7  Sea View Double  175.00  3 rooms
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (3, 7, cur_date, 175.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (3, 7, cur_date, 3, 0);

        -- rt 8  Family Room      220.00  2 rooms
        INSERT IGNORE INTO room_type_rate      (hotel_id, room_type_id, date, nightly_rate)              VALUES (3, 8, cur_date, 220.00);
        INSERT IGNORE INTO room_type_inventory (hotel_id, room_type_id, date, total_inventory, total_reserved) VALUES (3, 8, cur_date, 2, 0);

        SET i = i + 1;
    END WHILE;
END$$

DELIMITER ;

CALL seed_rates_and_inventory();

DROP PROCEDURE IF EXISTS seed_rates_and_inventory;

-- =============================================
-- Verification counts (optional — comment out in production)
-- =============================================
-- SELECT 'hotel'               AS tbl, COUNT(*) AS rows FROM hotel
-- UNION ALL
-- SELECT 'hotel_images',                COUNT(*) FROM hotel_images
-- UNION ALL
-- SELECT 'room_type',                   COUNT(*) FROM room_type
-- UNION ALL
-- SELECT 'room',                        COUNT(*) FROM room
-- UNION ALL
-- SELECT 'guest',                       COUNT(*) FROM guest
-- UNION ALL
-- SELECT 'room_type_rate (expect 240)', COUNT(*) FROM room_type_rate
-- UNION ALL
-- SELECT 'room_type_inventory (240)',   COUNT(*) FROM room_type_inventory;
