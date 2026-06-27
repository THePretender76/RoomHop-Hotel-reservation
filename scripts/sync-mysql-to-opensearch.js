// ==============================
// INITIAL SYNC SCRIPT
// MySQL → OpenSearch
// ==============================

const db = require('../hotel-api/src/db');
const os = require('../hotel-api/src/opensearch');

async function sync() {

  try {
    console.log("🚀 Starting sync MySQL → OpenSearch");

    // 1. Lire tous les hôtels depuis MySQL
    const [rows] = await db.query("SELECT * FROM Hotels");

    console.log(`📦 ${rows.length} hotels found in MySQL`);

    // 2. Indexer un par un dans OpenSearch
    for (const hotel of rows) {

      await os.index({
        index: 'hotels',
        id: hotel.id,
        body: {
          id: hotel.id,
          nom: hotel.nom,
          adresse: hotel.adresse,
          ville: hotel.ville,
          description: hotel.description,
          etoiles: hotel.etoiles
        }
      });

      console.log(`✔ Indexed hotel ${hotel.id}`);
    }

    console.log("🎉 SYNC COMPLETED");

  } catch (err) {
    console.error("🔥 SYNC ERROR:", err);
  }
}

sync();