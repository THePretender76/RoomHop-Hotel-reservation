-- ==========================================
-- Table Hotels
-- ==========================================

CREATE TABLE Hotels (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nom VARCHAR(100) NOT NULL,
    adresse VARCHAR(255) NOT NULL,
    ville VARCHAR(100) NOT NULL,
    description TEXT,
    etoiles INT CHECK (etoiles BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- Table Chambres_Type
-- ==========================================

CREATE TABLE Chambres_Type (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id INT NOT NULL,
    nom_type VARCHAR(50) NOT NULL,
    capacite INT NOT NULL,
    prix_base_nuit DECIMAL(10,2) NOT NULL,

    FOREIGN KEY (hotel_id)
        REFERENCES Hotels(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- Table Chambres
-- ==========================================

CREATE TABLE Chambres (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id INT NOT NULL,
    type_chambre_id INT NOT NULL,
    numero_chambre VARCHAR(10) NOT NULL,

    FOREIGN KEY (hotel_id)
        REFERENCES Hotels(id)
        ON DELETE CASCADE,

    FOREIGN KEY (type_chambre_id)
        REFERENCES Chambres_Type(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- Table Reservations
-- ==========================================

CREATE TABLE Reservations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    chambre_id INT NOT NULL,
    user_id INT NOT NULL,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    prix_total DECIMAL(10,2) NOT NULL,
    statut VARCHAR(20) DEFAULT 'CONFIRMED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (chambre_id)
        REFERENCES Chambres(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- Table Hotel_Images
-- ==========================================

CREATE TABLE Hotel_Images (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    est_principale BOOLEAN DEFAULT FALSE,

    FOREIGN KEY (hotel_id)
        REFERENCES Hotels(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE Chambre_Inventory (
    id INT PRIMARY KEY AUTO_INCREMENT,
    chambre_id INT NOT NULL,
    date DATE NOT NULL,
    status ENUM('AVAILABLE', 'BOOKED', 'MAINTENANCE') DEFAULT 'AVAILABLE',

    FOREIGN KEY (chambre_id)
        REFERENCES Chambres(id)
        ON DELETE CASCADE,

    UNIQUE KEY unique_chambre_date (chambre_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- Index
-- ==========================================

CREATE INDEX idx_hotel_ville
ON Hotels(ville);

CREATE INDEX idx_chambre_hotel
ON Chambres(hotel_id);

CREATE INDEX idx_reservation_dates
ON Reservations(date_debut, date_fin);