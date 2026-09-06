// Shared configuration for all stacks
export const CONFIG = {
  projectName: 'roomhop',
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
    metabaseService: { cpu: 1024, memory: 2048, desiredCount: 1 },
  },
  observability: {
    traceSamplingRates: {
      development: 1,
      dev: 1,
      test: 1,
      staging: 0.5,
      recette: 0.5,
      production: 0.1,
      prod: 0.1,
    } as Record<string, number>,
  },
  notifications: {
    operationsEmail: 'thenewpretender76@outlook.com',
  },
  opensearch: {
    domainName: 'roomhop-search',
    instanceType: 't3.small.search',
    instanceCount: 1,
  },
  dms: {
    // dms.t3.micro is no longer orderable in us-east-1. t3.small is the
    // smallest available DMS 3.6.1 class in this region.
    instanceClass: 'dms.t3.small',
    allocatedStorage: 20,
  },
  s3: {
    websiteBucket: 'roomhop-website',
    imagesBucket: 'roomhop-hotel-images',
    analyticsBucket: 'roomhop-analytics-data',
  },
};
