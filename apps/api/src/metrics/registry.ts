/**
 * In-process counters and gauges backing the `/api/metrics` endpoint.
 *
 * Phase 3.7-A: the four metric families required by the production
 * gate (PHASE_3_PLAN.md §5.6, PRODUCTION_DEPLOY.md §2):
 *
 *   - rate_limit_rejections_total{route}      — counter
 *   - active_streams                           — gauge
 *   - sse_aborts_total{reason}                 — counter
 *   - provider_errors_total{kind}              — counter
 *
 * Design constraints (PHASE_3_PLAN.md §3 and security model):
 *
 *   - No user content: we never accept arbitrary text as a label. The
 *     only labels that exist are enumerated in the small allowlist
 *     below; everything else is bucketed under "other" or ignored.
 *   - No API keys, no model upstream names, no conversation ids.
 *   - No web storage / no cookies: the renderer is a pure function.
 *   - Cardinality is bounded: at most 2 routes x 4 SSE reasons x 6
 *     provider kinds. Safe for long-running scrape loops.
 *
 * The in-process nature is acknowledged (PHASE_3_PLAN.md §6): a
 * multi-instance deployment must move this to a shared store. The
 * `MetricsRegistry` interface is small enough that a Redis-backed
 * drop-in is a follow-up.
 */

export type RateLimitRoute = 'chat' | 'models' | 'other';

export type SseAbortReason = 'idle' | 'max-duration' | 'client-abort' | 'other';

export type ProviderErrorKind =
  | 'http-4xx-client'
  | 'http-4xx-rate'
  | 'http-5xx'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'aborted'
  | 'other';

export interface MetricsRegistry {
  incRateLimitRejection(route: RateLimitRoute): void;
  incSseStart(): void;
  incSseEnd(): void;
  incSseAbort(reason: SseAbortReason): void;
  incProviderError(kind: ProviderErrorKind): void;
  /** Prometheus text-format snapshot. Pure function over the in-memory state. */
  render(): string;
  /** For tests only. */
  reset?(): void;
}

const RATE_LIMIT_ROUTES: readonly RateLimitRoute[] = ['chat', 'models', 'other'];
const SSE_ABORT_REASONS: readonly SseAbortReason[] = [
  'idle',
  'max-duration',
  'client-abort',
  'other',
];
const PROVIDER_ERROR_KINDS: readonly ProviderErrorKind[] = [
  'http-4xx-client',
  'http-4xx-rate',
  'http-5xx',
  'timeout',
  'network',
  'parse',
  'aborted',
  'other',
];

class InMemoryMetricsRegistry implements MetricsRegistry {
  private readonly rateLimitRejections = new Map<RateLimitRoute, number>();
  private readonly sseAborts = new Map<SseAbortReason, number>();
  private readonly providerErrors = new Map<ProviderErrorKind, number>();
  private activeStreams = 0;
  private startedTotal = 0;

  constructor() {
    for (const r of RATE_LIMIT_ROUTES) this.rateLimitRejections.set(r, 0);
    for (const r of SSE_ABORT_REASONS) this.sseAborts.set(r, 0);
    for (const k of PROVIDER_ERROR_KINDS) this.providerErrors.set(k, 0);
  }

  incRateLimitRejection(route: RateLimitRoute): void {
    const key = RATE_LIMIT_ROUTES.includes(route) ? route : 'other';
    this.rateLimitRejections.set(key, (this.rateLimitRejections.get(key) ?? 0) + 1);
  }

  incSseStart(): void {
    this.activeStreams += 1;
    this.startedTotal += 1;
  }

  incSseEnd(): void {
    // Idempotent: never go below zero even if incSseStart was missed.
    this.activeStreams = Math.max(0, this.activeStreams - 1);
  }

  incSseAbort(reason: SseAbortReason): void {
    const key = SSE_ABORT_REASONS.includes(reason) ? reason : 'other';
    this.sseAborts.set(key, (this.sseAborts.get(key) ?? 0) + 1);
  }

  incProviderError(kind: ProviderErrorKind): void {
    const key = PROVIDER_ERROR_KINDS.includes(kind) ? kind : 'other';
    this.providerErrors.set(key, (this.providerErrors.get(key) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [];
    // 1) rate_limit_rejections_total
    lines.push(
      '# HELP web_ai_rate_limit_rejections_total Total number of rate-limit rejections.',
    );
    lines.push('# TYPE web_ai_rate_limit_rejections_total counter');
    for (const route of RATE_LIMIT_ROUTES) {
      lines.push(
        `web_ai_rate_limit_rejections_total{route="${route}"} ${this.rateLimitRejections.get(route) ?? 0}`,
      );
    }
    // 2) active_streams (gauge) and a derived cumulative counter for convenience.
    lines.push(
      '# HELP web_ai_active_streams Number of SSE streams currently open.',
    );
    lines.push('# TYPE web_ai_active_streams gauge');
    lines.push(`web_ai_active_streams ${this.activeStreams}`);
    lines.push(
      '# HELP web_ai_sse_streams_started_total Total number of SSE streams started since process start.',
    );
    lines.push('# TYPE web_ai_sse_streams_started_total counter');
    lines.push(`web_ai_sse_streams_started_total ${this.startedTotal}`);
    // 3) sse_aborts_total
    lines.push(
      '# HELP web_ai_sse_aborts_total Total number of SSE streams that ended in a non-clean state.',
    );
    lines.push('# TYPE web_ai_sse_aborts_total counter');
    for (const reason of SSE_ABORT_REASONS) {
      lines.push(
        `web_ai_sse_aborts_total{reason="${reason}"} ${this.sseAborts.get(reason) ?? 0}`,
      );
    }
    // 4) provider_errors_total
    lines.push(
      '# HELP web_ai_provider_errors_total Total number of AI provider errors, bucketed by kind.',
    );
    lines.push('# TYPE web_ai_provider_errors_total counter');
    for (const kind of PROVIDER_ERROR_KINDS) {
      lines.push(
        `web_ai_provider_errors_total{kind="${kind}"} ${this.providerErrors.get(kind) ?? 0}`,
      );
    }
    // Trailing newline is conventional for text/plain Prometheus output.
    return lines.join('\n') + '\n';
  }

  reset() {
    for (const r of RATE_LIMIT_ROUTES) this.rateLimitRejections.set(r, 0);
    for (const r of SSE_ABORT_REASONS) this.sseAborts.set(r, 0);
    for (const k of PROVIDER_ERROR_KINDS) this.providerErrors.set(k, 0);
    this.activeStreams = 0;
    this.startedTotal = 0;
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  return new InMemoryMetricsRegistry();
}
