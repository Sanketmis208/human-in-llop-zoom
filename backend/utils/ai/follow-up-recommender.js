/**
 * Follow-up doc recommender — rule-based, not AI.
 *
 * Decides whether the AI Actions tab should suggest creating a Meeting
 * Follow-up Doc, and produces the human-readable reasons that go on the
 * suggested-action card.
 *
 * No OpenAI call here — the trigger is just counts derived from the
 * existing TaskStore data. AI is only used later, when the user clicks
 * Preview, to generate the document body.
 */

import taskStore from '../store/task-store.js';

const TRIGGER_KEYWORDS_BLOCKER = ['block', 'blocker', 'blocked', 'stuck', 'risk'];

/**
 * @param {string} meetingId
 * @returns {{
 *   shouldSuggestDoc: boolean,
 *   reasons: string[],
 *   signals: {
 *     approvedTasks: number,
 *     pendingSuggestions: number,
 *     completedTasks: number,
 *     decisions: number,
 *     blockers: number,
 *     hasSummary: boolean,
 *   }
 * }}
 */
export function evaluateFollowUpRecommendation(meetingId) {
  const ctx = taskStore.getMeetingContext(meetingId);
  if (!ctx) {
    return {
      shouldSuggestDoc: false,
      reasons: [],
      signals: empty(),
    };
  }

  const tasks       = ctx.tasks       ?? [];
  const suggestions = ctx.suggestions ?? [];
  const decisions   = ctx.decisions   ?? [];
  const risks       = ctx.risks       ?? [];

  const approvedTasks      = tasks.filter(t => t.source === 'ai_suggestion').length;
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending').length;
  const completedTasks     = tasks.filter(t => t.status === 'completed').length;
  const blockers           = countBlockers(risks, ctx.summary);
  const hasSummary         = Boolean(ctx.summary && ctx.summary.trim().length > 20);

  const signals = {
    approvedTasks,
    pendingSuggestions,
    completedTasks,
    decisions: decisions.length,
    blockers,
    hasSummary,
  };

  const reasons = [];
  if (approvedTasks > 0)      reasons.push(`${approvedTasks} approved task${approvedTasks === 1 ? '' : 's'}`);
  if (pendingSuggestions > 0) reasons.push(`${pendingSuggestions} pending suggestion${pendingSuggestions === 1 ? '' : 's'}`);
  if (decisions.length > 0)   reasons.push(`${decisions.length} decision${decisions.length === 1 ? '' : 's'}`);
  if (blockers > 0)           reasons.push(`${blockers} blocker${blockers === 1 ? '' : 's'}`);
  if (hasSummary)             reasons.push('useful AI summary');

  return {
    shouldSuggestDoc: reasons.length > 0,
    reasons,
    signals,
  };
}

/**
 * Pick the meeting most likely to have something to recommend on. Used as
 * the default selection for the AI Actions tab.
 */
export function findPrimaryActionableMeeting() {
  const all = taskStore.listMeetings();
  if (all.length === 0) return null;

  const scored = all
    .map(m => {
      const evaluation = evaluateFollowUpRecommendation(m.id);
      return { meeting: m, evaluation };
    })
    .filter(s => s.evaluation.shouldSuggestDoc);

  if (scored.length > 0) return scored[0].meeting.id;
  // Fall back to the most recent meeting even when nothing is suggested —
  // the UI still wants something to render in the dropdown.
  return all[0].id;
}

/**
 * Build the AI Observations banner text from the trigger signals.
 */
export function buildObservationsBanner(signals) {
  const actionable = signals.approvedTasks
    + signals.pendingSuggestions
    + signals.decisions
    + signals.blockers;

  if (actionable === 0 && !signals.hasSummary) {
    return 'No actionable items detected from this meeting yet.';
  }

  if (signals.hasSummary && actionable === 0) {
    return 'This meeting generated follow-up context that may benefit from documentation.';
  }

  return `${actionable} actionable item${actionable === 1 ? '' : 's'} were detected from this meeting.`;
}

// ── internals ────────────────────────────────────────────────────────────────

function empty() {
  return {
    approvedTasks: 0,
    pendingSuggestions: 0,
    completedTasks: 0,
    decisions: 0,
    blockers: 0,
    hasSummary: false,
  };
}

function countBlockers(risks, summary) {
  // Risks array is the primary signal. Also scan the summary text for
  // explicit blocker keywords — captures cases where the summary mentions
  // a blocker but it wasn't structured into a risks entry.
  let count = (risks ?? []).length;
  const text = (summary ?? '').toLowerCase();
  for (const kw of TRIGGER_KEYWORDS_BLOCKER) {
    if (text.includes(kw)) {
      count += 1;
      break; // don't double-count multiple keyword hits in the same summary
    }
  }
  return count;
}
