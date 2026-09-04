/**
 * Rate limiter for public endpoints.
 *
 * Phase 2A ships an in-process sliding-window implementation. The exported
 * `RateLimiter` interface is the only API the rest of the codebase depends on,
 * so a Redis-backed implementation can be swapped in later by providing a
 * class with the same shape — no changes to routes, no changes to config.
 *
 * In-memory implementation notes:
 *   - One `Map<ip, number[]>` per limiter; each value is a sorted list of
 *     recent hit timestamps (ms).
 *   - On `hit()`, we evict timestamps older than `windowMs`, then either
 *     accept the hit (append timestamp, return allow=true) or reject (return
 *     allow=false with `retryAfterMs`).
 *   - A periodic `sweep()` clears IPs whose list is empty, so the map does
 *     not grow unbounded.
 *   - The implementation is single-process: a multi-instance deployment must
 *     move this to Redis. The interface is designed to make that swap a
 *     drop-in change in `index.ts`.
 */

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  name: string;
}

export interface RateLimitDecision {
  allow: boolean;
  retryAfterMs: number;
  limit: number;
  remaining: number;
  resetMs: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitDecision;
  /** For tests only. Clears all in-memory state. */
  reset?(): void;
  /** For graceful shutdown. Stops the sweep timer. */
  stop?(): void;
}

class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly cfg: RateLimitConfig) {
    // Sweep expired entries every windowMs so the map does not grow forever.
    this.sweepTimer = setInterval(() => this.sweep(), cfg.windowMs);
    // Unref so the timer does not keep the process alive on shutdown.
    this.sweepTimer.unref?.();
  }

  hit(key: string): RateLimitDecision {
    const now = Date.now();
    const cutoff = now - this.cfg.windowMs;
    const list = this.hits.get(key) ?? [];
    // Evict expired timestamps from the head.
    let i = 0;
    while (i < list.length && list[i]! <= cutoff) i++;
    const fresh = i > 0 ? list.slice(i) : list.slice();

    if (fresh.length >= this.cfg.max) {
      const oldest = fresh[0]!;
      const resetMs = Math.max(0, oldest + this.cfg.windowMs - now);
      this.hits.set(key, fresh);
      return {
        allow: false,
        retryAfterMs: resetMs,
        limit: this.cfg.max,
        remaining: 0,
        resetMs,
      };
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return {
      allow: true,
      retryAfterMs: 0,
      limit: this.cfg.max,
      remaining: this.cfg.max - fresh.length,
      resetMs: this.cfg.windowMs,
    };
  }

  reset() {
    this.hits.clear();
  }

  stop() {
    clearInterval(this.sweepTimer);
  }

  private sweep() {
    const now = Date.now();
    const cutoff = now - this.cfg.windowMs;
    for (const [k, list] of this.hits) {
      let i = 0;
      while (i < list.length && list[i]! <= cutoff) i++;
      if (i === list.length) {
        this.hits.delete(k);
      } else if (i > 0) {
        this.hits.set(k, list.slice(i));
      }
    }
  }
}

export function createRateLimiter(cfg: RateLimitConfig): RateLimiter {
  return new InMemoryRateLimiter(cfg);
}

/**
 * Convenience: returns the headers Express should send on every response,
 * plus a `Retry-After` header when the decision is to reject.
 */
export function rateLimitHeaders(d: RateLimitDecision, cfg: RateLimitConfig): Record<string, string> {
  const h: Record<string, string> = {
    'X-RateLimit-Limit': String(d.limit),
    'X-RateLimit-Remaining': String(Math.max(0, d.remaining)),
    'X-RateLimit-Window-Ms': String(cfg.windowMs),
  };
  if (!d.allow) {
    h['Retry-After'] = String(Math.max(1, Math.ceil(d.retryAfterMs / 1000)));
  }
  return h;
}
