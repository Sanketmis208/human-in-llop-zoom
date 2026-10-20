/**
 * taskApprovalAgent — pre-flight review for a SuggestedTask.
 *
 * Inspired by the reference project's `needs_approval` pattern: instead of
 * letting the AI mutate state, it produces a recommendation that the human
 * approver sees alongside the suggestion. The user still clicks Approve.
 *
 * Returns:
 *   recommendation : 'approve' | 'edit' | 'reject'
 *   reasoning      : short explanation
 *   suggestedEdits : partial SuggestedTask fields if recommendation === 'edit'
 */

import { getOpenAIClient, isOpenAIAvailable, DEFAULT_MODEL } from './openai-client.js';
import { logger } from '../logger.js';

const log = logger('ai');

const REVIEW_SCHEMA = {
  name: 'task_approval_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendation: { type: 'string', enum: ['approve', 'edit', 'reject'] },
      reasoning:      { type: 'string', description: 'One sentence explaining the recommendation.' },
      suggestedEdits: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title:       { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          assignee:    { type: ['string', 'null'] },
          priority:    { type: ['string', 'null'], enum: ['Low', 'Medium', 'High', null] },
          dueDate:     { type: ['string', 'null'] },
        },
        required: ['title', 'description', 'assignee', 'priority', 'dueDate'],
      },
    },
    required: ['recommendation', 'reasoning', 'suggestedEdits'],
  },
};

const SYSTEM_PROMPT = `You are an approval reviewer. Inspect a suggested task and recommend approve/edit/reject.

Heuristics:
- approve when the task is clear, has an owner, has reasonable priority, and the source excerpt strongly supports it.
- edit when the task is real but needs a fix (missing owner, wrong priority, ambiguous title). Use suggestedEdits to fix.
- reject when the source excerpt does not support the task or it duplicates an existing open task.

Use null for any suggestedEdits field you do not want to change.`;

/**
 * @param {object} suggestion         - the SuggestedTask under review
 * @param {object} [context]
 * @param {object[]} [context.openTasks]  - existing open tasks for duplicate detection
 * @returns {Promise<{ recommendation, reasoning, suggestedEdits, usedAI }>}
 */
export async function reviewSuggestion(suggestion, context = {}) {
  if (!isOpenAIAvailable()) {
    return {
      recommendation: 'approve',
      reasoning: 'AI review unavailable (OPENAI_API_KEY not set). Showing suggestion as-is.',
      suggestedEdits: { title: null, description: null, assignee: null, priority: null, dueDate: null },
      usedAI: false,
    };
  }

  const openTasksBlock = (context.openTasks ?? [])
    .map(t => `- ${t.title} (owner: ${t.owner}, status: ${t.status})`)
    .join('\n') || '(none)';

  const userMessage = [
    'Suggested task:',
    JSON.stringify({
      title: suggestion.title,
      description: suggestion.description,
      assignee: suggestion.assignee,
      priority: suggestion.priority,
      dueDate: suggestion.dueDate,
      confidence: suggestion.confidence,
      sourceExcerpt: suggestion.sourceExcerpt,
    }, null, 2),
    '',
    'Existing open tasks in this meeting context:',
    openTasksBlock,
  ].join('\n');

  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: context.model ?? DEFAULT_MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ],
    response_format: { type: 'json_schema', json_schema: REVIEW_SCHEMA },
  });

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) {
    return {
      recommendation: 'approve',
      reasoning: 'No review available.',
      suggestedEdits: { title: null, description: null, assignee: null, priority: null, dueDate: null },
      usedAI: true,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, usedAI: true };
  } catch (err) {
    log.error('review parse error', { error: err.message });
    return {
      recommendation: 'approve',
      reasoning: 'Parse error; defaulting to approve.',
      suggestedEdits: { title: null, description: null, assignee: null, priority: null, dueDate: null },
      usedAI: true,
    };
  }
}
