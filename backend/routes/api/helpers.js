/**
 * Shared helpers for the /api route handlers. Each domain router (meetings,
 * tasks, suggestions, ai, …) imports what it needs from here.
 */

/**
 * Identify the user making an action for activity-log purposes. Accepts an
 * explicit actor in the request body, falls back to an x-user-id header, then
 * defaults to "user" for anonymous demo traffic.
 */
export function actorFrom(req) {
  return req.body?.actor ?? req.headers['x-user-id'] ?? 'user';
}

/** Standard 404 response shape used by every domain router. */
export function notFound(res, what) {
  return res.status(404).json({ success: false, error: `${what} not found` });
}
