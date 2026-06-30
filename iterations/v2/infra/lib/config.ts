// Shared configuration for all stacks — ITERATION 2 (With OpenSearch + DMS)
export const CONFIG = {
  projectName: 'roomhop-v2',
  environment: 'prod',
  region: 'us-east-1',
  vpc: {
    cidr: '10.1.0.0/16',
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
    domainName: 'roomhop-v2-search',
    instanceType: 't3.small.search',
    instanceCount: 1,
  },
  s3: {
    websiteBucket: 'roomhop-v2-website',
    imagesBucket: 'roomhop-v2-hotel-images',
    analyticsBucket: 'roomhop-v2-analytics-data',
  },
};
