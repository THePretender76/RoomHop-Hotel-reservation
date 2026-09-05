const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const region = process.env.AWS_REGION || 'us-east-1';
const userPoolId = process.env.COGNITO_USER_POOL_ID || '';
const authSkipVerify = process.env.AUTH_SKIP_VERIFY === 'true';

const client = userPoolId
  ? jwksClient({
      jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
    })
  : null;

function getSigningKey(header, callback) {
  if (!client) {
    return callback(new Error('No JWKS client configured'));
  }

  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }

    callback(null, key.getPublicKey());
  });
}

function getGroupsFromPayload(payload) {
  const rawGroups = payload['cognito:groups'] || payload.groups;
  if (Array.isArray(rawGroups)) {
    return rawGroups;
  }
  if (typeof rawGroups === 'string') {
    return rawGroups.split(',').map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = match[1];

  if (authSkipVerify) {
    try {
      const payload = jwt.decode(token, { complete: false }) || {};
      req.user = {
        sub: payload.sub,
        username: payload['cognito:username'] || payload.username || payload.sub,
        email: payload.email,
        groups: getGroupsFromPayload(payload),
      };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const verifyOptions = {
    algorithms: ['RS256'],
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
  };
  if (process.env.COGNITO_CLIENT_ID) {
    verifyOptions.audience = process.env.COGNITO_CLIENT_ID;
  }

  jwt.verify(token, getSigningKey, verifyOptions, (error, payload) => {
    if (error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = {
      sub: payload.sub,
      username: payload['cognito:username'] || payload.username || payload.sub,
      email: payload.email,
      groups: getGroupsFromPayload(payload),
    };
    return next();
  });
}

function requireGroup(groupName) {
  return (req, res, next) => {
    if (!req.user || !req.user.groups || !req.user.groups.includes(groupName)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { authenticate, requireGroup };
