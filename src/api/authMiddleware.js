/**
 * @fileoverview Authentication and Role-based Access Control (RBAC) Module
 * @description Provides lightweight HMAC-SHA256 signed token generation, verification,
 * and middleware for separating 'listener' (view/stream only) and 'operator' (control/edit) privileges.
 */

const crypto = require('crypto');

/**
 * Encode buffer/string to Base64URL
 * @param {Buffer|string} input
 * @returns {string}
 */
function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Decode Base64URL to Buffer
 * @param {string} input
 * @returns {Buffer}
 */
function base64UrlDecode(input) {
  let str = input.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) {
    str += '=';
  }
  return Buffer.from(str, 'base64');
}

/**
 * Generate HMAC-SHA256 signature
 * @param {string} data
 * @param {string} secret
 * @returns {string}
 */
function sign(data, secret) {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(data).digest());
}

/**
 * Generate signed access token
 * @param {string} role - 'operator' | 'listener'
 * @param {string} secret - Token secret
 * @param {number} [expiresInDays=30] - Token expiration in days
 * @returns {string}
 */
function generateToken(role, secret, expiresInDays = 30) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    role,
    exp: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(data, secret);

  return `${data}.${signature}`;
}

/**
 * Verify and decode access token
 * @param {string} token
 * @param {string} secret
 * @returns {Object|null} Payload or null if invalid/expired
 */
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = sign(data, secret);

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract token from HTTP request header or query
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractTokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token).trim();
  }
  return null;
}

/**
 * Determine caller role for the request
 * @param {import('express').Request} req
 * @param {Object} authConfig
 * @returns {string} 'operator' | 'listener' | 'anonymous'
 */
function getRequestRole(req, authConfig) {
  // If auth is globally disabled, grant full operator privileges
  if (!authConfig || !authConfig.enabled) {
    return 'operator';
  }

  const token = extractTokenFromRequest(req);
  if (token) {
    const payload = verifyToken(token, authConfig.secret);
    if (payload && payload.role) {
      return payload.role;
    }
  }

  // If no listener password is set, default to listener role
  if (!authConfig.listenerPassword || authConfig.listenerPassword.trim() === '') {
    return 'listener';
  }

  return 'anonymous';
}

/**
 * Middleware: Require Operator privileges
 * @param {Object} authConfig
 * @returns {import('express').RequestHandler}
 */
function requireOperator(authConfig) {
  return (req, res, next) => {
    const role = getRequestRole(req, authConfig);
    req.userRole = role;

    if (role === 'operator') {
      return next();
    }

    return res.status(403).json({
      error: 'Operator privileges required to perform this action',
      code: 'FORBIDDEN_OPERATOR_REQUIRED',
    });
  };
}

/**
 * Middleware: Require Listener or higher privileges
 * @param {Object} authConfig
 * @returns {import('express').RequestHandler}
 */
function requireListener(authConfig) {
  return (req, res, next) => {
    const role = getRequestRole(req, authConfig);
    req.userRole = role;

    if (role === 'operator' || role === 'listener') {
      return next();
    }

    return res.status(401).json({
      error: 'Authentication required to access scanner audio/data',
      code: 'UNAUTHORIZED',
    });
  };
}

module.exports = {
  generateToken,
  verifyToken,
  getRequestRole,
  requireOperator,
  requireListener,
  extractTokenFromRequest,
};
