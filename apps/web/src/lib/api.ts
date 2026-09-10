import type { ModelInfo } from '../types/provider';
import type { ChatMessage } from '../types/chat';

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787';

export async function fetchModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/models`, { signal });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      // Caller cancelled the request. Not an error condition — return an
      // empty list so the consumer can early-return without a try/catch.
      // (The previous implementation threw `new Error('Cancelled')` which
      // surfaced as "Error: Cancelled" in the model dropdown during
      // legitimate re-renders that abort an in-flight fetch.)
      return [];
    }
    // eslint-disable-next-line no-console
    console.warn('[web-ai] models network error', err);
    throw new Error('Unable to load models.');
  }
  if (!res.ok) {
    const envelope = await safeReadError(res);
    throw new Error(envelope ?? httpErrorFallback(res.status));
  }
  const data = (await res.json()) as { models: ModelInfo[] };
  return data.models;
}

export type StreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'answer'; text: string }
  | { type: 'delta'; text: string }   // legacy: providers without split
  | { type: 'error'; message: string }
  | { type: 'aborted' }
  | { type: 'done' };

export interface StreamHandle {
  events: AsyncIterable<StreamEvent>;
  abort: () => void;
}

export function streamChat(input: {
  model: string;
  messages: Pick<ChatMessage, 'role' | 'content'>[];
}): StreamHandle {
  const controller = new AbortController();

  const events = (async function* (): AsyncIterable<StreamEvent> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      // Network errors can carry browser-specific text (e.g. "Failed to
      // fetch", "NetworkError when attempting to fetch resource") that
      // leaks implementation detail. Map to a single sanitised message.
      yield { type: 'error', message: 'Unable to reach the server.' };
      // Original error is still in the console for debugging.
      // eslint-disable-next-line no-console
      console.warn('[web-ai] chat network error', err);
      return;
    }

    if (!res.ok || !res.body) {
      // Try to extract the user-facing message from the backend's JSON
      // envelope (`{"error":"..."}`). Fall back to a generic message
      // keyed on the status code so we never echo the raw response body
      // to the chat UI (which may contain stack traces, internal IDs,
      // or upstream error text the backend already sanitised once).
      const envelope = await safeReadError(res);
      const message = envelope ?? httpErrorFallback(res.status);
      yield { type: 'error', message };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE: events separated by blank line ("\n\n")
        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const parsed = parseSseEvent(rawEvent);
          if (parsed) yield parsed;
          sepIndex = buffer.indexOf('\n\n');
        }
      }
      // Flush any trailing data without a blank line.
      const trailing = parseSseEvent(buffer);
      if (trailing) yield trailing;
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        // The user pressed Stop (or the page is unloading). Distinguish
        // this from a genuine connection failure so the UI does not
        // show a scary error for an intentional cancel.
        yield { type: 'aborted' };
        return;
      }
      // Same sanitisation policy as the pre-stream fetch failure.
      yield { type: 'error', message: 'Connection lost while reading response.' };
      // eslint-disable-next-line no-console
      console.warn('[web-ai] chat stream error', err);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
    }
  })();

  return {
    events,
    abort: () => controller.abort(),
  };
}

function parseSseEvent(raw: string): StreamEvent | null {
  // SSE: an event is one or more "field: value" lines separated by a blank line.
  // Only the `data:` field contributes to the payload. Other fields (event:, id:,
  // retry:, comments starting with ":") are intentionally ignored.
  //
  // Important: an event whose only `data:` line is empty (e.g. heartbeats like
  // `: ping\n\n` or `data: \n\n`) must be treated as a no-op, NOT as a hard
  // error. The previous implementation returned `null` for empty `data:` payloads
  // but never warned, which made it hard to tell whether the parser was silently
  // dropping events. We now also tolerate multi-line `data:` fields per spec
  // (they are joined with "\n" into the payload).
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      // Trim exactly one leading space, per the SSE spec, then strip any other
      // surrounding whitespace defensively.
      const v = line.slice(5);
      dataLines.push(v.startsWith(' ') ? v.slice(1) : v);
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('\n');
  if (payload === '') return null; // pure whitespace / heartbeat
  if (payload === '[DONE]') return { type: 'done' };
  try {
    const obj = JSON.parse(payload) as {
      type?: unknown;
      delta?: unknown;
      error?: unknown;
    };
    // Backend-sent error envelope (`data: {"error":"..."}`). The
    // previous implementation only matched events with a `delta`
    // field, so these were silently swallowed and the client saw the
    // stream just stop — surfacing the generic "stream ended"
    // message instead of the backend's user-safe explanation.
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      return { type: 'error', message: obj.error };
    }
    if (typeof obj.delta !== 'string') return null;
    const text = obj.delta;
    // Provider may emit a `type` field ("thinking" / "answer"). If it
    // is missing or unknown, fall back to "answer" so the chat bubble
    // is always the default render target.
    const t = typeof obj.type === 'string' ? obj.type : 'answer';
    if (t === 'thinking' || t === 'answer' || t === 'delta') {
      // `delta` is kept for backward compatibility with any cached
      // payload that did not declare a type. It is treated as answer.
      return { type: t, text };
    }
    return { type: 'answer', text };
  } catch {
    // Malformed JSON payload: skip this event (return null) and let the
    // caller continue with the next one. The raw buffer has already been
    // consumed by the caller; there is nothing to re-queue here.
  }
  return null;
}

/**
 * Try to read the backend's JSON `{error: "..."}` envelope and return the
 * message verbatim if it looks safe. Returns `null` if the body is missing,
 * not JSON, has no `error` field, or the field is not a non-empty string.
 *
 * The backend is responsible for the message already being user-safe (see
 * `safeProviderError` in the API). We do NOT do any extra transformation
 * here: if the backend says "Too many concurrent streams.", that's what
 * the user sees.
 */
async function safeReadError(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    /* not JSON or unreadable */
  }
  return null;
}

/**
 * Generic, user-safe message keyed on the HTTP status when the backend
 * did not provide a JSON envelope. Status codes are not sensitive (they
 * are visible in the browser devtools network panel anyway), so we use
 * them as a stable fallback label.
 */
function httpErrorFallback(status: number): string {
  if (status === 429) return 'Too many requests.';
  if (status === 413) return 'Request too large.';
  if (status >= 500) return 'Server error. Please try again.';
  return `Server error ( ${status} ).`;
}
