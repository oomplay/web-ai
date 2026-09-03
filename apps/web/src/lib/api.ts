import type { ModelInfo } from '../types/provider';
import type { ChatMessage } from '../types/chat';

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787';

export async function fetchModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE_URL}/api/models`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to load models: ${res.status}`);
  }
  const data = (await res.json()) as { models: ModelInfo[] };
  return data.models;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'error'; message: string }
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
      yield { type: 'error', message: (err as Error).message || 'Network error' };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await safeReadText(res);
      yield { type: 'error', message: `Server error: ${res.status} ${text}` };
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
      if ((err as { name?: string }).name === 'AbortError') return;
      yield { type: 'error', message: (err as Error).message || 'Stream error' };
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
    const obj = JSON.parse(payload) as { delta?: unknown; error?: unknown };
    if (typeof obj.delta === 'string') return { type: 'delta', text: obj.delta };
    if (typeof obj.error === 'string') return { type: 'error', message: obj.error };
  } catch {
    /* swallow malformed events but do not drop the buffer */
  }
  return null;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
