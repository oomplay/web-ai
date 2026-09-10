/**
 * Reloadable model configuration — the "who can chat" registry source.
 *
 * Design (Phase 3.8 — zero-downtime model config updates):
 *
 * The model allowlist, labels, and thinking-split membership used to live
 * ONLY in `.env`, read once at boot. Adding/removing a model required a
 * full process restart, which dropped every open SSE stream and reset
 * every in-memory safety counter (rate-limit windows, concurrency caps).
 *
 * Now the model list lives in a small JSON file (`MODEL_CONFIG_FILE`,
 * default `apps/api/models.config.json`) that is:
 *   - validated on every load (fail-closed: a bad file never replaces a
 *     good running config),
 *   - watched with `fs.watch` (the process keeps running; only the model
 *     snapshot is swapped),
 *   - snapshotted atomically (readers always see a consistent view; no
 *     torn reads for /api/models or /api/chat).
 *
 * Security invariants:
 *   - The file is read from a fixed path pinned at boot. It is NOT
 *     influenced by request input in any way.
 *   - Validation is identical to the old `.env` validation (unknown
 *     thinking-split ids rejected, labels must be non-empty strings).
 *   - A failed reload keeps the last-known-good snapshot. The process
 *     never dies from a bad config file.
 *
 * No new dependency: `fs.watch` and `fs.readFile` are Node built-ins.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ModelConfig {
  /** Allowlisted upstream model ids exposed via /api/models. */
  models: string[];
  /** Optional human-readable labels keyed by model id. */
  labels: Record<string, string>;
  /** Model ids that need the heuristic ThinkingSplitter. */
  splitThinkingModels: ReadonlySet<string>;
}

export interface ModelConfigSource {
  /** Read the current snapshot. Always a complete, validated config. */
  get(): ModelConfig;
  /** Register a listener invoked after a successful reload. */
  onChange(listener: (config: ModelConfig) => void): () => void;
  /** Stop watching the file. Called on shutdown (and tests). */
  stop(): void;
}

/** Shape + content validation. Throws with an operator-readable message. */
export function validateModelConfig(raw: unknown): ModelConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Model config must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  const models = obj['models'];
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error(
      'Model config field "models" must be a non-empty array of model-id strings.',
    );
  }
  const seen = new Set<string>();
  for (const m of models) {
    if (typeof m !== 'string' || m.trim().length === 0) {
      throw new Error('Model config field "models" must contain non-empty strings.');
    }
    if (seen.has(m)) {
      throw new Error(`Model config field "models" contains duplicate id '${m}'.`);
    }
    seen.add(m);
  }

  const labelsRaw = obj['labels'] ?? {};
  if (!labelsRaw || typeof labelsRaw !== 'object' || Array.isArray(labelsRaw)) {
    throw new Error('Model config field "labels" must be an object of {id: label}.');
  }
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(labelsRaw as Record<string, unknown>)) {
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`Model config field "labels" entry for '${k}' must be a non-empty string.`);
    }
    if (!seen.has(k)) {
      throw new Error(
        `Model config field "labels" contains '${k}', which is not in "models".`,
      );
    }
    labels[k] = v;
  }

  const splitRaw = obj['splitThinkingModels'] ?? [];
  if (!Array.isArray(splitRaw)) {
    throw new Error('Model config field "splitThinkingModels" must be an array of model ids.');
  }
  const split = new Set<string>();
  for (const id of splitRaw) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Model config field "splitThinkingModels" must contain non-empty strings.');
    }
    if (!seen.has(id)) {
      throw new Error(
        `Model config field "splitThinkingModels" contains '${id}', which is not in "models".`,
      );
    }
    split.add(id);
  }

  return { models: models as string[], labels, splitThinkingModels: split };
}

/**
 * Parse the file content into a validated ModelConfig.
 * Exported for tests / the verify harness.
 */
export function parseModelConfig(content: string): ModelConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      'Model config file is not valid JSON: ' + (err instanceof Error ? err.message : String(err)),
    );
  }
  return validateModelConfig(parsed);
}

const WATCH_DEBOUNCE_MS = 250;

/**
 * Create a file-backed ModelConfigSource.
 *
 * `fallback` is the config derived from the legacy `.env` vars; it is used
 * (a) before the first successful read, (b) permanently if the file is
 * missing entirely, and (c) if a reload fails (last-known-good wins).
 */
export function createFileModelConfigSource(
  filePath: string,
  fallback: ModelConfig,
): ModelConfigSource & { reload(): boolean } {
  let current: ModelConfig = fallback;
  const listeners = new Set<(config: ModelConfig) => void>();
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  function readFromFile(): ModelConfig {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseModelConfig(content);
  }

  /**
   * Re-read the file. Returns true if the in-memory snapshot changed.
   * Failure modes are logged and swallowed: the running snapshot stays.
   */
  function reload(): boolean {
    if (stopped) return false;
    let next: ModelConfig;
    try {
      next = readFromFile();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[model-config] reload failed; keeping previous config', {
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    if (
      next.models.length === current.models.length &&
      next.models.every((m, i) => m === current.models[i]) &&
      JSON.stringify(next.labels) === JSON.stringify(current.labels) &&
      setEquals(next.splitThinkingModels, current.splitThinkingModels)
    ) {
      return false; // no-op change; do not churn listeners
    }
    current = next;
    for (const l of listeners) {
      try {
        l(current);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[model-config] listener error', err);
      }
    }
    return true;
  }

  function scheduleReload(): void {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      reload();
    }, WATCH_DEBOUNCE_MS);
  }

  function startWatch(): void {
    // fs.watch is best-effort across platforms (inotify on Linux, ReadDirectoryChangesW
    // on Windows, kqueue/FSEvents on macOS). If the underlying FS does not support
    // it (or the file is on a network mount), we degrade to no live watch — the
    // snapshot from boot (or the fallback) keeps serving, and SIGHUP remains the
    // manual override.
    try {
      watcher = fs.watch(filePath, { persistent: false }, () => scheduleReload());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[model-config] fs.watch unavailable; falling back to boot-time config', {
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
        hint: 'Use `kill -HUP <pid>` to reload manually.',
      });
      watcher = null;
    }
  }

  // Initial load: if the file exists and is valid, it wins over the env
  // fallback; if it is missing or invalid, keep the fallback and say why.
  try {
    current = readFromFile();
    // eslint-disable-next-line no-console
    console.log('[model-config] loaded model config file', {
      file: filePath,
      models: current.models.length,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(
        `[model-config] ${filePath} not found; using AI_GATEWAY_MODELS from the environment`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        '[model-config] model config file is invalid; using AI_GATEWAY_MODELS from the environment',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  startWatch();

  return {
    get: () => current,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
    reload,
  };
}

function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Convert the legacy boot-time `.env`-derived settings into the fallback
 * snapshot used when the file is absent. Throwing on bad env vars is kept
 * (boot-fail) so a typo cannot silently boot with an empty allowlist.
 */
export function modelConfigFromEnv(
  envModels: string[],
  envLabels: Record<string, string>,
  envSplit: ReadonlySet<string>,
): ModelConfig {
  return {
    models: [...envModels],
    labels: { ...envLabels },
    splitThinkingModels: new Set(envSplit),
  };
}

/** Resolve the config file path, relative to the process CWD. */
export function resolveModelConfigPath(configuredPath: string | undefined): string {
  return path.resolve(configuredPath ?? 'models.config.json');
}
