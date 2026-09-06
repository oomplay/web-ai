import type { ChatRequest, ModelInfo, Provider, StreamPart } from './types.js';
import {
  type ParsedUpstreamEvent,
  composeTimeoutSignal,
  safeProviderError,
  GatewayConfigError,
} from './ai-gateway-utils.js';
import { resolveChatEndpoint } from './ai-gateway-ssrf.js';
import { parseUpstreamEvent } from './ai-gateway-sse.js';
import { ThinkingSplitter } from './thinking-splitter.js';

export interface KiwiCraftAIGatewayOptions {
  baseUrl: string;
  apiKey: string;
  models: string[];
  /**
   * Optional id -> label map. When present, the matching model id is
   * exposed with this human-readable label via `listModels()`. Ids
   * without an entry fall back to the id itself.
   */
  modelLabels?: Record<string, string>;
  allowedHosts: string[];
  timeoutMs?: number;
  /**
   * Enable thinking/answer split for the wire format. When `true`, the
   * gateway's raw `content` stream is fed through `ThinkingSplitter`,
   * which detects the `\n\s*\n\s*\n` boundary and yields the prefix as
   * `kind: 'thinking'` and the suffix as `kind: 'answer'`. This is a
   * per-deployment switch because it only matters for models that do
   * not expose `reasoning_content` separately (e.g. the
   * Lorbus/Qwen3.6-27B-int4-AutoRound model behind this gateway). When
   * `false` (the default), every byte is yielded as `kind: 'answer'`,
   * which is exactly what upstream models that already split reasoning
   * want — and what the previous behaviour shipped.
   */
  splitThinking?: boolean;
  /** Test-only: override the fetch implementation. */
  fetchImpl?: typeof fetch;
}

/**
 * Phase 2B: the only real AI provider wired into WEB-AI. Talks to the
 * KiwiCraft AI Gateway using the OpenAI-compatible `/chat/completions`
 * endpoint. Streams deltas as `AsyncIterable<string>` so the existing
 * chat route can pipe them straight to the client SSE envelope without
 * knowing or caring that a real provider is behind the abstraction.
 *
 * Design points:
 *  - The provider is registered ONLY when all four preconditions hold
 *    (see Registry); otherwise it is silently absent.
 *  - The model allowlist is enforced INSIDE the provider: an upstream
 *    request for a model the operator has not whitelisted is refused.
 *  - API key is held in closure only. It is never returned by
 *    listModels(), never logged, never serialised.
 *  - The upstream URL is the result of `resolveChatEndpoint()`; we
 *    never fetch a URL the operator did not declare.
 *  - All errors are mapped through `safeProviderError` before being
 *    surfaced; the upstream's status code is logged server-side.
 */
export class KiwiCraftAIGatewayProvider implements Provider {
  readonly id = 'ai-gateway';

  private readonly endpoint: string;
  private readonly host: string;
  private readonly apiKey: string;
  private readonly allowedModels: Set<string>;
  private readonly modelLabels: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly splitThinking: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: KiwiCraftAIGatewayOptions) {
    const { endpoint, host } = resolveChatEndpoint(opts.baseUrl, opts.allowedHosts);
    this.endpoint = endpoint;
    this.host = host;
    this.apiKey = opts.apiKey;
    this.allowedModels = new Set(opts.models);
    this.modelLabels = opts.modelLabels ?? {};
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.splitThinking = opts.splitThinking ?? false;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async listModels(): Promise<ModelInfo[]> {
    return Array.from(this.allowedModels).map((m) => ({
      id: m,
      label: this.modelLabels[m] ?? m,
      provider: this.id,
    }));
  }

  /**
   * Stream chat completions from the upstream. Yields typed stream
   * parts; the route wraps each one in a `data: {...}` SSE frame. Throws
   * on upstream errors (the route maps them to a sanitised SSE error
   * event).
   *
   * If `splitThinking` is enabled, the raw text stream is fed through
   * a `ThinkingSplitter` so the thinking/answer boundary is detected
   * and forwarded as separate `kind: 'thinking'` / `kind: 'answer'`
   * parts. If it is disabled (the default), every byte is yielded as
   * `kind: 'answer'` to preserve the historical single-stream wire
   * format.
   */
  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamPart> {
    if (!this.allowedModels.has(req.model)) {
      throw new GatewayConfigError(
        `Model '${req.model}' is not in AI_GATEWAY_MODELS.`,
      );
    }
    const { signal: composed, cleanup, cancelTimeout } = composeTimeoutSignal(
      signal,
      this.timeoutMs,
    );
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }),
        signal: composed,
      });
    } catch (err) {
      cleanup();
      if ((err as { name?: string }).name === 'AbortError') return;
      throw new Error(safeProviderError({ kind: 'network' }));
    }
    if (!res.ok) {
      cleanup();
      // eslint-disable-next-line no-console
      console.error('[api] ai-gateway upstream error', {
        host: this.host,
        status: res.status,
      });
      throw new Error(safeProviderError({ kind: 'http', status: res.status }));
    }
    if (!res.body) {
      cleanup();
      throw new Error(safeProviderError({ kind: 'parse' }));
    }
    // Response headers are in: the timeout has served its purpose as a
    // CONNECT budget. Disarm it so a long, healthy generation is not
    // killed mid-stream — the SSE route's own lifecycle timers
    // (SSE_IDLE_TIMEOUT_MS / SSE_MAX_DURATION_MS) and the client's
    // abort signal take over from here.
    cancelTimeout();
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const splitter = this.splitThinking ? new ThinkingSplitter() : null;
    let pendingParts: StreamPart[] = [];
    let buffer = '';
    let upstreamErrored = false;
    let userError: string | null = null;
    const pushText = (text: string): void => {
      if (splitter) {
        for (const part of splitter.feed(text)) pendingParts.push(part);
      } else {
        if (text.length > 0) pendingParts.push({ kind: 'answer', text });
      }
    };
    const drainPending = (): StreamPart | undefined => {
      if (pendingParts.length === 0) return undefined;
      return pendingParts.shift();
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (composed.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const ev: ParsedUpstreamEvent = parseUpstreamEvent(raw);
          if (ev.kind === 'delta') {
            pushText(ev.text);
          } else if (ev.kind === 'error') {
            userError = safeProviderError({ kind: 'parse' });
            upstreamErrored = true;
            // eslint-disable-next-line no-console
            console.error('[api] ai-gateway upstream sse error', { host: this.host });
            break;
          } else if (ev.kind === 'done') {
            break;
          }
          sep = buffer.indexOf('\n\n');
        }
        if (upstreamErrored) break;
        // Flush any pending parts produced by pushText before we block on
        // the next read. The for-await caller pulls one part at a time
        // (via drainPending) so this yields promptly.
        if (pendingParts.length > 0) {
          const next = drainPending();
          if (next) yield next;
        }
      }
      // Drain any trailing partial event.
      if (!composed.aborted && !upstreamErrored) {
        const trailing = buffer.trim();
        if (trailing) {
          const ev = parseUpstreamEvent(trailing);
          if (ev.kind === 'delta') pushText(ev.text);
        }
      }
      // End of stream: flush the splitter so any held-back buffer is
      // released. If no boundary was ever seen, this reclassifies the
      // whole stream as 'answer'.
      if (splitter) {
        for (const part of splitter.flush()) pendingParts.push(part);
      }
      while (pendingParts.length > 0) {
        const next = drainPending();
        if (next) yield next;
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      throw new Error(safeProviderError({ kind: 'parse' }));
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
      cleanup();
    }
    if (upstreamErrored && userError) {
      throw new Error(userError);
    }
  }
}
