/**
 * @fileoverview Authentication Router
 * @description Provides login, logout, and role status endpoints.
 */

const express = require('express');
const { generateToken, getRequestRole } = require('./authMiddleware');

/**
 * Create authentication routes
 * @param {Object} options
 * @param {Object} options.authConfig
 * @returns {express.Router}
 */
function createAuthRoutes({ authConfig }) {
  const router = express.Router();

  /**
   * Get current auth status and effective role
   * GET /api/auth/status
   */
  router.get('/status', (req, res) => {
    const role = getRequestRole(req, authConfig);
    res.json({
      authEnabled: Boolean(authConfig && authConfig.enabled),
      role,
      requireListenerPassword: Boolean(authConfig && authConfig.enabled && authConfig.listenerPassword),
    });
  });

  /**
   * Login with password
   * POST /api/auth/login
   */
  router.post('/login', (req, res) => {
    if (!authConfig || !authConfig.enabled) {
      return res.json({
        role: 'operator',
        token: generateToken('operator', authConfig ? authConfig.secret : 'default-secret'),
        message: 'Authentication is not enabled; operator privileges granted',
      });
    }

    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Check Operator password
    if (authConfig.operatorPassword && password === authConfig.operatorPassword) {
      const token = generateToken('operator', authConfig.secret);
      return res.json({
        role: 'operator',
        token,
        message: 'Operator login successful',
      });
    }

    // Check Listener password
    if (authConfig.listenerPassword && password === authConfig.listenerPassword) {
      const token = generateToken('listener', authConfig.secret);
      return res.json({
        role: 'listener',
        token,
        message: 'Listener login successful',
      });
    }

    return res.status(401).json({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
  });

  /**
   * Logout
   * POST /api/auth/logout
   */
  router.post('/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
  });

  return router;
}

module.exports = createAuthRoutes;
