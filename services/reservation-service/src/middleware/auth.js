'use strict';

/**
 * API Gateway is the cryptographic JWT verifier for this private ALB service.
 * This middleware validates the already-verified claims needed for ownership
 * and group authorization. The ALB security group only accepts the VPC Link.
 */
function decodeJwtPayload(token) {
  const segments = String(token || '').split('.');
  if (segments.length !== 3) {
    throw new Error('Malformed JWT');
  }

  return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
}

function groupsFrom(payload) {
  const groups = payload?.['cognito:groups'] || payload?.groups || [];
  if (Array.isArray(groups)) return groups;
  if (typeof groups === 'string') {
    return groups.split(',').map((group) => group.trim()).filter(Boolean);
  }
  return [];
}

function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = decodeJwtPayload(match[1]);
    const now = Math.floor(Date.now() / 1000);
    const expectedIssuer = process.env.COGNITO_USER_POOL_ID
      ? `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
      : null;

    if (!payload.sub || (payload.exp && payload.exp <= now)) {
      throw new Error('Expired or incomplete JWT');
    }
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      throw new Error('Unexpected token issuer');
    }
    if (process.env.COGNITO_CLIENT_ID && payload.aud !== process.env.COGNITO_CLIENT_ID) {
      throw new Error('Unexpected token audience');
    }

    req.user = {
      sub: payload.sub,
      username: payload['cognito:username'] || payload.username || payload.sub,
      email: payload.email,
      groups: groupsFrom(payload),
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
}

function requireGroup(groupName) {
  return (req, res, next) => {
    if (!req.user?.groups?.includes(groupName)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = { authenticate, requireGroup, decodeJwtPayload, groupsFrom };
