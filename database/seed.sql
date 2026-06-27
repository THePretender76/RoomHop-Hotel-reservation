-- ==========================================
-- HOTELS
-- ==========================================

INSERT INTO Hotels (nom, adresse, ville, description, etoiles)
VALUES
('Hotel Beaux Arts', '12 Rue de Rivoli', 'Paris', 'Hotel élégant au centre de Paris', 4),
('Hotel Eclat', '45 Avenue Montaigne', 'Paris', 'Hotel moderne et luxueux', 5),
('Royal Hotel', '8 Boulevard Haussmann', 'Paris', 'Hotel classique et confortable', 4);

-- ==========================================
-- HOTEL IMAGES
-- IMPORTANT: adapte les hotel_id selon l’ordre d’insertion
-- ==========================================

INSERT INTO Hotel_Images (hotel_id, image_url, est_principale)
VALUES
(1, 'hotel_beaux_arts.png', TRUE),
(2, 'hotel_eclat.png', TRUE),
(3, 'royal_hotel.png', TRUE);

-- ==========================================
-- TYPES DE CHAMBRES
-- ==========================================

INSERT INTO Chambres_Type (hotel_id, nom_type, capacite, prix_base_nuit)
VALUES
(1, 'Double', 2, 120.00),
(1, 'Suite', 4, 250.00),
(2, 'Double', 2, 180.00),
(3, 'Single', 1, 90.00);

-- ==========================================
-- CHAMBRES
-- ==========================================

INSERT INTO Chambres (hotel_id, type_chambre_id, numero_chambre)
VALUES
(1, 1, '101'),
(1, 2, '201'),
(2, 3, '102'),
(3, 4, '001');

-- ==========================================
-- RESERVATIONS (exemple test)
-- ==========================================

INSERT INTO Reservations (chambre_id, user_id, date_debut, date_fin, prix_total, statut)
VALUES
(1, 1, '2026-06-25', '2026-06-28', 360.00, 'CONFIRMED');