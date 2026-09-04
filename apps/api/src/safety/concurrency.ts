/**
 * Per-key (typically per-IP) concurrent request counter.
 *
 * Used to cap the number of SSE streams one client can have open at the same
 * time. Without this, a single IP can open thousands of long-lived
 * connections and exhaust file descriptors / memory.
 *
 * The `release()` function is idempotent: calling it twice for the same key
 * is a no-op. This matters because the same stream path can exit via three
 * routes (normal completion, client abort, provider error) and we want the
 * counter to be decremented exactly once no matter which one fires first.
 */

export interface ConcurrencyLimiter {
  /** Returns true if the slot was acquired, false if at the cap. */
  acquire(key: string): boolean;
  /** Idempotent decrement. Safe to call multiple times. */
  release(key: string): void;
  /** Read-only view of the current count for a key (mainly for tests). */
  current(key: string): number;
  /** For tests only. */
  reset?(): void;
}

class InMemoryConcurrencyLimiter implements ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();
  private readonly released = new WeakSet<object>();

  constructor(private readonly max: number) {}

  acquire(key: string): boolean {
    const cur = this.counts.get(key) ?? 0;
    if (cur >= this.max) return false;
    this.counts.set(key, cur + 1);
    return true;
  }

  release(key: string): void {
    const cur = this.counts.get(key);
    if (!cur) return;
    if (cur <= 1) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, cur - 1);
    }
  }

  current(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  reset() {
    this.counts.clear();
  }
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  return new InMemoryConcurrencyLimiter(max);
}
