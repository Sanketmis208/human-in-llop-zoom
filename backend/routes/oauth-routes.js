import express from 'express';
import crypto from 'crypto';
import {
  buildOAuthAuthorizationUrl,
  exchangeCodeForAccessToken,
  exchangeCodeForAccessTokenWithPkce,
} from '../utils/zoom/zoom-oauth.js';
import { logger } from '../utils/logger.js';

const log = logger('oauth');
const router = express.Router();

// GET /auth/status
// Cheap signed-in probe. Not used by the home page anymore (the page does a
// passive cookie-presence check instead), but kept available for ad-hoc
// debugging and future client-side checks.
router.get('/status', (req, res) => {
  const signedIn = !!req.session?.zoomTokens?.access_token;
  res.json({ signedIn });
});

// GET /auth/logout
// Wipe the session so the next visit hits /install with a clean slate. Used
// by the "Sign out" link on the dashboard. The Set-Cookie that
// session.destroy sends out clears the cookie on the browser side too.
//
// Relative redirect on purpose: the browser resolves `/install` against
// whatever host it's currently on (ngrok URL, localhost, custom domain,
// etc.) so we don't have to keep FRONTEND_PUBLIC_URL in sync with the
// current tunnel.
router.get('/logout', (req, res) => {
  const sessionId = req.sessionID;
  req.session.destroy((err) => {
    if (err) {
      log.error('logout: session destroy failed', { sessionId, error: err.message });
      return res.status(500).send('Sign out failed.');
    }
    res.clearCookie('connect.sid');
    log.info('logout: session destroyed', { sessionId });
    res.redirect('/install');
  });
});

// OAuth: start
router.get('/login', (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;

    const url = buildOAuthAuthorizationUrl({
      clientId: process.env.ZOOM_CLIENT_ID,
      redirectUri: process.env.ZOOM_REDIRECT_URI,
      state,
    });

    // Save the session synchronously before the redirect so the OAuth state
    // is durable even when the user click-through to Zoom is faster than the
    // default end-of-response autosave.
    req.session.save((err) => {
      if (err) {
        log.error('session save failed on /login', { error: err.message });
        return res.status(500).send('Session save failed.');
      }
      log.info('redirecting to Zoom OAuth', { sessionId: req.sessionID, state, url });
      return res.redirect(url);
    });
  } catch (e) {
    log.error('login error', { error: e.message });
    return res.status(500).send('OAuth not configured.');
  }
});

// OAuth: callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    log.info('callback received', {
      sessionId:           req.sessionID,
      hasSession:          !!req.session,
      sessionOauthState:   req.session?.oauth_state ?? '(none)',
      urlState:            state,
      cookieHeaderPresent: !!req.headers.cookie,
    });

    if (error) {
      log.warn('authorization error', { error, description: error_description });
      return res.status(400).send(`Authorization error: ${error}`);
    }
    if (!code || !state) return res.status(400).send('Missing code or state.');
    if (state !== req.session.oauth_state) {
      log.warn('state mismatch on /callback', {
        sessionId:         req.sessionID,
        urlState:          state,
        sessionOauthState: req.session?.oauth_state ?? '(none)',
      });
      return res.status(400).send('Invalid state.');
    }
    delete req.session.oauth_state; // one-time use

    const tokens = await exchangeCodeForAccessToken({
      code,
      redirectUri: process.env.ZOOM_REDIRECT_URI,
      clientId: process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
    });

    // Demo: store tokens in session (use DB/secret store in prod)
    req.session.zoomTokens = tokens;

    // OAuth completed → land on the dashboard. The dashboard hosts the
    // "Open Chatbot in Zoom" deep link and the "Sign out" link, so there's
    // no separate /welcome page to bounce through.
    //
    // Explicit req.session.save() before redirecting — express-session's
    // implicit autosave races the redirect response, so the dashboard can
    // otherwise land on a stale session that doesn't see the tokens we
    // just stored.
    //
    // Relative redirect on purpose: the browser resolves `/?auth=success`
    // against whatever host it's currently on. Avoids needing
    // FRONTEND_PUBLIC_URL to be in sync with the current tunnel URL.
    req.session.save((err) => {
      if (err) {
        log.error('session save failed on /callback', { error: err.message });
        return res.status(500).send('Could not persist OAuth session.');
      }
      log.info('OAuth completed; redirecting to dashboard', { sessionId: req.sessionID });
      return res.redirect('/?auth=success');
    });
  } catch (e) {
    log.error('callback error', { error: e.message });
    return res.status(500).send('Token exchange failed.');
  }
});

