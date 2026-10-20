/**
 * Zoom MCP — Doc creation via the OpenAI SDK (Responses API as MCP client).
 *
 * We don't open a JSON-RPC connection to Zoom MCP ourselves. Instead we
 * configure OpenAI's Responses API with the Zoom MCP server as a remote
 * tool source — OpenAI handles `tools/list` discovery and `tools/call`
 * invocation against `https://mcp.zoom.us/mcp/zoom/streamable` (the
 * region-agnostic Zoom MCP Streamable HTTP endpoint), passing through
 * the user's OAuth bearer token via custom headers.
 *
 * Why this shape:
 *   - Responses API + MCP is the OpenAI-idiomatic agent pattern; OpenAI
 *     itself manages the MCP protocol on our behalf.
 *   - `allowed_tools` restricts the surface so the model can't accidentally
 *     reach for `search_zoom` or anything else exposed by the Zoom MCP
 *     server beyond the doc-creation tool we actually want.
 *   - `require_approval: 'never'` is appropriate because the human-in-the-
 *     loop boundary lives one level up — the user has already clicked
 *     "Create Zoom Doc" in our UI before this code runs.
 *
 * Required environment:
 *   - OPENAI_API_KEY                       OpenAI Responses API key
 *   - (optional) ZOOM_MCP_ENDPOINT         defaults to mcp.zoom.us
 *   - (optional) OPENAI_MODEL              defaults to gpt-4.1-mini
 *
 * Caller must supply a Zoom user OAuth token with `docs:write:import`
 * scope; it flows through OpenAI to Zoom MCP as the Authorization header.
 */

import OpenAI from 'openai';
import { logger } from '../logger.js';

const log = logger('zoom-mcp');

const DEFAULT_MCP_ENDPOINT = 'https://mcp.zoom.us/mcp/zoom/streamable';
const TOOL_NAME            = 'create_new_file_with_markdown';

/**
 * @param {object} args
 * @param {string} args.userAccessToken  Zoom user OAuth bearer w/ docs:write:import
 * @param {string} args.content          Markdown body for the new Zoom Doc
 * @param {string} [args.fileName]       Optional document title
 * @returns {Promise<
 *   { ok: true,  fileId: string|null, fileLink: string|null, title: string|null, rawResult: unknown } |
 *   { ok: false, error: string, status?: number, raw?: unknown }
 * >}
 */
export async function createZoomDocFromMarkdown({ userAccessToken, content, fileName }) {
  if (!userAccessToken) {
    return { ok: false, error: 'Missing user OAuth access token. Sign in via /auth/login first.' };
  }
  if (!content || !content.trim()) {
    return { ok: false, error: 'Markdown content is empty.' };
  }
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      error: 'OPENAI_API_KEY not set. The Zoom MCP doc-creation flow runs through the OpenAI Responses API.',
    };
  }

  const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const endpoint = process.env.ZOOM_MCP_ENDPOINT || DEFAULT_MCP_ENDPOINT;
  const docTitle = (fileName ?? '').trim() || 'Meeting Follow-up';
  const model    = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  log.info('responses.create with Zoom MCP tool', { model, tool: TOOL_NAME, file_name: docTitle });

  let response;
  try {
    response = await openai.responses.create({
      model,
      tools: [{
        type: 'mcp',
        server_label: 'zoom-mcp',
        server_url:   endpoint,
        // OpenAI forwards these headers verbatim when it talks to Zoom MCP.
        // The user OAuth token must include `docs:write:import` scope.
        headers: { Authorization: `Bearer ${userAccessToken}` },
        // Human approval has already happened in our app UI.
        require_approval: 'never',
        // Constrain the surface to one tool so the model can't reach for
        // anything else the Zoom MCP server happens to expose.
        allowed_tools: [TOOL_NAME],
      }],
      // Directive prompt: call the MCP tool once with the supplied content
      // and report the resulting file id + link. No creative reinterpretation.
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: buildPrompt(docTitle, content) },
          ],
        },
      ],
      temperature: 0,
    });
  } catch (err) {
    log.error('responses.create failed', { error: err.message, status: err.status });
    return { ok: false, status: err.status, error: explainOpenAIError(err) };
  }

  const extracted = extractMetadataFromResponse(response);

  if (!extracted.toolCallFound) {
    log.warn('model did not invoke MCP tool', { id: response.id });
    return {
      ok: false,
      error: 'OpenAI did not invoke the Zoom MCP tool. Usually this means the docs:write:import scope is missing on the user OAuth token, or Zoom MCP rejected the call upstream.',
      raw: redactOutput(response),
    };
  }
  if (extracted.toolError) {
    log.error('MCP tool returned an error', { error: extracted.toolError });
    return {
      ok: false,
      error: `Zoom MCP error: ${extracted.toolError}`,
      raw: redactOutput(response),
    };
  }

  log.info('Zoom Doc created via OpenAI→MCP', {
    fileId:   extracted.fileId,
    fileLink: extracted.fileLink,
  });

  return {
    ok:        true,
    fileId:    extracted.fileId,
    fileLink:  extracted.fileLink,
    title:     extracted.title ?? docTitle,
    rawResult: extracted.rawResult,
  };
}

