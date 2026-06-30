import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export interface FrontendStackProps extends cdk.StackProps {
  apiEndpoint: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly cloudFrontUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { apiEndpoint } = props;

    // ─── S3 Buckets ─────────────────────────────────────────────────────────────
    // Static website bucket (React build output)
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `${CONFIG.s3.websiteBucket}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Hotel images bucket (unused in iteration 1 — images go to website bucket /images/ path)
    const imagesBucket = new s3.Bucket(this, 'ImagesBucket', {
      bucketName: `${CONFIG.s3.imagesBucket}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // ─── WAFv2 WebACL ───────────────────────────────────────────────────────────
    // Attached to CloudFront — provides rate limiting, SQL injection, and XSS protection.
    // WAF for CloudFront MUST be in us-east-1, but CDK handles this via CfnWebACL scope.
    const webAcl = new wafv2.CfnWebACL(this, 'CloudFrontWaf', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${CONFIG.projectName}-waf-metrics`,
        sampledRequestsEnabled: true,
      },
      name: `${CONFIG.projectName}-cloudfront-waf`,
      rules: [
        // Rate limiting — max 2000 requests per 5 minutes per IP
        {
          name: 'RateLimitRule',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rule — SQL Injection protection
        {
          name: 'AWSManagedRulesSQLi',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'SQLiRule',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rule — XSS protection
        {
          name: 'AWSManagedRulesXSS',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'XSSRule',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rule — Common Rule Set (includes XSS, path traversal, etc.)
        {
          name: 'AWSManagedRulesCommon',
          priority: 4,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // ─── CloudFront Distribution ────────────────────────────────────────────────
    // OAC for secure S3 access (replaces deprecated OAI).
    const distribution = new cloudfront.Distribution(this, 'RoomHopDistribution', {
      comment: 'RoomHop Hotel Management CDN',
      defaultRootObject: 'index.html',
      webAclId: webAcl.attrArn,
      // Default behavior — S3 static website
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      additionalBehaviors: {
        // API proxy to API Gateway
        '/api/*': {
          origin: new cloudfrontOrigins.HttpOrigin(
            // Extract domain from API endpoint (https://xxxxx.execute-api.region.amazonaws.com)
            cdk.Fn.select(2, cdk.Fn.split('/', apiEndpoint)),
            {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
              originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
            }
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      // SPA fallback — route all 404s to index.html for client-side routing
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    this.cloudFrontUrl = `https://${distribution.distributionDomainName}`;

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.cloudFrontUrl,
      description: 'CloudFront distribution URL',
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket for React build',
    });

    new cdk.CfnOutput(this, 'ImagesBucketName', {
      value: imagesBucket.bucketName,
      description: 'S3 bucket for hotel images',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });
  }
}
