'use strict';

const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const logger = require('./logger');

const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT || 'https://localhost:9200';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

let client = null;

function getClient() {
  if (client) return client;

  client = new Client({
    ...AwsSigv4Signer({
      region: AWS_REGION,
      getCredentials: defaultProvider(),
    }),
    node: OPENSEARCH_ENDPOINT,
  });

  return client;
}

/**
 * Search for available hotels/room types in OpenSearch.
 * The index is populated by DMS CDC from RDS.
 */
async function searchHotels({ location, checkIn, checkOut, guests, minPrice, maxPrice }) {
  const os = getClient();

  // Build the OpenSearch query
  const must = [];
  const filter = [];

  // Location match (fuzzy full-text search)
  if (location) {
    must.push({
      multi_match: {
        query: location,
        fields: ['hotel_name^3', 'hotel_location^2', 'hotel_description'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });
  }

  // Guest capacity filter
  if (guests) {
    filter.push({ range: { max_occupancy: { gte: parseInt(guests, 10) } } });
  }

  // Price range filters
  if (minPrice) {
    filter.push({ range: { nightly_rate: { gte: parseFloat(minPrice) } } });
  }
  if (maxPrice) {
    filter.push({ range: { nightly_rate: { lte: parseFloat(maxPrice) } } });
  }

  // Date range filter (inventory available for the requested dates)
  if (checkIn && checkOut) {
    filter.push({ range: { date: { gte: checkIn, lt: checkOut } } });
  }

  const body = {
    size: 100,
    query: {
      bool: {
        must: must.length > 0 ? must : [{ match_all: {} }],
        filter,
      },
    },
    _source: [
      'hotel_id', 'hotel_name', 'hotel_location', 'hotel_description', 'hotel_stars',
      'room_type_id', 'room_type_name', 'max_occupancy', 'amenities',
      'nightly_rate', 'total_inventory', 'total_reserved', 'date',
      'primary_image_url',
    ],
  };

  try {
    const response = await os.search({
      index: 'hotel_rooms',
      body,
    });

    return response.body.hits.hits.map((hit) => hit._source);
  } catch (err) {
    logger.error('OpenSearch query failed', { error: err.message });
    throw err;
  }
}

/**
 * Create the hotel_rooms index with proper mappings.
 * Called once during initial setup or when index needs recreation.
 */
async function createIndex() {
  const os = getClient();

  const exists = await os.indices.exists({ index: 'hotel_rooms' });
  if (exists.body) {
    logger.info('Index hotel_rooms already exists');
    return;
  }

  await os.indices.create({
    index: 'hotel_rooms',
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: {
          hotel_id: { type: 'integer' },
          hotel_name: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
          hotel_location: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
          hotel_description: { type: 'text', analyzer: 'standard' },
          hotel_stars: { type: 'integer' },
          room_type_id: { type: 'integer' },
          room_type_name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          max_occupancy: { type: 'integer' },
          amenities: { type: 'keyword' },
          nightly_rate: { type: 'float' },
          total_inventory: { type: 'integer' },
          total_reserved: { type: 'integer' },
          date: { type: 'date', format: 'yyyy-MM-dd' },
          primary_image_url: { type: 'keyword' },
        },
      },
    },
  });

  logger.info('Created hotel_rooms index');
}

module.exports = { searchHotels, createIndex, getClient };
