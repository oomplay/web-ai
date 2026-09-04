import { Router, type Request, type Response } from 'express';
import type { Registry } from '../providers/registry.js';
import type { ChatRequest } from '../providers/types.js';
import type { config as AppConfig } from '../config.js';
import type { ConcurrencyLimiter } from '../safety/concurrency.js';
import type { RateLimiter } from '../safety/rate-limit.js';
import { rateLimitHeaders } from '../safety/rate-limit.js';
import { clientIp, validateChatInput } from '../safety/validation.js';
import type { MetricsRegistry } from '../metrics/registry.js';

type SafetyConfig = (typeof AppConfig)['safety'];

export interface ChatRouterDeps {
  registry: Registry;
  rateLimiter: RateLimiter;
  rateLimitName: string;
  streamLimiter: ConcurrencyLimiter;
  metrics: MetricsRegistry;
  validation: Pick<SafetyConfig, 'maxMessages' | 'maxMessageLength' | 'maxTotalChars'>;
  sse: Pick<SafetyConfig, 'sseIdleTimeoutMs' | 'sseMaxDurationMs' | 'sseKeepaliveMs'>;
}

export function chatRouter(deps: ChatRouterDeps): Router {
  const { registry, rateLimiter, rateLimitName, streamLimiter, sse, metrics } = deps;
  const router = Router();

  router.post('/chat', async (req: Request, res: Response) => {
    const ip = clientIp(req);

    // 1) Rate limit (cheap, no body parsing needed).
    const rl = rateLimiter.hit(ip);
    for (const [k, v] of Object.entries(
      rateLimitHeaders(rl, { windowMs: 0, max: rl.limit, name: rateLimitName }),
    )) {
      res.setHeader(k, v);
    }
    if (!rl.allow) {
      metrics.incRateLimitRejection('chat');
      res.status(429).json({ error: 'Too many requests.' });
      return;
    }

    // 2) Per-IP concurrent SSE stream cap. Acquire BEFORE doing any heavy
    //    work, release on every exit path.
    if (!streamLimiter.acquire(ip)) {
      metrics.incRateLimitRejection('chat');
      res.status(429).json({ error: 'Too many concurrent streams.' });
      return;
    }
    metrics.incSseStart();
    let slotReleased = false;
    const releaseSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      streamLimiter.release(ip);
      metrics.incSseEnd();
    };

    // 3) Input validation (rejects `system`, oversize messages, etc).
    const v = validateChatInput(req.body, deps.validation);
    if (!v.ok) {
      releaseSlot();
      res.status(v.status).json({ error: v.reason });
      return;
    }
    const model = String((req.body as { model?: unknown }).model ?? '');

    // 4) Resolve provider.
    const provider = await registry.resolveProvider(model);
    if (!provider) {
      releaseSlot();
      res.status(404).json({ error: 'Unknown model.' });
      return;
    }

    const chatReq: ChatRequest = { model, messages: v.messages, stream: true };

    // 5) SSE headers.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 6) Three abort sources, all OR-ed into one controller so the
    //    provider and the SSE writer see the same `aborted` flag:
    //      a) client disconnect / socket close
    //      b) idle timeout (no event written for N ms)
    //      c) hard max-duration ceiling
    const ac = new AbortController();
    let idleTimer: NodeJS.Timeout | null = null;
    let maxTimer: NodeJS.Timeout | null = null;
    let keepalive: NodeJS.Timeout | null = null;

    const clearAllTimers = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (keepalive) clearInterval(keepalive);
      idleTimer = null;
      maxTimer = null;
      keepalive = null;
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        metrics.incSseAbort('idle');
        ac.abort('idle');
      }, sse.sseIdleTimeoutMs);
    };
    maxTimer = setTimeout(() => {
      metrics.incSseAbort('max-duration');
      ac.abort('max-duration');
    }, sse.sseMaxDurationMs);

    req.on('close', () => {
      if (!ac.signal.aborted) {
        ac.abort('client-disconnect');
        metrics.incSseAbort('client-abort');
      }
    });

    // 7) Writer — never throws, never writes after end, never leaks
    //    provider error text to the wire.
    const writeEvent = (data: unknown): boolean => {
      if (res.writableEnded || ac.signal.aborted) return false;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch {
        metrics.incSseAbort('other');
        ac.abort('write-failed');
        return false;
      }
    };
    const writeComment = (text: string): void => {
      if (res.writableEnded || ac.signal.aborted) return;
      try {
        res.write(`: ${text}\n\n`);
      } catch {
        metrics.incSseAbort('other');
        ac.abort('write-failed');
      }
    };

    // 8) Keepalive — SSE comment line, which is part of the SSE spec and
    //    is ignored by event consumers. Resets the idle timer because
    //    sending bytes counts as activity.
    keepalive = setInterval(() => {
      writeComment('keepalive ' + Date.now());
      armIdle();
    }, sse.sseKeepaliveMs);
    armIdle();

    let userError: string | null = null;
    try {
      for await (const piece of provider.chat(chatReq, ac.signal)) {
        if (ac.signal.aborted) break;
        if (!writeEvent({ delta: piece })) break;
        armIdle();
      }
      if (!ac.signal.aborted) {
        res.write('data: [DONE]\n\n');
      }
    } catch (err) {
      // Sanitize: never leak provider error text. Server-side log keeps
      // the real cause for operators; the message returned to the client
      // is whatever the provider threw through safeProviderError(),
      // which is already user-safe. If for any reason the error is not
      // an Error instance, fall back to a generic message.
      // Phase 3.7-A: increment the matching provider_errors_total bucket
      // before sanitising. We only look at the error's `kind` and `status`
      // (not the message), so the label is never derived from user content.
      const meta = (err as { kind?: string; status?: number } | null) ?? null;
      if (meta) {
        if (meta.kind === 'aborted') {
          metrics.incProviderError('aborted');
        } else if (meta.kind === 'timeout') {
          metrics.incProviderError('timeout');
        } else if (meta.kind === 'network') {
          metrics.incProviderError('network');
        } else if (meta.kind === 'parse') {
          metrics.incProviderError('parse');
        } else if (meta.kind === 'http') {
          if (meta.status === 429) metrics.incProviderError('http-4xx-rate');
          else if (meta.status && meta.status >= 400 && meta.status < 500)
            metrics.incProviderError('http-4xx-client');
          else if (meta.status && meta.status >= 500) metrics.incProviderError('http-5xx');
          else metrics.incProviderError('other');
        } else {
          metrics.incProviderError('other');
        }
      } else {
        metrics.incProviderError('other');
      }
      // eslint-disable-next-line no-console
      console.error('[api] chat provider error', {
        ip,
        model,
        message: err instanceof Error ? err.message : String(err),
      });
      userError =
        err instanceof Error && err.message
          ? err.message
          : 'Provider error.';
    } finally {
      clearAllTimers();
      if (userError) writeEvent({ error: userError });
      try {
        res.end();
      } catch {
        /* socket already gone */
      }
      releaseSlot();
    }
  });

  return router;
}
