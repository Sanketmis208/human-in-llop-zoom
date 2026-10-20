/**
 * External-browser onboarding page.
 *
 *   GET /install — landing page for unauthenticated browsers. One button
 *                  that kicks off the standard /auth/login flow.
 *
 * Once the user completes OAuth, the callback redirects them to the
 * Next.js dashboard at `/`. The deep-link-to-chatbot button and sign-out
 * action live on the dashboard itself — no separate /welcome page.
 *
 * Rendered from a template literal — no template engine. If this page
 * grows, the right move is to migrate it to the Next.js app, not to
 * introduce EJS/Pug here.
 */

import express from 'express';
import { logger } from '../utils/logger.js';

const log    = logger('onboarding');
const router = express.Router();

// ── GET /install ────────────────────────────────────────────────────────────
router.get('/install', (req, res) => {
  const signedIn = !!req.session?.zoomTokens?.access_token;
  log.info('install rendered', { sessionId: req.sessionID, signedIn });
  // If the user already has a session, skip the install page and send them
  // straight to the dashboard. Relative redirect so the browser stays on
  // the host it came in on (ngrok, localhost, custom domain, etc.).
  if (signedIn) {
    return res.redirect('/');
  }
  res.type('html').send(renderInstallPage());
});

// ── HTML templates ──────────────────────────────────────────────────────────

function renderInstallPage() {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zoom Workplace Agent — Install</title>
  <style>${PAGE_STYLES}</style>
</head>
<body>
  <main class="card">
    <h1>Zoom Workplace Agent</h1>
    <p class="lede">
      This sample app uses Zoom RTMS, OpenAI, the Zoom Apps SDK, Team Chat, and
      Zoom MCP to turn meeting context into approved tasks and follow-up docs.
    </p>
    <p>Connect your Zoom account to get started. You'll be redirected to Zoom to authorize the app.</p>
    <a class="primary" href="/auth/login">Authorize and Install</a>
    <p class="muted">After authorization you'll land on the dashboard, where you can open the chatbot in Zoom or sign out.</p>
  </main>
</body>
</html>`;
}

// Styles — kept inline so the page is self-contained and there's no
// extra static-asset plumbing to maintain.
const PAGE_STYLES = `
  *,*::before,*::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: linear-gradient(135deg, #315cff, #1d3fc2);
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #1a2233; padding: 2rem; }
  .card { background: #fff; max-width: 520px; width: 100%;
          padding: 2.5rem; border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.18); text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 0.75rem; color: #0e1c47; }
  .lede { font-size: 1rem; color: #475066; margin: 0 0 1.5rem; }
  p { margin: 0 0 1rem; color: #475066; }
  .primary { display: inline-block; background: #315cff; color: #fff;
             padding: 14px 28px; border-radius: 8px; text-decoration: none;
             font-weight: 600; font-size: 1rem; margin: 0.5rem 0 1rem;
             transition: transform 0.15s, box-shadow 0.15s; }
  .primary:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(49,92,255,0.35); }
  .muted { color: #8189a0; font-size: 0.85rem; margin-top: 1.25rem; }
`;

export default router;
