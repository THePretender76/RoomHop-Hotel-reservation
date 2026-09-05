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
  opensearch: {
    domainName: 'roomhop-search',
    instanceType: 't3.small.search',
    instanceCount: 1,
  },
  dms: {
    instanceClass: 'dms.t3.micro',
    allocatedStorage: 20,
  },
  s3: {
    websiteBucket: 'roomhop-website',
    imagesBucket: 'roomhop-hotel-images',
    analyticsBucket: 'roomhop-analytics-data',
  },
};
