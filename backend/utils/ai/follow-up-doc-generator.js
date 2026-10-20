/**
 * Follow-up doc generator — produces the Markdown body of a Meeting
 * Follow-up Doc using OpenAI, grounded in the meeting's existing context
 * (summary, decisions, risks, approved tasks, pending suggestions).
 *
 * Returns Markdown only. Persistence + Zoom Doc creation happen elsewhere
 * (utils/zoom/zoom-mcp-docs.js), so the human-approval boundary is
 * preserved: this function never writes anything anywhere.
 */

import { getOpenAIClient, isOpenAIAvailable, formatTranscript, DEFAULT_MODEL } from './openai-client.js';
import { logger } from '../logger.js';
import taskStore from '../store/task-store.js';

const log = logger('ai');

const SYSTEM_PROMPT = `You are a meeting follow-up writer. Produce a clean Markdown document summarising what happened, who owns what, and what to do next.

Rules:
- Use the document outline exactly as shown in the user message.
- Be specific: name the speakers and the owners; cite exact phrases from the source material when useful.
- Do not invent tasks, decisions, or risks that aren't present in the input.
- Keep each section concise. Empty sections should be omitted, not padded.
- Plain Markdown. No HTML.`;

const OUTLINE = `# Meeting Follow-up Doc

## Summary
[2-3 sentence neutral recap]

## Key Decisions
[Bullet list, or omit section if empty]

## Approved Tasks
[Bullet list with owner and due date, or omit section if empty]

## Pending Tasks
[Bullet list of pending suggestions, or omit section if empty]

## Blockers
[Bullet list of risks / blockers, or omit section if empty]

## Next Steps
[2-4 bullets of suggested next actions]`;

/**
 * @param {string} meetingId
 * @returns {Promise<{ markdown: string, usedAI: boolean, error?: string }>}
 */
export async function generateFollowUpDocMarkdown(meetingId) {
  const ctx = taskStore.getMeetingContext(meetingId);
  if (!ctx) return { markdown: '', usedAI: false, error: 'meeting not found' };

  if (!isOpenAIAvailable()) {
    log.warn('follow-up doc skipped: OPENAI_API_KEY not set', { meeting: meetingId });
    // Return a deterministic stub built from the data the store already has,
    // so the demo still works in offline mode.
    return { markdown: buildOfflineFallback(ctx), usedAI: false };
  }

  const inputBlock = buildInputBlock(ctx);

  try {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Outline:\n${OUTLINE}\n\nMeeting data:\n${inputBlock}` },
      ],
    });
    const markdown = response.choices?.[0]?.message?.content?.trim() ?? '';
    if (!markdown) {
      return { markdown: buildOfflineFallback(ctx), usedAI: true, error: 'empty response' };
    }
    return { markdown, usedAI: true };
  } catch (err) {
    log.error('follow-up doc generation failed', { meeting: meetingId, error: err.message });
    return { markdown: buildOfflineFallback(ctx), usedAI: false, error: err.message };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildInputBlock(ctx) {
  const tasks       = ctx.tasks       ?? [];
  const suggestions = ctx.suggestions ?? [];
  const decisions   = ctx.decisions   ?? [];
  const risks       = ctx.risks       ?? [];

  const approvedTasks = tasks
    .filter(t => t.source === 'ai_suggestion' || t.source === 'manual_team_chat')
    .map(t => `- ${t.title} (owner: ${t.owner ?? 'unassigned'}, due: ${t.dueDate ?? 'none'}, priority: ${t.priority ?? 'Medium'})`);

  const pendingItems = suggestions
    .filter(s => s.status === 'pending')
    .map(s => `- ${s.title} (assignee: ${s.assignee ?? 'unassigned'}, due: ${s.dueDate ?? 'none'}) — source: "${s.sourceExcerpt ?? ''}"`);

  return [
    `Meeting: ${ctx.title ?? 'Untitled'}`,
    `Date: ${ctx.date ?? 'unknown'}`,
    `Participants: ${(ctx.participants ?? []).join(', ') || 'unknown'}`,
    '',
    `Summary: ${ctx.summary || '(none)'}`,
    '',
    `Decisions:`,
    ...decisions.map(d => `- ${d}`),
    '',
    `Risks / blockers:`,
    ...risks.map(r => `- ${r}`),
    '',
    `Approved tasks:`,
    ...(approvedTasks.length ? approvedTasks : ['- (none)']),
    '',
    `Pending suggestions:`,
    ...(pendingItems.length ? pendingItems : ['- (none)']),
    '',
    `Transcript (excerpt):`,
    formatTranscript(ctx.transcript ?? [], 3000) || '(none)',
  ].join('\n');
}

/**
 * Deterministic fallback when OpenAI is unavailable. Keeps the same outline
 * so the UI doesn't have to special-case anything.
 */
function buildOfflineFallback(ctx) {
  const sections = [`# Meeting Follow-up Doc — ${ctx.title ?? 'Untitled'}`];

  if (ctx.summary) {
    sections.push('## Summary', ctx.summary, '');
  }
  if ((ctx.decisions ?? []).length) {
    sections.push('## Key Decisions', ...ctx.decisions.map(d => `- ${d}`), '');
  }
  const approved = (ctx.tasks ?? []).filter(t => t.status !== 'completed' && (t.source === 'ai_suggestion' || t.source === 'manual_team_chat'));
  if (approved.length) {
    sections.push('## Approved Tasks',
      ...approved.map(t => `- ${t.title} — ${t.owner ?? 'unassigned'} (due ${t.dueDate ?? 'TBD'}, ${t.priority ?? 'Medium'})`),
      '');
  }
  const pending = (ctx.suggestions ?? []).filter(s => s.status === 'pending');
  if (pending.length) {
    sections.push('## Pending Tasks',
      ...pending.map(s => `- ${s.title} — ${s.assignee ?? 'unassigned'}`),
      '');
  }
  if ((ctx.risks ?? []).length) {
    sections.push('## Blockers', ...ctx.risks.map(r => `- ${r}`), '');
  }
  sections.push('## Next Steps', '- Review and assign any unassigned tasks', '- Confirm decisions with stakeholders', '');

  return sections.join('\n');
}
