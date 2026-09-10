import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import * as path from 'path';
import { CONFIG } from './config';

export interface FrontendStackProps extends cdk.StackProps {
  alb: elbv2.ApplicationLoadBalancer;
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
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['content-type'],
        maxAge: 300,
      }],
    });

    // Keep the production image bucket aligned with the original MinIO assets.
    // The /images/* CloudFront behavior forwards the complete path to S3.
    new s3deploy.BucketDeployment(this, 'HotelImagesDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../assets/hotel-images'))],
      destinationBucket: this.imagesBucket,
      destinationKeyPrefix: 'images',
      prune: false,
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
    if (this.node.tryGetContext('retainLegacyIngress') === 'true') {
      this.exportValue(webAcl.attrArn);
    }

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

    const applicationOrigin = origins.VpcOrigin.withApplicationLoadBalancer(props.alb, {
      httpPort: 80,
      httpsPort: 443,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: cdk.Duration.seconds(60),
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: applicationOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // All viewer headers except Host, including Authorization, Content-Type,
      // CORS and idempotency headers, plus all query strings and cookies.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };
    const analyticsRedirect = new cloudfront.Function(this, 'AnalyticsRedirectFunction', {
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var query = event.request.querystring || {};
  var parts = [];
  Object.keys(query).forEach(function (name) {
    (query[name].multiValue || [query[name]]).forEach(function (item) {
      parts.push(name + '=' + item.value);
    });
  });
  return { statusCode: 308, statusDescription: 'Permanent Redirect',
    headers: { location: { value: '/analytics/' + (parts.length ? '?' + parts.join('&') : '') } } };
}`),
    });
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
        'v1/*': apiBehavior,
        'analytics/*': apiBehavior,
        'analytics': {
          ...apiBehavior,
          functionAssociations: [{
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: analyticsRedirect,
          }],
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
