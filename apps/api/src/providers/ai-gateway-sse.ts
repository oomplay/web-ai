/**
 * SSE event parser for the AI Gateway upstream response.
 *
 * Tolerant of:
 *  - multiple `data:` lines per event (joined with \n)
 *  - empty `data:` (treated as ignore)
 *  - `event:`, `id:`, `retry:` fields (ignored)
 *  - comment lines starting with `:`
 *  - trailing whitespace and the optional single space after `data:`
 *  - malformed JSON (returned as ignore, not thrown)
 */
import type { ParsedUpstreamEvent } from './ai-gateway-utils.js';

export function parseUpstreamEvent(raw: string): ParsedUpstreamEvent {
  let hasData = false;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment
    if (line.startsWith('data:')) {
      hasData = true;
      const v = line.slice(5);
      dataLines.push(v.startsWith(' ') ? v.slice(1) : v);
    }
  }
  if (!hasData) return { kind: 'comment' };
  if (dataLines.length === 0) return { kind: 'ignore' };
  // SSE spec joins multi-line `data:` fields with a literal U+000A.
  // JSON.parse, however, rejects literal control chars inside string
  // literals — the JSON spec only allows the escape sequence `\n`.
  // Escape every raw newline in the joined payload so JSON.parse
  // accepts it, then the resulting string is identical to what the
  // spec produces (one logical newline at the join point, no extras).
  const rawPayload = dataLines.join('\n');
  const payload = rawPayload.replace(/\n/g, '\\n');
  if (payload === '') return { kind: 'ignore' };
  if (payload === '[DONE]') return { kind: 'done' };
  try {
    const obj = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
      error?: { message?: unknown; type?: unknown };
    };
    const choice = obj.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      return { kind: 'delta', text: delta };
    }
    if (obj.error && typeof obj.error.message === 'string') {
      return { kind: 'error', text: obj.error.message };
    }
  } catch {
    /* malformed JSON, treat as ignore */
  }
  return { kind: 'ignore' };
}
