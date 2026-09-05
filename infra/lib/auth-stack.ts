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
      customAttributes: {
        partner_status: new cognito.StringAttribute({
          mutable: true,
          minLen: 4,
          maxLen: 20,
        }),
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // MFA optional for extra security
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
    });

    // ─── User Pool Groups ───────────────────────────────────────────────────────
    new cognito.CfnUserPoolGroup(this, 'PartnerPendingGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'HotelPartnerPending',
      description: 'Authenticated users whose hotel partner application is under review',
    });

    new cognito.CfnUserPoolGroup(this, 'PartnerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'HotelPartner',
      description: 'Approved hotel property owners',
    });

    new cognito.CfnUserPoolGroup(this, 'SuperAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'SuperAdmin',
      description: 'RoomHop staff who review hotel partner applications',
    });

    new cognito.CfnUserPoolGroup(this, 'GuestGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Guest',
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
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, givenName: true, familyName: true, phoneNumber: true })
        .withCustomAttributes('partner_status'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, givenName: true, familyName: true, phoneNumber: true }),
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
