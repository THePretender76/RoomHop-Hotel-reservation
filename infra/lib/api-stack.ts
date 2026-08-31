import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  alb: elbv2.ApplicationLoadBalancer;
  albListener: elbv2.ApplicationListener;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class ApiStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { vpc, alb, albListener, userPool, userPoolClient } = props;

    // ─── VPC Link ───────────────────────────────────────────────────────────────
    // Connects API Gateway HTTP API to the internal ALB inside the VPC.
    const vpcLink = new apigatewayv2.VpcLink(this, 'RoomHopVpcLink', {
      vpc,
      vpcLinkName: `${CONFIG.projectName}-vpc-link`,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // ─── HTTP API ───────────────────────────────────────────────────────────────
    const httpApi = new apigatewayv2.HttpApi(this, 'RoomHopHttpApi', {
      apiName: `${CONFIG.projectName}-api`,
      description: 'RoomHop Hotel Management HTTP API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ─── JWT Authorizer ─────────────────────────────────────────────────────────
    // Validates JWT tokens issued by Cognito before routing to backend.
    const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${CONFIG.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      }
    );

    // ─── ALB Integration ────────────────────────────────────────────────────────
    // All routes forward to the internal ALB via VPC Link; ALB handles path-based routing.
    const albIntegration = new apigatewayv2Integrations.HttpAlbIntegration(
      'AlbIntegration',
      albListener,
      { vpcLink }
    );

    // ─── Routes ─────────────────────────────────────────────────────────────────
    // Search routes (public read, auth optional for personalized results)
    httpApi.addRoutes({
      path: '/v1/search',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: albIntegration,
      // Search is public — no authorizer
    });

    httpApi.addRoutes({
      path: '/v1/search/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: albIntegration,
    });

    // Reservation routes (authenticated)
    httpApi.addRoutes({
      path: '/v1/reservations',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/v1/reservations/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.DELETE, apigatewayv2.HttpMethod.PUT],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    // ─── Admin routes (authenticated — group enforcement is in the backend) ────
    // Partner onboarding application (requires HotelPartnerPending group)
    httpApi.addRoutes({
      path: '/v1/admin/partners/applications',
      methods: [apigatewayv2.HttpMethod.POST, apigatewayv2.HttpMethod.GET],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    // Partner application review (requires SuperAdmin group)
    httpApi.addRoutes({
      path: '/v1/admin/partners/applications/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    // Composite property creation (requires HotelPartner group)
    httpApi.addRoutes({
      path: '/v1/admin/hotels/complete',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    // Hotel management (update, delete, add rooms)
    httpApi.addRoutes({
      path: '/v1/admin/hotels/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE, apigatewayv2.HttpMethod.POST],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    // Room type management
    httpApi.addRoutes({
      path: '/v1/admin/room-types/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT, apigatewayv2.HttpMethod.DELETE],
      integration: albIntegration,
      authorizer: jwtAuthorizer,
    });

    this.apiEndpoint = httpApi.apiEndpoint;

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API endpoint URL',
    });

    new cdk.CfnOutput(this, 'VpcLinkId', {
      value: vpcLink.vpcLinkId,
      description: 'VPC Link ID',
    });
  }
}