// ── In-Client OAuth (Zoom Apps SDK authorize / onAuthorized) ──────────────────
// Driven by JavaScript inside the Zoom client. There's no redirect; the SDK
// delivers the auth code to the page, which POSTs it here for the standard
// PKCE token exchange. See docs/in-client-oauth.md and Zoom's developer docs:
// https://developers.zoom.us/docs/zoom-apps/authentication/#in-client-oauth-for-zoom-apps-api

// POST /auth/in-client/start
// If the user is already signed in this session, short-circuit so the UI can
// skip a redundant consent prompt. Otherwise generate state + PKCE verifier,
// stash both in the session, and return the challenge the client should pass
// to zoomSdk.authorize().
router.post('/in-client/start', (req, res) => {
  try {
    if (req.session?.zoomTokens?.access_token) {
      return res.json({ success: true, alreadySignedIn: true });
    }

    if (!process.env.ZOOM_CLIENT_ID || !process.env.ZOOM_CLIENT_SECRET) {
      return res.status(500).json({ success: false, error: 'Zoom OAuth client credentials not configured.' });
    }

    // PKCE method `plain` is the only one Zoom's in-client flow supports, so
    // the challenge sent to the SDK is the same string as the verifier we keep.
    const verifier = crypto.randomBytes(48).toString('base64url');
    const state    = crypto.randomBytes(16).toString('hex');

    req.session.inClientOAuth = { state, verifier, createdAt: Date.now() };

    log.info('in-client OAuth started', { state });
    return res.json({ success: true, state, codeChallenge: verifier, codeChallengeMethod: 'plain' });
  } catch (e) {
    log.error('in-client start error', { error: e.message });
    return res.status(500).json({ success: false, error: 'Could not start in-client OAuth.' });
  }
});

// POST /auth/in-client/callback
// Receives { code, state } from the page after the onAuthorized event fires.
// Validates state, exchanges the code for tokens using the stored verifier,
// and stores tokens in the session (identical shape to the browser flow, so
// downstream code that reads req.session.zoomTokens needs no changes).
router.post('/in-client/callback', async (req, res) => {
  try {
    const { code, state } = req.body ?? {};
    if (!code || !state)  return res.status(400).json({ success: false, error: 'Missing code or state.' });

    const pending = req.session?.inClientOAuth;
    if (!pending)                return res.status(400).json({ success: false, error: 'No in-client OAuth flow in progress. Call /auth/in-client/start first.' });
    if (pending.state !== state) return res.status(400).json({ success: false, error: 'State mismatch.' });
    // Cap the time between start and callback to limit verifier lifetime.
    if (Date.now() - pending.createdAt > 5 * 60_000) {
      delete req.session.inClientOAuth;
      return res.status(400).json({ success: false, error: 'In-client OAuth attempt expired. Try again.' });
    }
    const { verifier } = pending;
    delete req.session.inClientOAuth; // one-time use

    // In-client OAuth doesn't do a browser redirect — the SDK delivers the
    // code directly to the page via onAuthorized. The token request only
    // needs `code_verifier` for the PKCE binding; `redirect_uri` is a
    // web-flow-only requirement, and including it (even matching values from
    // the SDK event) produces invalid_grant.
    const tokens = await exchangeCodeForAccessTokenWithPkce({
      code,
      codeVerifier: verifier,
      clientId:     process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
    });

    req.session.zoomTokens = tokens;

    // Explicit save before responding so a subsequent create-doc retry on
    // the same session doesn't race the autosave and 401 again.
    req.session.save((err) => {
      if (err) {
        log.error('session save failed on in-client callback', { error: err.message });
        return res.status(500).json({ success: false, error: 'Could not persist OAuth session.' });
      }
      log.info('in-client OAuth completed', { scope: tokens.scope });
      return res.json({ success: true });
    });
  } catch (e) {
    log.error('in-client callback error', { error: e.message });
    const safeError = process.env.NODE_ENV === 'production'
      ? 'In-client token exchange failed.'
      : (e.message || 'In-client token exchange failed.');
    return res.status(500).json({ success: false, error: safeError });
  }
});

export default router;