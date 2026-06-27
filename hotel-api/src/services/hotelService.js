// ==============================
// IMPORTS
// ==============================
// db = connexion MySQL (base de données principale)
// os = client OpenSearch (moteur de recherche)
const db = require('../db');
const os = require('../opensearch');


// ==============================
// CREATE HOTEL + SYNC OPENSEARCH
// ==============================
// Cette fonction fait 2 choses :
// 1. Sauvegarde en base MySQL (source de vérité)
// 2. Indexe dans OpenSearch (pour la recherche)
async function createHotel(data) {

  // ==============================
  // 1. INSERT INTO MYSQL
  // ==============================
  // On enregistre l'hôtel dans la base de données principale
  const [result] = await db.query(
    `INSERT INTO Hotels (nom, adresse, ville, description, etoiles)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.nom,
      data.adresse,
      data.ville,
      data.description,
      data.etoiles
    ]
  );

  // ID généré automatiquement par MySQL
  const hotelId = result.insertId;


  // ==============================
  // 2. INDEX INTO OPENSEARCH
  // ==============================
  // On envoie les mêmes données dans OpenSearch
  // pour permettre la recherche rapide (full-text search)
  await os.index({
    index: 'hotels',     // nom de l’index
    id: hotelId,         // même ID que MySQL (important pour sync)
    body: {
      id: hotelId,
      nom: data.nom,
      adresse: data.adresse,
      ville: data.ville,
      description: data.description,
      etoiles: data.etoiles
    }
  });

  // ==============================
  // 3. RETURN RESULT
  // ==============================
  // On retourne l’ID de l’hôtel créé au client
  return { id: hotelId };
}


// ==============================
// EXPORT FUNCTION
// ==============================
// Permet d’utiliser cette fonction dans les routes
module.exports = { createHotel };