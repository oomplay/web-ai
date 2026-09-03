import 'dotenv/config';

function readString(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

function readInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

/**
 * Comma-separated origin allowlist. Each entry must be a literal origin
 * (scheme + host + optional port), e.g. `https://app.example.com`. A single
 * `*` is REJECTED in production by `validateCorsConfig()` in `index.ts`.
 */
function readCorsOrigins(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Comma-separated list of upstream model ids the AI Gateway is allowed
 * to serve. Anything the client sends outside this list is rejected
 * with 404, so a misconfigured operator cannot accidentally let the
 * client route arbitrary requests to the upstream.
 */
function readModelAllowlist(name: string): string[] {
  const v = process.env[name];
  if (v === undefined || v === '') return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Comma-separated list of hostnames the AI Gateway base URL is allowed
 * to point at. This is the SSRF guard: even if the operator mistypes a
 * URL, fetch will refuse to issue a request unless the host is on this
 * list. Empty by default — providers cannot start without a match.
 */
function readHostAllowlist(name: string): string[] {
  const v = process.env[name];
  if (v === undefined || v === '') return [];
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export const config = {
  port: readInt('PORT', 8787),
  // Allowlist of origins permitted to call this API. Comma-separated.
  corsOrigins: readCorsOrigins('CORS_ORIGIN', ['http://localhost:5173']),
  mockProviderEnabled: readBool('MOCK_PROVIDER_ENABLED', true),
  // The mock provider stays available alongside the AI Gateway so the
  // application is still usable when the gateway is disabled or down.
  aiGateway: {
    enabled: readBool('AI_GATEWAY_ENABLED', false),
    baseUrl: readString('AI_GATEWAY_BASE_URL'),
    apiKey: readString('AI_GATEWAY_API_KEY'),
    models: readModelAllowlist('AI_GATEWAY_MODELS'),
    timeoutMs: readInt('AI_GATEWAY_TIMEOUT_MS', 30_000),
    allowedHosts: readHostAllowlist('AI_GATEWAY_ALLOWED_HOSTS'),
  },
  // Number of trusted reverse-proxy hops in front of this service. Set to 0
  // if the API is exposed directly to clients; set to 1 (or more) when
  // behind nginx / Cloudflare / a load balancer. `app.set('trust proxy', n)`
  // is configured from this value in `index.ts`.
  trustProxyHops: readInt('TRUST_PROXY_HOPS', 0),
  safety: {
    // Rate limits (per IP). `chat` is the expensive endpoint; `models` is
    // cheap and can be called more often. Phase 2A in-memory; swap to Redis
    // later by replacing the limiter implementation, not the route code.
    chatRateLimit: {
      windowMs: readInt('CHAT_RATE_LIMIT_WINDOW_MS', 60_000),
      max: readInt('CHAT_RATE_LIMIT_MAX', 30),
    },
    modelsRateLimit: {
      windowMs: readInt('MODELS_RATE_LIMIT_WINDOW_MS', 60_000),
      max: readInt('MODELS_RATE_LIMIT_MAX', 120),
    },
    // Per-IP concurrent SSE stream cap. A single client should never have
    // more than a small number of chats open at once.
    maxConcurrentStreamsPerIp: readInt('MAX_CONCURRENT_STREAMS_PER_IP', 3),
    // Per-IP concurrent in-flight request cap for the cheap endpoints
    // (health, models). Lower than the stream cap because these are fast.
    maxConcurrentRequestsPerIp: readInt('MAX_CONCURRENT_REQUESTS_PER_IP', 10),
    // Input bounds.
    maxMessages: readInt('MAX_MESSAGES', 100),
    maxMessageLength: readInt('MAX_MESSAGE_LENGTH', 32_000),
    maxTotalChars: readInt('MAX_TOTAL_CHARS', 200_000),
    // SSE lifecycle.
    sseIdleTimeoutMs: readInt('SSE_IDLE_TIMEOUT_MS', 30_000),
    sseMaxDurationMs: readInt('SSE_MAX_DURATION_MS', 120_000),
    sseKeepaliveMs: readInt('SSE_KEEPALIVE_MS', 15_000),
    // Outbound provider request budget (used by OpenAI-compatible provider
    // when it is implemented in Phase 2B).
    providerTimeoutMs: readInt('PROVIDER_TIMEOUT_MS', 30_000),
  },
} as const;

/** Test-only override entry point. Never call from app code at runtime. */
export function _testOverrideSafety(patch: Partial<typeof config.safety>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as any).safety = { ...config.safety, ...patch };
}

