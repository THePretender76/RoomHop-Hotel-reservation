// ==============================
// OPENSEARCH CLIENT
// ==============================
// Permet de communiquer avec OpenSearch (moteur de recherche)

const { Client } = require('@opensearch-project/opensearch');

const client = new Client({
  node: 'http://localhost:9200' // OpenSearch local Docker
});

module.exports = client;