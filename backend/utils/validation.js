/**
 * Validation utilities for Zoom Team Chat webhook payloads and API requests
 */

import crypto from 'crypto';

// Replay-window for webhook timestamps (seconds). Zoom signs each request with
// a unix timestamp; we reject anything older than this to mitigate replays.
const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

/**
 * Collect the configured webhook secrets in preference order. A single endpoint
 * accepts events from both Team Chat (signed with ZOOM_VERIFICATION_TOKEN) and
 * RTMS (signed with ZOOM_WEBHOOK_SECRET_TOKEN) subscriptions even when the two
 * tokens differ — we try each in order until one matches.
 */
function getConfiguredSecrets() {
  return [process.env.ZOOM_WEBHOOK_SECRET_TOKEN, process.env.ZOOM_VERIFICATION_TOKEN].filter(Boolean);
}

/**
 * Verify a Zoom webhook signature.
 *
 * HMACs over the RAW request body bytes (req.rawBody, set by the express.json
 * verify callback in server.js). This matches how Zoom actually computes the
 * signature — re-serializing the parsed body via JSON.stringify can produce
 * different bytes and fail verification intermittently.
 *
 * Includes:
 *   - 5-minute replay-window check
 *   - constant-time signature comparison
 *   - multi-secret support so one endpoint can serve Team Chat + RTMS
 *
 * @param   {Object} req - Express request (req.rawBody, headers, body)
 * @returns {string} The secret that matched. Pass to buildUrlValidationResponse()
 *                   so the handshake reply uses the same secret Zoom signed with.
 * @throws  {Error}  If headers are missing, the timestamp is too old, or no
 *                   secret produces a matching signature.
 */
export function verifyZoomWebhookSignature(req) {
  const signature = req.headers['x-zm-signature'];
  const timestamp = req.headers['x-zm-request-timestamp'];

  if (!signature || !timestamp) {
    throw new Error('Missing signature headers');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > WEBHOOK_REPLAY_WINDOW_SECONDS) {
    throw new Error('Webhook timestamp too old — possible replay attack');
  }

  const secrets = getConfiguredSecrets();
  if (secrets.length === 0) {
    throw new Error('No webhook secret configured (set ZOOM_WEBHOOK_SECRET_TOKEN or ZOOM_VERIFICATION_TOKEN)');
  }

  const rawBody     = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
  const messageBody = rawBody.toString('utf8');
  const signedMessage = `v0:${timestamp}:${messageBody}`;
  const sigBuf = Buffer.from(signature);

  for (const secret of secrets) {
    const expected = 'v0=' + crypto.createHmac('sha256', secret).update(signedMessage).digest('hex');
    const expBuf = Buffer.from(expected);
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      return secret;
    }
  }
  throw new Error('Invalid webhook signature');
}

/**
 * Build the URL-validation handshake response Zoom expects when you first
 * register a webhook endpoint in Marketplace. Echoes back plainToken plus its
 * HMAC-SHA256 (encryptedToken) using the same secret that signed the request.
 *
 * @param {string} plainToken - From the validation request payload
 * @param {string} [secret]   - Secret returned by verifyZoomWebhookSignature().
 *                              Falls back to env precedence if omitted (rare —
 *                              shouldn't happen if signature verification runs
 *                              first as it always should).
 */
export function buildUrlValidationResponse(plainToken, secret) {
  const effective = secret
    ?? process.env.ZOOM_WEBHOOK_SECRET_TOKEN
    ?? process.env.ZOOM_VERIFICATION_TOKEN
    ?? '';
  const encryptedToken = crypto.createHmac('sha256', effective).update(plainToken ?? '').digest('hex');
  return { plainToken: plainToken ?? '', encryptedToken };
}

/**
 * Validate Zoom webhook payload structure
 * @param {Object} payload - Webhook payload
 * @returns {Object} Validation result
 */
export function validateWebhookPayload(payload) {
  const errors = [];

  if (!payload) {
    return { isValid: false, errors: ['Payload is required'] };
  }

  if (!payload.event) {
    errors.push('Event type is required');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate message request payload
 * @param {Object} payload - Message request payload
 * @returns {Object} Validation result
 */
export function validateMessagePayload(payload) {
  const errors = [];

  if (!payload) {
    return { isValid: false, errors: ['Payload is required'] };
  }

  if (!payload.to_jid || typeof payload.to_jid !== 'string') {
    errors.push('to_jid is required and must be a string');
  }

  if (!payload.message || typeof payload.message !== 'string') {
    errors.push('message is required and must be a string');
  }

  if (payload.message && payload.message.length > 4096) {
    errors.push('message must be 4096 characters or less');
  }

  if (payload.reply_to && typeof payload.reply_to !== 'string') {
    errors.push('reply_to must be a string if provided');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate required environment variables
 * @returns {Object} Validation result
 */
export function validateEnvironmentVariables() {
  const required = [
    'ZOOM_CLIENT_ID',
    'ZOOM_CLIENT_SECRET',
    'ZOOM_BOT_JID',
    'ZOOM_VERIFICATION_TOKEN',
    'ANTHROPIC_API_KEY'
  ];

  const missing = required.filter(variable => !process.env[variable]);

  return {
    isValid: missing.length === 0,
    missing,
    errors: missing.map(variable => `Missing required environment variable: ${variable}`)
  };
}

/**
 * Sanitize message content to prevent potential issues
 * @param {string} message - Message content
 * @returns {string} Sanitized message
 */
export function sanitizeMessage(message) {
  if (typeof message !== 'string') {
    return '';
  }

  // Basic sanitization - remove/escape potentially problematic characters
  return message
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, 4096); // Ensure message length limit
}

/**
 * Create validation middleware for Express routes
 * @param {Function} validator - Validation function
 * @returns {Function} Express middleware
 */
export function createValidationMiddleware(validator) {
  return (req, res, next) => {
    const validation = validator(req.body);
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors
      });
    }

    next();
  };
}