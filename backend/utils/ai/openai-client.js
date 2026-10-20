/**
 * OpenAI client singleton.
 *
 * Reads OPENAI_API_KEY from env and lazily constructs the SDK client.
 * If the key is missing, every consumer should call `isOpenAIAvailable()`
 * first and degrade gracefully (return empty results instead of throwing).
 * The demo must still run with mock data when OpenAI is not configured.
 */

import OpenAI from 'openai';

let client = null;

export const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

export function isOpenAIAvailable() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAIClient() {
  if (client) return client;
  if (!isOpenAIAvailable()) {
    throw new Error(
      'OPENAI_API_KEY is not set. Set it in .env or call isOpenAIAvailable() first.',
    );
  }
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * Format a transcript array into a single string for prompt context.
 * Caps at maxChars to avoid runaway prompts.
 */
export function formatTranscript(segments, maxChars = 8000) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  const lines = segments.map(s => `[${s.ts ?? ''}] ${s.speaker ?? 'Speaker'}: ${s.text ?? ''}`);
  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(-maxChars);
}
