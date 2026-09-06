'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { annotate, markSpanError, withSpan } = require('../tracing');

let cognitoVerifier;

function defaultVerifier() {
  if (cognitoVerifier) return cognitoVerifier;

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error('COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be configured');
  }

  cognitoVerifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'id',
  });
  return cognitoVerifier;
}

function groupsFrom(payload) {
  const groups = payload?.['cognito:groups'] || payload?.groups || [];
  if (Array.isArray(groups)) return groups;
  if (typeof groups === 'string') {
    return groups.split(',').map((group) => group.trim()).filter(Boolean);
  }
  return [];
}

function createAuthenticator(verifierProvider = defaultVerifier) {
  return async function authenticateRequest(req, res, next) {
    const outcome = await withSpan('auth.verify', { autoStatus: false }, async (span) => {
      const authorization = req.get('authorization') || '';
      const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
      if (!match) {
        annotate(span, { auth_valid: false, error_type: 'auth_missing' });
        markSpanError(span, 'auth_missing');
        return { status: 401, error: 'Authentication required' };
      }

      try {
        const payload = await verifierProvider().verify(match[1]);

        const user = {
          sub: payload.sub,
          username: payload['cognito:username'] || payload.username || payload.sub,
          email: payload.email,
          groups: groupsFrom(payload),
        };
        annotate(span, { auth_valid: true });
        return { user };
      } catch {
        annotate(span, { auth_valid: false, error_type: 'auth_invalid' });
        markSpanError(span, 'auth_invalid');
        return { status: 401, error: 'Invalid authentication token' };
      }
    });

    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    req.user = outcome.user;
    return next();
  };
}

const authenticate = createAuthenticator();

function requireGroup(groupName) {
  return (req, res, next) => {
    const authorized = withSpan('auth.authorize', { autoStatus: false }, (span) => {
      if (!req.user?.groups?.includes(groupName)) {
        markSpanError(span, 'authorization_denied');
        return false;
      }
      return true;
    });
    if (!authorized) return res.status(403).json({ error: 'Insufficient permissions' });
    return next();
  };
}

module.exports = { authenticate, createAuthenticator, groupsFrom, requireGroup };
