/**
 * summaryGenerator — produces a structured meeting summary from a transcript.
 *
 * Output shape matches the MeetingContext fields the dashboard expects:
 *   summary, decisions[], highlights[], risks[]
 *
 * Safety: returns data only. Caller persists via taskStore.saveMeetingSummary().
 */

import { getOpenAIClient, isOpenAIAvailable, formatTranscript, DEFAULT_MODEL } from './openai-client.js';
import { logger } from '../logger.js';

const log = logger('ai');

const SUMMARY_SCHEMA = {
  name: 'meeting_summary',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary:    { type: 'string', description: '3-5 sentence neutral summary of what happened.' },
      decisions:  { type: 'array',  items: { type: 'string' }, description: 'Concrete decisions made in this meeting.' },
      highlights: { type: 'array',  items: { type: 'string' }, description: 'Notable progress or wins.' },
      risks:      { type: 'array',  items: { type: 'string' }, description: 'Risks, blockers, or open questions.' },
    },
    required: ['summary', 'decisions', 'highlights', 'risks'],
  },
};

const SYSTEM_PROMPT = `You are a meeting note-taker. Produce a neutral, factual summary of the transcript.

Rules:
- Summary: 3-5 sentences, plain prose, no markdown.
- Decisions: explicit choices the group made. Empty array if none.
- Highlights: completed work or progress worth flagging.
- Risks: blockers, dependencies, unresolved questions.
- Do NOT invent content not present in the transcript.
- Speaker names only when needed for clarity.`;

/**
 * Generate a structured summary from a transcript.
 *
 * @param {Array<{ts?: string, speaker?: string, text: string}>} transcript
 * @param {object} [options]
 * @returns {Promise<{ summary, decisions, highlights, risks, usedAI }>}
 */
export async function generateMeetingSummary(transcript, options = {}) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return { summary: '', decisions: [], highlights: [], risks: [], usedAI: false };
  }

  if (!isOpenAIAvailable()) {
    log.warn('summary skipped: OPENAI_API_KEY not set');
    return { summary: '', decisions: [], highlights: [], risks: [], usedAI: false };
  }

  const transcriptText = formatTranscript(transcript);
  const userMessage = [
    options.meetingTitle ? `Meeting: ${options.meetingTitle}` : null,
    '',
    'Transcript:',
    transcriptText,
  ].filter(Boolean).join('\n');

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: options.model ?? DEFAULT_MODEL,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ],
    response_format: { type: 'json_schema', json_schema: SUMMARY_SCHEMA },
  });

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) return { summary: '', decisions: [], highlights: [], risks: [], usedAI: true };

  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, usedAI: true };
  } catch (err) {
    log.error('summary parse error', { error: err.message });
    return { summary: '', decisions: [], highlights: [], risks: [], usedAI: true };
  }
}
