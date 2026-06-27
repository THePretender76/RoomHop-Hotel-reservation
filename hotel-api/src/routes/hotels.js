// ==============================
// IMPORTS
// ==============================
// express = framework API
// router = gestion des routes
const express = require('express');
const router = express.Router();

// service = logique métier (MySQL + OpenSearch)
const service = require('../services/hotelService');


// ==============================
// CREATE HOTEL ENDPOINT
// ==============================
// Cette API reçoit les données du client
// puis appelle le service qui :
/*
   1. enregistre dans MySQL
   2. indexe dans OpenSearch
*/
router.post('/', async (req, res) => {

  try {

    // On appelle la logique métier
    const result = await service.createHotel(req.body);

    // Réponse envoyée au client
    res.json({
      message: "Hotel created successfully and indexed in OpenSearch",
      data: result
    });

  } catch (error) {

    // Log de l’erreur pour debug backend
    console.error("🔥 ERROR while creating hotel:", error);

    // Réponse d’erreur propre
    res.status(500).json({
      error: error.message
    });
  }
});


// ==============================
// EXPORT ROUTER
// ==============================
// Permet à Express d’utiliser ces routes dans app.js
module.exports = router;