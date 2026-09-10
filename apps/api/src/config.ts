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
 * Optional JSON map from upstream model id to human-readable label.
 * Example: {"openai/gpt-4o-mini":"GPT-4o mini"}
 * Parsed once at boot. Malformed JSON is rejected so a typo cannot
 * silently turn every label into the raw id.
 */
function readModelLabels(name: string): Record<string, string> {
  const v = process.env[name];
  if (v === undefined || v === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw new Error(`${name} must be a valid JSON object (e.g. {"id":"Label"}).`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object of {modelId:label} pairs.`);
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val !== 'string' || val.length === 0) {
      throw new Error(`${name} entry for '${k}' must be a non-empty string.`);
    }
    out[k] = val;
  }
  return out;
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

/**
 * Per-model thinking-split configuration.
 *
 * Background: models differ in HOW they expose chain-of-thought:
 *  - Some concatenate "thinking" and "answer" into a single `content`
 *    stream separated by a `\n\s*\n\s*\n` boundary (e.g.
 *    Lorbus/Qwen3.6-27B-int4-AutoRound). These need the heuristic
 *    ThinkingSplitter.
 *  - Others expose a separate `reasoning_content` field on each delta
 *    (OpenAI-compatible reasoning models, e.g. nemotron-auto). These
 *    need NO splitter — the field type already separates them, and a
 *    heuristic splitter would corrupt their plain answer text if it
 *    ever contained a triple-newline boundary.
 *  - Others emit no reasoning at all.
 *
 * The old single boolean `AI_GATEWAY_SPLIT_THINKING` applied one mode
 * to every model, which breaks as soon as the gateway serves models
 * with different behaviours. It is replaced by a per-model map:
 *
 *   AI_GATEWAY_SPLIT_THINKING_MODELS=Lorbus/Qwen3.6-27B-int4-AutoRound
 *
 * (comma-separated model ids that need the heuristic content splitter).
 * The legacy boolean is still honoured for backward compatibility: if
 * `AI_GATEWAY_SPLIT_THINKING=true` is set, every allowlisted model is
 * treated as needing the splitter unless the per-model var is present.
 */
function readSplitThinkingModels(
  allowlist: string[],
  legacyFlag: boolean,
): Set<string> {
  const raw = process.env['AI_GATEWAY_SPLIT_THINKING_MODELS'];
  if (raw !== undefined && raw.trim() !== '') {
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // Unknown ids are rejected: a typo would otherwise silently disable
    // splitting for the intended model (fail fast at boot instead).
    for (const id of ids) {
      if (!allowlist.includes(id)) {
        throw new Error(
          `AI_GATEWAY_SPLIT_THINKING_MODELS contains '${id}', which is not in AI_GATEWAY_MODELS.`,
        );
      }
    }
    return new Set(ids);
  }
  // Legacy fallback: single global flag applies to the whole allowlist.
  return legacyFlag ? new Set(allowlist) : new Set<string>();
}

export const config = {
  port: readInt('PORT', 8787),
  // Allowlist of origins permitted to call this API. Comma-separated.
  corsOrigins: readCorsOrigins('CORS_ORIGIN', ['http://localhost:5173']),
  mockProviderEnabled: readBool('MOCK_PROVIDER_ENABLED', true),
  // Phase 3.8: path to the hot-reloadable model config file (relative to
  // the process working directory). See providers/model-config.ts. When
  // the file is absent the AI_GATEWAY_* env vars remain the fallback, so
  // existing deployments keep working unchanged.
  modelConfigFile: readString('MODEL_CONFIG_FILE', 'models.config.json'),
  // The mock provider stays available alongside the AI Gateway so the
  // application is still usable when the gateway is disabled or down.
  aiGateway: {
    enabled: readBool('AI_GATEWAY_ENABLED', false),
    baseUrl: readString('AI_GATEWAY_BASE_URL'),
    apiKey: readString('AI_GATEWAY_API_KEY'),
    models: readModelAllowlist('AI_GATEWAY_MODELS'),
    modelLabels: readModelLabels('AI_GATEWAY_MODEL_LABELS'),
    timeoutMs: readInt('AI_GATEWAY_TIMEOUT_MS', 30_000),
    allowedHosts: readHostAllowlist('AI_GATEWAY_ALLOWED_HOSTS'),
    // Per-model set of ids that need the heuristic ThinkingSplitter
    // (models that concatenate thinking + answer into one `content`
    // stream). See readSplitThinkingModels() for the format and the
    // legacy-flag fallback.
    splitThinkingModels: readSplitThinkingModels(
      readModelAllowlist('AI_GATEWAY_MODELS'),
      readBool('AI_GATEWAY_SPLIT_THINKING', false),
    ),
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