// ── prompt + response parsing ───────────────────────────────────────────────

function buildPrompt(docTitle, markdown) {
  return [
    `Use the ${TOOL_NAME} tool exposed by the zoom-mcp server to create a new Zoom Doc.`,
    '',
    `Call the tool exactly once with these arguments:`,
    `  file_name: "${docTitle}"`,
    `  content:   <the markdown content below, verbatim>`,
    '',
    'Markdown content:',
    '---',
    markdown,
    '---',
    '',
    'After the tool returns, respond with only the file id and file link from',
    'the tool result, formatted as JSON: {"file_id":"…","file_link":"…"}.',
    'Do not add explanation or other commentary.',
  ].join('\n');
}

/**
 * Walk the Responses API `output` array and pull out the MCP tool-call result.
 * Item types of interest:
 *   - `mcp_call`        the tool invocation + its result
 *   - `mcp_list_tools`  discovery (informational; we don't need it)
 *   - `message`         the assistant's final text — also worth scanning
 *
 * Field names on `mcp_call` evolve across OpenAI SDK versions, so we look
 * at `output`, `result`, and `content` and merge.
 */
function extractMetadataFromResponse(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  let toolCallFound = false;
  let toolError     = null;
  let rawResult     = null;

  for (const item of output) {
    if (item?.type === 'mcp_call' && item.name === TOOL_NAME) {
      toolCallFound = true;
      if (item.error) toolError = typeof item.error === 'string' ? item.error : JSON.stringify(item.error);
      rawResult = item.output ?? item.result ?? item.content ?? rawResult;
    }
  }

  const outputText = response?.output_text ?? '';

  const fromResult = pickMetadataFromAny(rawResult);
  const fromText   = pickMetadataFromText(outputText);
  return {
    toolCallFound,
    toolError,
    rawResult,
    fileId:   fromResult.fileId   ?? fromText.fileId   ?? null,
    fileLink: fromResult.fileLink ?? fromText.fileLink ?? null,
    title:    fromResult.title    ?? null,
  };
}

function pickMetadataFromAny(raw) {
  if (raw == null) return { fileId: null, fileLink: null, title: null };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const candidate = pickMetadataFromAny(item);
      if (candidate.fileLink || candidate.fileId) return candidate;
    }
    return { fileId: null, fileLink: null, title: null };
  }

  if (typeof raw === 'string') return pickMetadataFromText(raw);

  if (typeof raw === 'object') {
    if (raw.type === 'text' && typeof raw.text === 'string')        return pickMetadataFromText(raw.text);
    if (raw.type === 'resource' && raw.resource)                    return pickMetadataFromAny({ ...raw.resource, file_link: raw.resource.uri });
    if (raw.structuredContent)                                       return pickMetadataFromAny(raw.structuredContent);
    if (raw.content)                                                 return pickMetadataFromAny(raw.content);

    return {
      fileId:   raw.file_id   ?? raw.fileId   ?? raw.id   ?? null,
      fileLink: raw.file_link ?? raw.fileLink ?? raw.url  ?? raw.link ?? null,
      title:    raw.file_name ?? raw.title    ?? raw.name ?? null,
    };
  }

  return { fileId: null, fileLink: null, title: null };
}

function pickMetadataFromText(text) {
  if (!text || typeof text !== 'string') return { fileId: null, fileLink: null, title: null };

  try {
    const parsed = JSON.parse(text);
    const found  = pickMetadataFromAny(parsed);
    if (found.fileLink || found.fileId) return found;
  } catch { /* fall through to regex */ }

  const linkMatch = text.match(/https?:\/\/[^\s)"']*zoom\.us[^\s)"']*/i);
  const idMatch   = text.match(/file[_\s-]?id[^\w]+([A-Za-z0-9_-]+)/i);

  return {
    fileId:   idMatch ? idMatch[1] : null,
    fileLink: linkMatch ? linkMatch[0] : null,
    title:    null,
  };
}

function explainOpenAIError(err) {
  const status  = err.status ?? err?.response?.status;
  const message = err.message ?? 'OpenAI request failed';

  if (status === 401) return 'OpenAI authentication failed. Check OPENAI_API_KEY.';
  if (status === 429) return 'OpenAI rate limit reached. Retry shortly.';
  if (/mcp/i.test(message)) return `OpenAI MCP integration error: ${message}`;
  return `OpenAI request failed: ${message}`;
}

/**
 * Trim the response we hand back in the `raw` field on error responses so we
 * don't leak the user's whole prompt history into the API surface.
 */
function redactOutput(response) {
  if (!response || typeof response !== 'object') return response;
  return {
    id:    response.id,
    model: response.model,
    output: Array.isArray(response.output)
      ? response.output.map(o => ({ type: o.type, name: o.name, error: o.error }))
      : null,
    output_text: response.output_text,
  };
}
