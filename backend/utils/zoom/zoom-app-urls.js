/**
 * Public URLs Zoom needs to reach this app — derived from env so the same
 * code works in local dev (localhost) and behind a tunnel (ngrok / staging).
 *
 * Lives in utils/zoom/ rather than utils/cards/ so card builders, route
 * handlers, and notification helpers can share one source of truth.
 */

/**
 * Public URL of the Next.js dashboard. Used as the `link` field on Team Chat
 * "Open Dashboard" dialog buttons.
 *
 * Resolution order — the developer only needs to update ONE .env value when
 * ngrok hands out a new URL:
 *   1. FRONTEND_PUBLIC_URL                 — preferred; matches the Marketplace home URL
 *   2. origin of ZOOM_REDIRECT_URI         — already kept in sync with Zoom
 *
 * Returns null if neither yields an HTTPS URL — Zoom rejects any card whose
 * dialog.link is not HTTPS, so callers must skip the dashboard button when
 * this returns null instead of sending a card Zoom will reject.
 */
export function getWebviewUrl() {
  const candidates = [
    process.env.FRONTEND_PUBLIC_URL,
    safeOrigin(process.env.ZOOM_REDIRECT_URI),
  ].filter(Boolean);

  for (const raw of candidates) {
    const trimmed = String(raw).replace(/\/+$/, '');
    if (trimmed.startsWith('https://')) return `${trimmed}/`;
  }
  return null;
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/**
 * Detect whether a request is coming from the Zoom desktop/mobile client
 * versus a regular external browser.
 *
 * The Zoom client embeds a chromium webview whose User-Agent contains the
 * `ZoomApps/<version>` token. We match on that case-insensitively. Two
 * caveats worth knowing:
 *   - The check is server-side only. Inside the page, prefer the Apps SDK
 *     (`getRunningContext`) which is authoritative.
 *   - Unusual external browsers that happen to contain the substring would
 *     false-positive. In practice nothing else uses this token.
 *
 * @param {string} userAgent
 * @returns {boolean}
 */
export function isZoomClientUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return false;
  return /ZoomApps\//i.test(userAgent);
}

/**
 * Build a deep link that opens the Team Chat conversation with this bot
 * inside the Zoom client. Used by the post-OAuth `/welcome` page so the
 * user can jump from "I just installed the app" → "I'm talking to the bot."
 *
 * The link format is the public `zoom.us/launch/chat?jid=robot_<BOT_JID>`
 * URL — no API call required, just URL composition. ZOOM_BOT_JID is the
 * bot's JID from the Marketplace Team Chat Subscription page (e.g.
 * `v1xxxxxxxxxxxxxxxxxxxxxx@xmpp.zoom.us`).
 *
 * @returns {string|null} URL, or null if ZOOM_BOT_JID is unset.
 */
export function buildChatbotDeepLink() {
  const botJid = process.env.ZOOM_BOT_JID;
  if (!botJid) return null;
  // The JID contains "@xmpp.zoom.us". The previous static HTML built this
  // URL without URL-encoding and Zoom accepts it that way — keep the same
  // shape so existing copy/paste links still resolve.
  return `https://zoom.us/launch/chat?jid=robot_${botJid}`;
}
