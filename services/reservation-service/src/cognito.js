'use strict';

const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const logger = require('./logger');

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

async function setPartnerAccess(username, status) {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    logger.warn('COGNITO_USER_POOL_ID is not configured; partner groups were not updated');
    return;
  }
  if (!username) throw new Error('Cognito username is required');

  const normalizedStatus = String(status).toUpperCase();
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(normalizedStatus)) {
    throw new Error(`Unsupported partner status: ${status}`);
  }

  if (normalizedStatus === 'PENDING') {
    await client.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: 'HotelPartnerPending',
    }));
    await client.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: 'HotelPartner',
    }));
  } else if (normalizedStatus === 'APPROVED') {
    await client.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: 'HotelPartner',
    }));
    await client.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: 'HotelPartnerPending',
    }));
  } else {
    await client.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: 'HotelPartner',
    }));
    await client.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: 'HotelPartnerPending',
    }));
  }

  await client.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: userPoolId,
    Username: username,
    UserAttributes: [{
      Name: 'custom:partner_status',
      Value: normalizedStatus.toLowerCase(),
    }],
  }));
}

module.exports = { setPartnerAccess };
