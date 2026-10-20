/**
 * Tiny helpers used by route handlers.
 *
 * Decoupled into their own file so they're easier to find and test, and so the
 * route files stay focused on HTTP wiring rather than URL-encoding edge cases.
 */

/**
 * Zoom RTMS meeting UUIDs end in "==" (base64 padding) which URL-encodes to
 * %3D%3D. Next.js's rewrites encode the path a second time when proxying, so
 * Express receives %253D%253D, auto-decodes once to %3D%3D, and
 * req.params.meetingId is still encoded. Decoding once more recovers the raw
 * UUID, and is a no-op for already-clean values like "instance-002" or
 * "demo-mtg".
 *
 * Use this anywhere a route handler accepts a Zoom meeting UUID via path
 * parameter and may be reached through the Next.js proxy.
 */
export function unwrapMeetingId(raw) {
  if (!raw) return raw;
  try { return decodeURIComponent(raw); }
  catch { return raw; }
}
