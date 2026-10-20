/**
 * aiTaskAnalyzer — extracts SuggestedTask records from a meeting transcript.
 *
 * Contract:
 *   Input  : transcript (array of { ts, speaker, text }), optional meetingContext
 *   Output : Array<SuggestedTaskDraft>  (no id/status — the store assigns those)
 *
 * Safety: This module returns structured data only. It NEVER persists or
 * creates Zoom Tasks. The caller decides whether to save as 'pending'
 * suggestions for human approval.
 *
 * Uses OpenAI structured outputs (JSON Schema) for deterministic shape.
 */

import { getOpenAIClient, isOpenAIAvailable, formatTranscript, DEFAULT_MODEL } from './openai-client.js';
import { logger } from '../logger.js';

const log = logger('ai');

const TASK_EXTRACTION_SCHEMA = {
  name: 'meeting_task_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title:         { type: 'string',  description: 'Short imperative task title (max 80 chars).' },
            description:   { type: 'string',  description: 'One- or two-sentence elaboration on what needs to happen.' },
            assignee:      { type: ['string', 'null'], description: 'Speaker name or null if unassigned.' },
            priority:      { type: 'string',  enum: ['Low', 'Medium', 'High'] },
            dueDate:       { type: ['string', 'null'], description: 'ISO-8601 date if mentioned, else null.' },
            confidence:    { type: 'number',  description: '0.0–1.0 confidence the task is real and actionable.' },
            sourceExcerpt: { type: 'string',  description: 'Verbatim quote from the transcript that justifies this task.' },
          },
          required: ['title', 'description', 'assignee', 'priority', 'dueDate', 'confidence', 'sourceExcerpt'],
        },
      },
    },
    required: ['tasks'],
  },
};

const SYSTEM_PROMPT = `You are a meeting analyst. Read the transcript and extract concrete, actionable follow-up tasks.

Rules:
- Only extract tasks that a specific person committed to or was asked to do.
- Do NOT invent tasks. If unsure, give a low confidence score (<0.5).
- Use the speaker's exact words for the sourceExcerpt — never paraphrase.
- Set assignee to the speaker's name when they made the commitment ("I'll send it" → assignee = that speaker).
- Skip discussion, decisions without owners, and general status updates.
- If no clear tasks exist, return an empty list.
- Today's date is provided in the user message — use it to resolve relative dates ("by Friday", "next week").
- Confidence rubric: 0.9+ explicit "I will do X by Y", 0.7–0.9 clear commitment, 0.5–0.7 implied, <0.5 speculative.`;

/**
 * Analyze a transcript and extract candidate tasks.
 *
 * @param {Array<{ts?: string, speaker?: string, text: string}>} transcript
 * @param {object} [options]
 * @param {string} [options.meetingId]   - For attaching to suggestions later
 * @param {string} [options.meetingTitle]
 * @param {Date}   [options.now]         - Override clock for date resolution (testing)
 * @param {string} [options.model]
 * @returns {Promise<{ tasks: SuggestedTaskDraft[], usedAI: boolean }>}
 */
export async function analyzeTranscript(transcript, options = {}) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return { tasks: [], usedAI: false };
  }

  if (!isOpenAIAvailable()) {
    log.warn('analyzeTranscript skipped: OPENAI_API_KEY not set (seed data only)');
    return { tasks: [], usedAI: false };
  }

  const now = options.now ?? new Date();
  const transcriptText = formatTranscript(transcript);

  const userMessage = [
    options.meetingTitle ? `Meeting: ${options.meetingTitle}` : null,
    `Today's date: ${now.toISOString().slice(0, 10)}`,
    '',
    'Transcript:',
    transcriptText,
  ].filter(Boolean).join('\n');

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: options.model ?? DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ],
    response_format: { type: 'json_schema', json_schema: TASK_EXTRACTION_SCHEMA },
  });

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) return { tasks: [], usedAI: true };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error('analyzeTranscript parse error', { error: err.message, raw });
    return { tasks: [], usedAI: true };
  }

  const tasks = (parsed.tasks ?? []).map(t => ({
    meetingId:     options.meetingId ?? null,
    title:         t.title,
    description:   t.description,
    assignee:      t.assignee,
    priority:      t.priority,
    dueDate:       t.dueDate,
    confidence:    t.confidence,
    sourceExcerpt: t.sourceExcerpt,
    createdBy:     'ai',
  }));

  return { tasks, usedAI: true };
}
