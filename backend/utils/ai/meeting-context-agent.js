/**
 * meetingContextAgent — answers natural-language questions about a meeting.
 *
 * Pulls transcript, summary, tasks, and suggestions from TaskStore and feeds
 * them as context to the model. Returns a plain text answer.
 *
 * Use cases:
 *   - "What did Alice commit to in the last meeting?"
 *   - "Are there any open blockers from last week?"
 *   - "Who is responsible for the press release?"
 */

import { getOpenAIClient, isOpenAIAvailable, formatTranscript, DEFAULT_MODEL } from './openai-client.js';
import taskStore from '../store/task-store.js';

const SYSTEM_PROMPT = `You are a meeting-context assistant. Answer the user's question using ONLY the provided meeting data.

Rules:
- If the data does not contain the answer, say so plainly. Do not guess.
- Cite the transcript or task title when possible.
- Keep answers concise: 1-3 sentences unless the question demands a list.
- Plain text only — no markdown formatting.`;

/**
 * @param {string} meetingId
 * @param {string} question
 * @returns {Promise<{ answer: string, usedAI: boolean, context: object }>}
 */
export async function answerMeetingQuestion(meetingId, question, options = {}) {
  const context = taskStore.getMeetingContext(meetingId);
  if (!context) {
    return { answer: 'Meeting not found.', usedAI: false, context: null };
  }

  if (!isOpenAIAvailable()) {
    return {
      answer: 'AI context lookup is unavailable (OPENAI_API_KEY not set). Showing raw context only.',
      usedAI: false,
      context,
    };
  }

  const contextBlock = [
    `Meeting: ${context.title}`,
    `Date: ${context.date}`,
    `Participants: ${(context.participants ?? []).join(', ') || 'unknown'}`,
    '',
    `Summary: ${context.summary || '(no summary)'}`,
    '',
    `Decisions:\n${(context.decisions ?? []).map(d => '- ' + d).join('\n') || '(none)'}`,
    '',
    `Risks:\n${(context.risks ?? []).map(r => '- ' + r).join('\n') || '(none)'}`,
    '',
    `Open tasks:\n${context.tasks.filter(t => t.status !== 'completed').map(t => `- [${t.status}] ${t.title} (owner: ${t.owner})`).join('\n') || '(none)'}`,
    '',
    `Pending suggestions:\n${context.suggestions.filter(s => s.status === 'pending').map(s => `- ${s.title} (assignee: ${s.assignee})`).join('\n') || '(none)'}`,
    '',
    `Transcript:\n${formatTranscript(context.transcript, 4000) || '(no transcript)'}`,
  ].join('\n');

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: options.model ?? DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Meeting data:\n${contextBlock}\n\nQuestion: ${question}` },
    ],
  });

  const answer = response.choices?.[0]?.message?.content?.trim() ?? '';
  return { answer, usedAI: true, context };
}
