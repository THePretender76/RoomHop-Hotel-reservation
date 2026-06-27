// ==============================
// IMPORTS
// ==============================
const express = require('express');
const router = express.Router();
const os = require('../opensearch');
const db = require('../db');


// ==============================
// SEARCH HOTELS
// ==============================
// Cette API permet de rechercher dans OpenSearch
router.get('/', async (req, res) => {

  try {

    // ==============================
    // 1. RECUPERATION DES PARAMETRES
    // ==============================
    const { q, ville, etoiles } = req.query;

    // ==============================
    // 2. CONSTRUCTION DE LA REQUETE OPENSEARCH
    // ==============================
    let query = {
      bool: {
        must: []
      }
    };

    // ==============================
    // 3. FULL TEXT SEARCH (q)
    // ==============================
    if (q) {
      query.bool.must.push({
        multi_match: {
          query: q,
          fields: ["nom", "description", "ville", "adresse"]
        }
      });
    }

    // ==============================
    // 4. FILTRE VILLE
    // ==============================
    if (ville) {
      query.bool.must.push({
        match: {
          ville: ville
        }
      });
    }

    // ==============================
    // 5. FILTRE ETOILES
    // ==============================
    if (etoiles) {
      query.bool.must.push({
        match: {
          etoiles: parseInt(etoiles)
        }
      });
    }

    // ==============================
    // 6. EXECUTION OPENSEARCH
    // ==============================
    const result = await os.search({
      index: 'hotels',
      body: {
        query: query
      }
    });

    // ==============================
    // 7. FORMAT RESPONSE
    // ==============================
    const hits = result.body?.hits?.hits || result.hits?.hits || [];

    // ==============================
    // 7. RECUPERATION IMAGES MYSQL
    // ==============================
    const [images] = await db.query(`
      SELECT
        h.id,
        i.image_url
      FROM Hotels h
      LEFT JOIN Hotel_Images i
        ON h.id = i.hotel_id
        AND i.est_principale = TRUE
    `);

    res.json({
      total: hits.length,
      results: hits.map(h => {
        const hotel = h._source;
        const img = images.find(i => i.id === hotel.id);

        return {
          ...hotel,
          image_url: img?.image_url
            ? `http://localhost:9000/hotels/${img.image_url}`
            : null
        };
      })
    });

  } catch (error) {

    console.error(" SEARCH ERROR:", error);

    res.status(500).json({
      error: error.message
    });
  }
// ==============================
// EXPORT ROUTER
// ==============================
});

// ==============================
// EXPORT ROUTER
// ==============================
module.exports = router;