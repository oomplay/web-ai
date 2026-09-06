import type { ChatMessage, ChatRequest, Provider, StreamPart } from './types.js';

/**
 * Phase 2A mock provider. Streams a deterministic, canned reply split into
 * chunks. Two env vars are honored for testing only:
 *   MOCK_CHUNK_SIZE    — characters per chunk (default 16)
 *   MOCK_CHUNK_DELAY_MS — milliseconds between chunks (default 8)
 * In normal operation these default to fast values so the chat UI feels
 * snappy. The verify harness sets MOCK_CHUNK_DELAY_MS so it can keep
 * concurrent streams alive long enough to exercise the per-IP cap.
 */
const CHUNK_SIZE = (() => {
  const v = Number.parseInt(process.env.MOCK_CHUNK_SIZE ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 16;
})();
const CHUNK_DELAY_MS = (() => {
  const v = Number.parseInt(process.env.MOCK_CHUNK_DELAY_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 8;
})();

/**
 * Phase 1 provider. Streams a deterministic, canned reply split into small
 * chunks so the frontend streaming path can be exercised end-to-end without
 * any real API key or network call.
 */
export class MockProvider implements Provider {
  readonly id = 'mock';

  async listModels() {
    return [
      { id: 'mock-mini', label: 'Mock Mini (demo)', provider: this.id },
      { id: 'mock-pro', label: 'Mock Pro (demo)', provider: this.id },
    ];
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamPart> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const reply = buildReply(req.model, lastUser?.content ?? '');
    for (const piece of chunkify(reply, CHUNK_SIZE)) {
      if (signal.aborted) return;
      await sleep(CHUNK_DELAY_MS, signal);
      // The mock never emits a thinking prefix; everything is the answer.
      yield { kind: 'answer', text: piece };
    }
  }
}

function buildReply(model: string, userText: string): string {
  const intro =
    model === 'mock-pro'
      ? 'This is the **Pro** mock model replying in Phase 1.\n\n'
      : 'This is the **Mini** mock model replying in Phase 1.\n\n';
  const userEcho = userText.trim()
    ? `You said: "${truncate(userText, 200)}"\n\n`
    : '';
  return (
    intro +
    userEcho +
    'No real AI is being called. The backend uses an in-process mock so we can ' +
    'exercise streaming, markdown, code highlighting, and persistence without ' +
    'consuming any external quota.\n\n' +
    '```ts\n' +
    '// try a code block\n' +
    'function hello(name: string) {\n' +
    '  return `Hello, ${name}!`;\n' +
    '}\n' +
    '```\n\n' +
    '_End of mock reply._'
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function* chunkify(text: string, size: number): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export type { ChatMessage };
