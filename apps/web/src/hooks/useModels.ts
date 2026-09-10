import { useSyncExternalStore } from 'react';
import { fetchModels } from '../lib/api';
import type { ModelInfo } from '../types/provider';

/**
 * Single owner of the `/api/models` resource.
 *
 * Both consumers — App (provider label for the disclosure filler) and
 * ModelSelector (dropdown options + Retry button) — subscribe to this one
 * store, so they can never disagree: there is exactly one in-flight fetch,
 * one retry policy, and one cached list.
 *
 * Behavior (union of the two consumers' previous policies, nothing removed):
 *  - Fetch starts when the first consumer subscribes.
 *  - While the list has not loaded, a failed fetch is retried every
 *    RETRY_INTERVAL_MS (a transient backend blip at page load must not
 *    degrade the whole session). The interval stops on first success.
 *  - `retry()` (the ModelSelector Retry button) triggers an immediate load.
 *
 * Page-lifetime resource: the store is a module singleton and is never torn
 * down — the root App never unmounts, so this matches the old unmount-abort
 * semantics without extra machinery.
 */
const RETRY_INTERVAL_MS = 15_000;

interface ModelsState {
  /** `null` until the first successful fetch. */
  models: ModelInfo[] | null;
  loading: boolean;
  error: string | null;
}

let state: ModelsState = { models: null, loading: false, error: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setInterval> | undefined;

function setState(patch: Partial<ModelsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function stopRetrying() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = undefined;
  }
}

function startRetrying() {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    if (!state.models && !state.loading) void load();
  }, RETRY_INTERVAL_MS);
}

async function load(): Promise<void> {
  controller?.abort();
  const ac = new AbortController();
  controller = ac;
  setState({ loading: true, error: null });
  try {
    const models = await fetchModels(ac.signal);
    if (ac.signal.aborted) return;
    stopRetrying();
    setState({ models, loading: false, error: null });
  } catch (e) {
    if (ac.signal.aborted) return;
    setState({ loading: false, error: (e as Error).message });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && !state.models && !state.loading) {
    void load();
    startRetrying();
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Immediate manual retry (ModelSelector's Retry button). */
export function retryModels(): void {
  void load();
  startRetrying();
}

export function useModels(): ModelsState {
  return useSyncExternalStore(subscribe, () => state);
}
