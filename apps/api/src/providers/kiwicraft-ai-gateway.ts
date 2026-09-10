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
   * Per-model set of ids that need the heuristic ThinkingSplitter —
   * i.e. models that concatenate their "thinking" prefix and the final
   * answer into a single `content` stream separated by a
   * `\n\s*\n\s*\n` boundary (e.g. Lorbus/Qwen3.6-27B-int4-AutoRound).
   *
   * Models NOT in this set get the default pass-through behaviour:
   * every `content` byte is yielded as `kind: 'answer'`. Reasoning
   * models that expose a separate `reasoning_content` field (e.g.
   * nemotron-auto) do NOT need the splitter — the SSE parser maps that
   * field to `kind: 'thinking'` directly, and running the heuristic
   * splitter on their plain answer text would risk corrupting it.
   */
  splitThinkingModels?: ReadonlySet<string>;
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
  // NOT readonly: the model snapshot is hot-reloadable (Phase 3.8) so
  // adding / editing / removing a model never requires a process restart.
  private allowedModels: Set<string>;
  private modelLabels: Record<string, string>;
  private readonly timeoutMs: number;
  // NOT readonly: hot-reloadable via applyModels() (Phase 3.8).
  private splitThinkingModels: ReadonlySet<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: KiwiCraftAIGatewayOptions) {
    const { endpoint, host } = resolveChatEndpoint(opts.baseUrl, opts.allowedHosts);
    this.endpoint = endpoint;
    this.host = host;
    this.apiKey = opts.apiKey;
    this.allowedModels = new Set(opts.models);
    this.modelLabels = opts.modelLabels ?? {};
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.splitThinkingModels = opts.splitThinkingModels ?? new Set<string>();
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Phase 3.8: swap the model snapshot (allowlist + labels + thinking-split
   * membership) WITHOUT restarting the process. Called by the registry when
   * the model-config file changes. The swap is atomic (single-threaded
   * event loop), so /api/models and /api/chat never observe a torn view.
   *
   * In-flight streams are untouched: a running `chat()` generator has
   * already passed its allowlist check and only reads its local copies of
   * `this.endpoint` / `this.apiKey`, which do not change here.
   */
  applyModels(models: string[], labels: Record<string, string>, splitThinkingModels: ReadonlySet<string>): void {
    this.allowedModels = new Set(models);
    this.modelLabels = { ...labels };
    this.splitThinkingModels = new Set(splitThinkingModels);
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
   * If the requested model is in `splitThinkingModels`, the raw
   * `content` stream is fed through a `ThinkingSplitter` so the
   * thinking/answer boundary inside `content` is detected and forwarded
   * as separate `kind: 'thinking'` / `kind: 'answer'` parts. Otherwise
   * every `content` byte is yielded as `kind: 'answer'` — reasoning
   * models that emit a separate `reasoning_content` field are already
   * split by the SSE parser (which maps that field to
   * `kind: 'thinking'`), so no heuristic is applied to their content.
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
    const useSplitter = this.splitThinkingModels.has(req.model);
    const splitter = useSplitter ? new ThinkingSplitter() : null;
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
          } else if (ev.kind === 'thinking') {
            // Reasoning-field models: the parser already separated the
            // chain-of-thought; forward verbatim, no heuristics.
            pendingParts.push({ kind: 'thinking', text: ev.text });
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
