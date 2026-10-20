/**
 * Task completion matcher — decides whether a meeting transcript segment
 * indicates that a specific task has been completed.
 *
 * Phase 1 strategy: deterministic keyword + completion-phrase matching.
 *   1. Normalize transcript text and task title (lowercase, strip punctuation).
 *   2. Extract meaningful keywords from the task title (skip stop words).
 *   3. Count how many keywords appear in the transcript.
 *   4. Check for known completion phrases ("done", "sent", "finished", …).
 *   5. Combine into a 0–1 confidence score; treat ≥ 0.5 as a match.
 *
 * This approach is intentionally simple and explainable — every match can
 * be traced back to specific keywords and phrases, which is ideal for a
 * developer-facing sample app.
 *
 * TODO (Phase 2): Add AI-based matching.
 *   Suggested approach — call the LLM with a structured prompt:
 *   "Given task: '{title}' — does this transcript excerpt indicate the task
 *    was completed? '{text}'. Reply with JSON: { completed: bool, reason: string }"
 *   Use AI confidence when keyword score is below threshold (0.3–0.5 range).
 *
 * Exported API:
 *   matchTranscriptToTask(transcriptText, task)   → single result object
 *   matchTranscriptToTasks(transcriptText, tasks) → sorted array of matches
 */

// ── Completion signal phrases ─────────────────────────────────────────────────
// Any of these in the transcript is a strong signal that something was finished.
const COMPLETION_PHRASES = [
  'all set',
  'already done',
  'approved',
  'checked off',
  'closed out',
  'complete',
  'completed',
  'confirmed',
  'delivered',
  'deployed',
  'done',
  'finished',
  'got it done',
  'merged',
  'reviewed',
  'sent',
  'shipped',
  'signed off',
  'submitted',
  'taken care of',
  'took care of',
  'wrapped up',
];

// ── Stop words excluded from keyword extraction ───────────────────────────────
const STOP_WORDS = new Set([
  'a', 'about', 'all', 'an', 'and', 'are', 'as', 'at', 'be', 'been',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'each', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'in', 'is', 'it',
  'its', 'may', 'might', 'my', 'not', 'of', 'on', 'or', 'our', 'shall',
  'should', 'that', 'the', 'their', 'these', 'they', 'this', 'those',
  'to', 'up', 'was', 'we', 'were', 'will', 'with', 'would', 'you', 'your',
]);

// ── Normalization ─────────────────────────────────────────────────────────────

/** Lowercase, strip punctuation, collapse whitespace. */
function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract meaningful keywords from a task title.
 * Skips stop words and tokens shorter than 3 characters.
 */
function extractKeywords(title) {
  return normalizeText(title)
    .split(' ')
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Return the first completion phrase found in already-normalized text,
 * or null if none.
 */
function detectCompletionPhrase(normalizedText) {
  for (const phrase of COMPLETION_PHRASES) {
    if (normalizedText.includes(phrase)) return phrase;
  }
  return null;
}

// ── Core matching ─────────────────────────────────────────────────────────────

/**
 * Compare one transcript segment against one task.
 *
 * Scoring:
 *   keyword contribution: min(matchedKeywords.length × 0.3,  0.6)
 *   phrase  contribution: 0.4 if a completion phrase is present, else 0.0
 *   confidence = keyword score + phrase score  (capped at 1.0)
 *   match = confidence ≥ 0.5
 *
 * @param {string} transcriptText - raw text from one RTMS transcript segment
 * @param {object} task           - task object from taskStore
 * @returns {{
 *   matched: boolean,
 *   taskId: string,
 *   confidence: number,
 *   reason: string,
 *   matchedKeywords: string[],
 *   matchedPhrase: string|null,
 *   originalText: string,
 * }}
 */
export function matchTranscriptToTask(transcriptText, task) {
  const normalizedTranscript = normalizeText(transcriptText);
  const keywords = extractKeywords(task.title);
  const matchedPhrase = detectCompletionPhrase(normalizedTranscript);

  const matchedKeywords = keywords.filter(kw => normalizedTranscript.includes(kw));
  const keywordScore = Math.min(matchedKeywords.length * 0.3, 0.6);
  const phraseScore  = matchedPhrase ? 0.4 : 0.0;
  const confidence   = Math.round(Math.min(keywordScore + phraseScore, 1.0) * 100) / 100;

  const matched = confidence >= 0.5;

  let reason = '';
  if (matched) {
    const parts = [];
    if (matchedKeywords.length > 0) {
      parts.push(`matched keywords: "${matchedKeywords.join('", "')}"`);
    }
    if (matchedPhrase) {
      parts.push(`completion phrase detected: "${matchedPhrase}"`);
    }
    reason = parts.join('; ');
  }

  return {
    matched,
    taskId: task.id,
    confidence,
    reason,
    matchedKeywords,
    matchedPhrase,
    originalText: transcriptText,
  };
}

/**
 * Match a transcript segment against all open / in-progress tasks.
 * Returns only confirmed matches (confidence ≥ 0.5), sorted highest-first.
 *
 * Skips 'completed' tasks — they are already done.
 *
 * TODO (Phase 2): Add AI fallback here for segments with marginal keyword overlap.
 *   When keywordScore < 0.3 but phraseScore = 0.4 (completion mentioned but no
 *   clear keyword match), call the LLM to determine which task was likely referred to.
 *
 * @param {string}   transcriptText - raw RTMS transcript segment text
 * @param {object[]} tasks          - full task list from the task store
 * @returns {Array}  Array of match result objects, sorted by confidence desc.
 */
export function matchTranscriptToTasks(transcriptText, tasks) {
  if (!transcriptText?.trim() || !tasks?.length) return [];

  const activeTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
  if (!activeTasks.length) return [];

  return activeTasks
    .map(task => matchTranscriptToTask(transcriptText, task))
    .filter(r => r.matched)
    .sort((a, b) => b.confidence - a.confidence);
}
