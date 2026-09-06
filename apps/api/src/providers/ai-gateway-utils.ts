/**
 * Shared types and tiny utilities for the AI Gateway provider.
 *
 * Kept in a separate module so they can be unit-tested in isolation
 * and so the provider class file stays focused on the streaming loop.
 */

import { setTimeout as nodeSetTimeout } from 'node:timers/promises';

/**
 * Combine a route's AbortSignal with an optional timeout. The returned
 * signal aborts when EITHER source fires. `cleanup()` is idempotent and
 * safe to call multiple times — always invoke it from a `finally` block
 * so the timer never leaks.
 *
 * `cancelTimeout()` disarms ONLY the timeout timer while keeping the
 * base-signal listener attached. Callers use this for streaming
 * requests: the timeout is meant as a CONNECT budget (time to response
 * headers), after which the stream is governed by the route's SSE
 * lifecycle timers (idle / max-duration) and the client's own abort.
 * Without this, the timeout would kill long-running streams mid-flight
 * (observed: a 60s timeout aborting a healthy 60s+ generation, which
 * the upstream logs as `client_gone / context canceled`).
 */
export function composeTimeoutSignal(
  base: AbortSignal,
  timeoutMs: number | undefined,
): { signal: AbortSignal; cleanup: () => void; cancelTimeout: () => void } {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: base, cleanup: () => {}, cancelTimeout: () => {} };
  }
  const ac = new AbortController();
  const onAbort = () => ac.abort(base.reason);
  if (base.aborted) {
    ac.abort(base.reason);
  } else {
    base.addEventListener('abort', onAbort, { once: true });
  }
  // Fire-and-forget timer. We use the Node timer directly so we can
  // unref it (it must not keep the process alive).
  const t = setTimeout(() => {
    if (!ac.signal.aborted) ac.abort('provider-timeout');
  }, timeoutMs);
  // The promise reference is here so the import is used; nodeSetTimeout
  // is the dedicated helper, but we still want setTimeout for unref().
  void nodeSetTimeout;
  const cancelTimeout = () => {
    clearTimeout(t);
  };
  const cleanup = () => {
    cancelTimeout();
    base.removeEventListener('abort', onAbort);
  };
  return { signal: ac.signal, cleanup, cancelTimeout };
}

/**
 * Raised when the operator's AI Gateway configuration cannot be used.
 * Caught by the chat route and translated to a safe 500 (the real
 * message is logged server-side). Distinct from upstream errors.
 */
export class GatewayConfigError extends Error {
  readonly code = 'gateway_config';
  constructor(message: string) {
    super(message);
    this.name = 'GatewayConfigError';
  }
}

/**
 * Map an upstream HTTP error (or a network / timeout failure) to a
 * user-safe message. The real cause is logged server-side by the
 * caller; this function NEVER echoes the upstream's error text.
 */
export function safeProviderError(upstream: {
  status?: number;
  kind: 'http' | 'network' | 'timeout' | 'parse' | 'aborted';
}): string {
  switch (upstream.kind) {
    case 'aborted':
      return 'AI provider request was cancelled.';
    case 'timeout':
      return 'AI provider request timed out.';
    case 'network':
      return 'Unable to reach AI provider.';
    case 'parse':
      return 'AI provider returned an invalid response.';
    case 'http':
      switch (upstream.status) {
        case 401:
        case 403:
          return 'AI provider authentication failed.';
        case 408:
          return 'AI provider request timed out.';
        case 429:
          return 'AI provider is temporarily rate-limited.';
        default:
          if (upstream.status && upstream.status >= 500) {
            return 'AI provider is temporarily unavailable.';
          }
          return 'AI provider returned an error.';
      }
  }
}

/**
 * The result of a single SSE event pulled out of the upstream stream.
 */
export type ParsedUpstreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; text: string }
  | { kind: 'comment' }
  | { kind: 'ignore' };
