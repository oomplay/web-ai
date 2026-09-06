import express, { type Request, type Response, type NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import { config } from './config.js';
import { createRegistry } from './providers/registry.js';
import { healthRouter } from './routes/health.js';
import { modelsRouter } from './routes/models.js';
import { chatRouter } from './routes/chat.js';
import { errorHandler } from './middleware/error.js';
import { createRateLimiter } from './safety/rate-limit.js';
import { createConcurrencyLimiter } from './safety/concurrency.js';
import { createMetricsRegistry } from './metrics/registry.js';
import { metricsRouter } from './routes/metrics.js';

const registry = createRegistry({
  mockEnabled: config.mockProviderEnabled,
  aiGateway: {
    enabled: config.aiGateway.enabled,
    baseUrl: config.aiGateway.baseUrl,
    apiKey: config.aiGateway.apiKey,
    models: config.aiGateway.models,
    modelLabels: config.aiGateway.modelLabels,
    allowedHosts: config.aiGateway.allowedHosts,
    timeoutMs: config.aiGateway.timeoutMs,
    splitThinking: config.aiGateway.splitThinking,
  },
});

// Each limiter has a single, narrow interface so a Redis-backed
// implementation can be dropped in later by changing only this file.
const chatRateLimiter = createRateLimiter({
  name: 'chat',
  windowMs: config.safety.chatRateLimit.windowMs,
  max: config.safety.chatRateLimit.max,
});
const modelsRateLimiter = createRateLimiter({
  name: 'models',
  windowMs: config.safety.modelsRateLimit.windowMs,
  max: config.safety.modelsRateLimit.max,
});
const streamLimiter = createConcurrencyLimiter(config.safety.maxConcurrentStreamsPerIp);
const requestLimiter = createConcurrencyLimiter(config.safety.maxConcurrentRequestsPerIp);
// Single metrics registry shared by the chat route and the /api/metrics
// route. Phase 3.7-A: in-process counters only; a multi-instance
// deployment must move this to a shared store (PHASE_3_PLAN.md §6).
const metrics = createMetricsRegistry();

// CORS hardening: explicit allowlist parsed at boot. We REFUSE to start if
// the operator left the list empty or set it to '*'.
function validateCorsConfig(origins: string[]): void {
  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN must list at least one origin.');
  }
  for (const o of origins) {
    if (o === '*') {
      throw new Error(
        "CORS_ORIGIN does not allow '*'. Use a comma-separated list of explicit origins.",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(o);
    } catch {
      throw new Error(`CORS_ORIGIN contains invalid origin: '${o}'`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`CORS_ORIGIN entry must be http(s): '${o}'`);
    }
  }
}
validateCorsConfig(config.corsOrigins);

const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    // No Origin header = same-origin / curl / server-to-server: allow.
    if (!origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
};

const app = express();

// `trust proxy` MUST be set explicitly. Setting it to `true` would blindly
// trust X-Forwarded-* from any client. Operators set TRUST_PROXY_HOPS to
// the number of trusted hops in front of this service.
if (config.trustProxyHops > 0) {
  app.set('trust proxy', config.trustProxyHops);
}

// /api/metrics is mounted BEFORE the CORS middleware and BEFORE any
// rate limiters, because:
//   - it must not be reachable from a cross-origin browser context,
//   - the operator's Prometheus scrape loop must not be throttled.
app.use('/api', metricsRouter(metrics));

app.use(cors(corsOptions));
// Body size: chat is the only endpoint that needs more than a few hundred
// bytes. Per-message / total caps live in validateChatInput().
app.use(express.json({ limit: '64kb' }));

// Translate body-parser errors (e.g. PayloadTooLargeError) into clean
// JSON responses instead of the default Express HTML/500 page.
app.use((
  err: Error & { type?: string; status?: number },
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    res.status(413).json({ error: 'Request body too large.' });
    return;
  }
  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  next(err);
});

app.use('/api', healthRouter);
app.use(
  '/api',
  modelsRouter({
    registry,
    rateLimiter: modelsRateLimiter,
    rateLimitName: 'models',
    requestLimiter,
    metrics,
  }),
);
app.use(
  '/api',
  chatRouter({
    registry,
    rateLimiter: chatRateLimiter,
    rateLimitName: 'chat',
    streamLimiter,
    metrics,
    validation: {
      maxMessages: config.safety.maxMessages,
      maxMessageLength: config.safety.maxMessageLength,
      maxTotalChars: config.safety.maxTotalChars,
    },
    sse: {
      sseIdleTimeoutMs: config.safety.sseIdleTimeoutMs,
      sseMaxDurationMs: config.safety.sseMaxDurationMs,
      sseKeepaliveMs: config.safety.sseKeepaliveMs,
    },
  }),
);

// CORS rejections from the callback above arrive here. Translate the
// internal Error into a 403 JSON response so the client sees something
// honest instead of the generic 500 envelope.
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err && err.message === 'origin not allowed') {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }
  next(err);
});

app.use(errorHandler);

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[api] listening on http://localhost:${config.port} ` +
      `(mock=${config.mockProviderEnabled}, ` +
      `cors=${config.corsOrigins.join(',')}, ` +
      `trust-proxy=${config.trustProxyHops}, ` +
      `chat-limit=${config.safety.chatRateLimit.max}/${config.safety.chatRateLimit.windowMs}ms, ` +
      `concurrent-streams=${config.safety.maxConcurrentStreamsPerIp})`,
  );
  // Summarise the resolved provider set so an operator looking at the
  // boot log can tell at a glance which providers are serving traffic
  // (vs which were configured but not registered, due to missing env).
  // Listing is lazy (calls provider.listModels()) so we catch any
  // provider whose constructor succeeded but whose listModels throws.
  registry
    .listModels()
    .then((models) => {
      const byProvider = new Map<string, number>();
      for (const m of models) {
        byProvider.set(m.provider, (byProvider.get(m.provider) ?? 0) + 1);
      }
      const lines: string[] = [];
      for (const [pid, n] of byProvider) lines.push(`${pid}=${n}`);
      // eslint-disable-next-line no-console
      console.log(`[api] active providers: ${lines.join(', ') || '(none)'}`);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[api] failed to enumerate active providers', err);
    });
});

server.keepAliveTimeout = 65_000;
server.requestTimeout = 2 * 60_000;
server.headersTimeout = 70_000;

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, shutting down`);
  chatRateLimiter.stop?.();
  modelsRateLimiter.stop?.();
  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('[api] shutdown error', err);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  // eslint-disable-next-line no-console
  console.error('[api] unhandledRejection', err);
});
