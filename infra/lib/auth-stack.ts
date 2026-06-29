import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── Cognito User Pool ──────────────────────────────────────────────────────
    // Email-based sign-in for hotel guests and admin users.
    this.userPool = new cognito.UserPool(this, 'RoomHopUserPool', {
      userPoolName: `${CONFIG.projectName}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // MFA optional for extra security
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
    });

    // ─── User Pool Groups ───────────────────────────────────────────────────────
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Hotel administrators',
    });

    new cognito.CfnUserPoolGroup(this, 'GuestGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'guest',
      description: 'Hotel guests',
    });

    // ─── User Pool Client ───────────────────────────────────────────────────────
    // SPA client — no secret, uses PKCE for authorization code flow.
    this.userPoolClient = this.userPool.addClient('WebAppClient', {
      userPoolClientName: `${CONFIG.projectName}-web-client`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ['https://localhost:3000/callback'],
        logoutUrls: ['https://localhost:3000/'],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'UserPoolIssuerUrl', {
      value: `https://cognito-idp.${CONFIG.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'Cognito issuer URL for JWT verification',
    });
  }
}
