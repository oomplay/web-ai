import type { ChatRequest, ModelInfo, Provider } from './types.js';
import {
  type ParsedUpstreamEvent,
  composeTimeoutSignal,
  safeProviderError,
  GatewayConfigError,
} from './ai-gateway-utils.js';
import { resolveChatEndpoint } from './ai-gateway-ssrf.js';
import { parseUpstreamEvent } from './ai-gateway-sse.js';

export interface KiwiCraftAIGatewayOptions {
  baseUrl: string;
  apiKey: string;
  models: string[];
  allowedHosts: string[];
  timeoutMs?: number;
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
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: KiwiCraftAIGatewayOptions) {
    const { endpoint, host } = resolveChatEndpoint(opts.baseUrl, opts.allowedHosts);
    this.endpoint = endpoint;
    this.host = host;
    this.apiKey = opts.apiKey;
    this.allowedModels = new Set(opts.models);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async listModels(): Promise<ModelInfo[]> {
    return Array.from(this.allowedModels).map((m) => ({
      id: m,
      label: m,
      provider: this.id,
    }));
  }

  /**
   * Stream chat completions from the upstream. Yields plain text deltas;
   * the route wraps each one in a `data: {"delta":"..."}` frame. Throws
   * on upstream errors (the route maps them to a sanitised SSE error
   * event).
   */
  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    if (!this.allowedModels.has(req.model)) {
      throw new GatewayConfigError(
        `Model '${req.model}' is not in AI_GATEWAY_MODELS.`,
      );
    }
    const { signal: composed, cleanup } = composeTimeoutSignal(signal, this.timeoutMs);
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
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let upstreamErrored = false;
    let userError: string | null = null;
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
            yield ev.text;
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
      }
      // Drain any trailing partial event.
      if (!composed.aborted && !upstreamErrored) {
        const trailing = buffer.trim();
        if (trailing) {
          const ev = parseUpstreamEvent(trailing);
          if (ev.kind === 'delta') yield ev.text;
        }
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
