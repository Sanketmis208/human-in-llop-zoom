// Zoom user OAuth flow helpers.
// Used by oauth-routes.js to redirect users through Zoom's authorization page
// and exchange the resulting auth code for access tokens.

// Override via ZOOM_OAUTH_BASE_URL for Zoom for Government (https://zoomgov.com)
// or other non-default Zoom OAuth hosts. No trailing slash.
const ZOOM_OAUTH_BASE_URL = (process.env.ZOOM_OAUTH_BASE_URL || 'https://zoom.us').replace(/\/$/, '');

/**
 * Build the Zoom OAuth authorization URL to redirect users to for login.
 * @param {{ clientId: string, redirectUri: string, state: string }}
 * @returns {string}
 */
export function buildOAuthAuthorizationUrl({ clientId, redirectUri, state }) {
  if (!clientId) throw new Error('Missing Zoom client ID');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri || process.env.ZOOM_REDIRECT_URI,
    state,
  });

  return `${ZOOM_OAUTH_BASE_URL}/oauth/authorize?${params.toString()}`;
}

/**
 * Build an HTTP Basic authentication header from client credentials.
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {string} e.g. "Basic abc123..."
 */
function buildBasicAuthHeader(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error('Missing Zoom client credentials');
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

/**
 * Exchange an OAuth authorization code for access and refresh tokens.
 * @param {{ code: string, redirectUri: string, clientId: string, clientSecret: string }}
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
export async function exchangeCodeForAccessToken({ code, redirectUri, clientId, clientSecret }) {
  if (!code || !redirectUri) throw new Error('Missing code or redirectUri');

  const response = await fetch(`${ZOOM_OAUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error_description || error.error || response.statusText}`);
  }

  return response.json();
}

/**
 * Exchange an authorization code received via the Zoom Apps SDK in-client
 * OAuth flow (zoomSdk.authorize → onAuthorized) for access and refresh tokens.
 *
 * Unlike the browser flow, there's no redirect — the SDK delivers the code
 * directly to the page. The token endpoint still expects the registered
 * `redirect_uri` to match what was configured on the app, plus the PKCE
 * `code_verifier` matching the challenge passed to zoomSdk.authorize().
 *
 * Only PKCE method `plain` is supported by Zoom (per the in-client OAuth
 * docs), so the verifier and challenge are the same string.
 *
 * @param {{
 *   code: string,
 *   codeVerifier: string,
 *   clientId: string,
 *   clientSecret: string,
 *   redirectUri: string,
 * }}
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number, scope?: string }>}
 */
export async function exchangeCodeForAccessTokenWithPkce({ code, codeVerifier, clientId, clientSecret, redirectUri }) {
  if (!code)         throw new Error('Missing code');
  if (!codeVerifier) throw new Error('Missing code_verifier');

  const params = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    code_verifier: codeVerifier,
  });
  if (redirectUri) params.set('redirect_uri', redirectUri);

  const response = await fetch(`${ZOOM_OAUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`PKCE token exchange failed: ${error.error_description || error.error || response.statusText}`);
  }

  return response.json();
}
