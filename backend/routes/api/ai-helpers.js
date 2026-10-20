/**
 * Shared error formatting for AI endpoints.
 *
 * OpenAI errors can leak the API key prefix inside the .message field and
 * usually correspond to a recoverable state (no key set, rate limit, model
 * unavailable). We translate them into a stable response shape:
 *
 *   { success: false, aiUnavailable: true, error: <safe message>, usedAI: false, ...fallback }
 *
 * Importantly, we respond with HTTP 200 (not 5xx) so the frontend can
 * differentiate "AI not available" from "server is broken" and degrade
 * gracefully (seed-only suggestions, hint banners, etc.).
 */

import { logger } from '../../utils/logger.js';

const log = logger('api');

export function aiError(res, err, fallback = {}) {
  const status = err?.status ?? err?.response?.status ?? null;
  let userMessage;
  if      (status === 401) userMessage = 'OpenAI authentication failed — check OPENAI_API_KEY.';
  else if (status === 429) userMessage = 'OpenAI rate limit reached. Retry shortly.';
  else if (status === 404) userMessage = 'OpenAI model not available for your account.';
  else                     userMessage = 'OpenAI request failed.';
  log.error('ai error', { status, error: err.message });
  return res.status(200).json({
    success: false,
    aiUnavailable: true,
    error: userMessage,
    usedAI: false,
    ...fallback,
  });
}
