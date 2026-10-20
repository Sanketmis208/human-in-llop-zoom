import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import oauthRoutes from './routes/oauth-routes.js';
import onboardingRoutes from './routes/onboarding-routes.js';
import webhookRoutes from './routes/webhook-routes.js';
import messageRoutes from './routes/message-routes.js';
import signRoutes from './routes/signature-routes.js';
import rtmsRoutes from './routes/rtms-routes.js';
import taskRoutes from './routes/task-routes.js';
import apiRoutes from './routes/api/index.js';

import { validateEnvironmentVariables } from './utils/validation.js';
import { initWebSocketServer } from './utils/rtms/websocket-service.js';
import { logger } from './utils/logger.js';

const log     = logger('server');
const httpLog = logger('http');

// Load environment variables. The shared .env lives at the repo root
// (../.env from backend/) so the same file feeds both the Express backend
// and the Next.js frontend (frontend/next.config.mjs loads the same path).
// `override: true` makes .env values win over any pre-existing shell exports
// — so a stale OPENAI_API_KEY in ~/.zshrc can't shadow the current value
// the user just wrote into .env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });

// Validate required environment variables on startup
const envValidation = validateEnvironmentVariables();
if (!envValidation.isValid) {
  log.error('environment validation failed', { errors: envValidation.errors });
  process.exit(1);
}

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// Save the raw request body on req.rawBody so RTMS webhook signature
// verification can compute the HMAC over the exact bytes Zoom sent.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://appssdk.zoom.us",
        "https://source.zoom.us",
        "https://cdn.ngrok.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.ngrok.com"],
      imgSrc:   ["'self'", "data:", "blob:"],
      connectSrc: [
        // ws: covers local dev (non-TLS); wss: covers ngrok / production.
        "'self'", "ws:", "wss:",
        "https://zoom.us", "https://*.zoom.us",
        "https://*.ngrok.app", "https://*.ngrok.io"
      ],
      frameAncestors: ["'self'", "https://*.zoom.us"],
    },
  },
}));

// HTTP access log middleware. Kept simple: every request gets one line at info
// level via the shared logger so the [http] scope sorts alongside everything
// else (rtms, api, webhook, …) when you grep.
app.use((req, _res, next) => {
  httpLog.info(`${req.method} ${req.path}`);
  next();
});

// Trust the ngrok/Next.js front door so Express correctly treats requests as
// HTTPS-originated (otherwise req.secure is always false and any future
// Secure-cookie config would silently no-op).
app.set('trust proxy', 1);

// Sessions (for CSRF state).
//
// saveUninitialized: false — don't persist empty sessions. The SSR-side
// /auth/status fetch from the Next.js home page used to create a new
// MemoryStore entry on every cold visit, and the cookie Next.js
// propagated back to the browser fought with the cookies set by the
// real proxied requests (/install, /auth/login, /auth/callback). Disabling
// uninitialized saves means a session only exists once we actually write
// to it — typically the first /auth/login click.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,        // ngrok terminates TLS; Express sees HTTP behind the proxy
    sameSite: 'lax',      // explicit so we don't drift if browsers tighten defaults
    httpOnly: true,
  },
}));

// The Next.js app at FRONTEND_PUBLIC_URL is now the user-facing UI. Express
// only serves the API, webhooks, OAuth, and signing endpoints — no HTML.
const FRONTEND_PUBLIC_URL = process.env.FRONTEND_PUBLIC_URL || 'http://localhost:3000';

// Routes
app.use('/api', messageRoutes);
app.use('/api', apiRoutes);                // AI task workflow API (Next.js frontend)
app.use('/api/rtms', rtmsRoutes);
app.use('/api/meeting-tasks', taskRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/auth', oauthRoutes);
app.use('/', onboardingRoutes);             // /install + /welcome (external-browser onboarding)
app.use('/apps', signRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'zoom-team-chatbot',
    version: '1.0.0',
    frontend: FRONTEND_PUBLIC_URL,
  });
});

// Error handling middleware
app.use((error, _req, res, _next) => {
  log.error('unhandled error', { error: error.message, stack: error.stack });
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// Public, non-sensitive client config
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');

  const config = {
    ZOOM_BOT_JID: process.env.ZOOM_BOT_JID || '',
  };

  res.send(`window.APP_CONFIG = ${JSON.stringify(config)};`);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

const port = process.env.PORT || 4000;

// Capture the HTTP server returned by app.listen so we can attach
// the WebSocket server to the same port without opening a second port.
const server = app.listen(port, () => {
  log.info('listening', {
    port,
    health:   `http://localhost:${port}/health`,
    webhook:  `http://localhost:${port}/webhooks`,
    ws:       `ws://localhost:${port}/ws`,
    frontend: process.env.FRONTEND_PUBLIC_URL || 'http://localhost:3000',
  });
});

// Attach WebSocket server on the same HTTP server at path /ws
initWebSocketServer(server);
