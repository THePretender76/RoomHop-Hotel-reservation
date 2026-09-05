import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export interface FrontendStackProps extends cdk.StackProps {
  apiEndpoint: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly websiteBucket: s3.Bucket;
  public readonly imagesBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly cloudFrontUrl: string;
  public readonly wafAclArn: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `${CONFIG.s3.websiteBucket}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.imagesBucket = new s3.Bucket(this, 'ImagesBucket', {
      bucketName: `${CONFIG.s3.imagesBucket}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const webAcl = new wafv2.CfnWebACL(this, 'CloudFrontWaf', {
      name: `${CONFIG.projectName}-cloudfront-waf`,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${CONFIG.projectName}-waf`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${CONFIG.projectName}-rate-limit`,
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AwsCommonRules',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${CONFIG.projectName}-common-rules`,
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AwsSqlInjectionRules',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${CONFIG.projectName}-sqli-rules`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    this.wafAclArn = webAcl.attrArn;

    const spaRewrite = new cloudfront.Function(this, 'SpaRewriteFunction', {
      functionName: `${CONFIG.projectName}-spa-rewrite`,
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`),
    });

    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', props.apiEndpoint));
    this.distribution = new cloudfront.Distribution(this, 'RoomHopDistribution', {
      comment: 'RoomHop web application, API and hotel-image CDN',
      defaultRootObject: 'index.html',
      webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: spaRewrite,
        }],
      },
      additionalBehaviors: {
        'v1/*': {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        'images/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.imagesBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    this.cloudFrontUrl = `https://${this.distribution.distributionDomainName}`;
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: this.cloudFrontUrl });
    new cdk.CfnOutput(this, 'WebsiteBucketName', { value: this.websiteBucket.bucketName });
    new cdk.CfnOutput(this, 'ImagesBucketName', { value: this.imagesBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }
}
