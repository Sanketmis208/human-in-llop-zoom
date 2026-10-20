/**
 * Tiny scoped logger. Goal: make a busy server log easy to grep without
 * adding a logging dependency.
 *
 * Format:
 *   2026-06-04T13:21:42.123Z  [rtms]   info  join confirmed meeting=abc==
 *   2026-06-04T13:21:42.456Z  [api]    warn  oauth state mismatch
 *
 * Usage:
 *   import { logger } from '../utils/logger.js';
 *   const log = logger('rtms');
 *   log.info('join confirmed', { meeting: meetingUuid });
 *   log.warn('enableTranscript failed', { error: err.message });
 *
 * Levels honour LOG_LEVEL env var: error | warn | info | debug (default info).
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

/**
 * Stringify a key-value field for the log line. Keeps the format compact and
 * grep-friendly while still showing structure.
 */
function formatField(key, value) {
  if (value === null || value === undefined) return `${key}=`;
  if (typeof value === 'string') {
    // Quote strings with whitespace; bare-word for everything else.
    return /\s/.test(value) ? `${key}="${value}"` : `${key}=${value}`;
  }
  if (typeof value === 'object') return `${key}=${JSON.stringify(value)}`;
  return `${key}=${String(value)}`;
}

function formatLine(scope, level, message, fields) {
  const ts = new Date().toISOString();
  const scopePad = `[${scope}]`.padEnd(10);
  const levelPad = level.padEnd(5);
  const fieldStr = fields && Object.keys(fields).length
    ? ' ' + Object.entries(fields).map(([k, v]) => formatField(k, v)).join(' ')
    : '';
  return `${ts}  ${scopePad} ${levelPad} ${message}${fieldStr}`;
}

function write(level, sink, scope, message, fields) {
  if (LEVELS[level] > activeLevel) return;
  sink(formatLine(scope, level, message, fields));
}

/**
 * Build a logger bound to a scope name (e.g. "rtms", "api", "webhook").
 * The scope appears as a fixed-width prefix on every line.
 */
export function logger(scope) {
  return {
    error: (msg, fields) => write('error', console.error, scope, msg, fields),
    warn:  (msg, fields) => write('warn',  console.warn,  scope, msg, fields),
    info:  (msg, fields) => write('info',  console.log,   scope, msg, fields),
    debug: (msg, fields) => write('debug', console.log,   scope, msg, fields),
  };
}
