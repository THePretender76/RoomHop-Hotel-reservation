// Shared configuration for all stacks — ITERATION 1 (No OpenSearch)
export const CONFIG = {
  projectName: 'roomhop-v1',
  environment: 'prod',
  region: 'us-east-1',
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
  },
  rds: {
    databaseName: 'hotel_db',
    instanceType: 'db.t3.medium',
    port: 3306,
  },
  ecs: {
    searchService: { cpu: 512, memory: 1024, desiredCount: 1 },
    reservationService: { cpu: 512, memory: 1024, desiredCount: 1 },
  },
  opensearch: {
    domainName: 'roomhop-v1-search',
    instanceType: 't3.small.search',
    instanceCount: 1,
  },
  s3: {
    websiteBucket: 'roomhop-v1-website',
    imagesBucket: 'roomhop-v1-hotel-images',
    analyticsBucket: 'roomhop-v1-analytics-data',
  },
};
