// Server-to-Server OAuth: fetches a bot access token using client credentials.
// This token is used by the bot to send messages on behalf of the Zoom app —
// no user interaction required.

// Override via ZOOM_OAUTH_BASE_URL for Zoom for Government (https://zoomgov.com)
// or other non-default Zoom OAuth hosts.
const ZOOM_OAUTH_BASE_URL = (process.env.ZOOM_OAUTH_BASE_URL || 'https://zoom.us').replace(/\/$/, '');

/**
 * Get a Zoom bot access token using the Server-to-Server (client credentials) OAuth flow.
 * @returns {Promise<string>} Access token
 */
export async function getChatbotToken() {
  const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

  if (!ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Missing required environment variables: ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET');
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(`${ZOOM_OAUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to get Zoom bot token: ${error.error_description || error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log('Successfully received chatbot token from Zoom.');
  return data.access_token;
}
