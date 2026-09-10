import type { ModelInfo, Provider } from './types.js';
import { MockProvider } from './mock.js';
import { KiwiCraftAIGatewayProvider } from './kiwicraft-ai-gateway.js';
import type { ModelConfig, ModelConfigSource } from './model-config.js';

export interface Registry {
  providers: Provider[];
  resolveProvider(modelId: string): Promise<Provider | undefined>;
  listModels(): Promise<ModelInfo[]>;
  /**
   * Phase 3.8: stop the registry (closes the model-config file watcher).
   * Called once on process shutdown.
   */
  stop(): void;
}

export interface RegistryConfig {
  mockEnabled: boolean;
  aiGateway: {
    enabled: boolean;
    baseUrl?: string;
    apiKey?: string;
    /**
     * Phase 3.8: live model-config source. When present, the registry
     * re-derives the gateway's model snapshot (and re-registers the
     * provider if required) on every config change — no process restart.
     * When absent, the legacy boot-time values below are used and the
     * registry is static.
     */
    modelConfigSource?: ModelConfigSource;
    /** Legacy boot-time values (used when modelConfigSource is absent). */
    models?: string[];
    modelLabels?: Record<string, string>;
    allowedHosts: string[];
    timeoutMs?: number;
    /** Legacy boot-time thinking-split membership (static mode only). */
    splitThinkingModels?: ReadonlySet<string>;
  };
}

/**
 * Phase 3.8: hot-swappable registry.
 *
 * Previously the provider list was decided once at boot from `.env`, so
 * any model add/edit/remove required a process restart — which dropped
 * every open SSE stream and reset every in-memory safety counter.
 *
 * Now the model snapshot comes from a ModelConfigSource (file-backed with
 * fs.watch). On each change:
 *   - If the gateway provider is already registered, the new snapshot is
 *     pushed INTO the running provider via `onModelsUpdated` — the same
 *     object keeps serving, so in-flight streams are untouched.
 *   - If the snapshot changed from empty to non-empty and the provider
 *     was NOT registered at boot (models were the missing precondition),
 *     the provider is registered on the fly.
 *   - A snapshot that becomes empty keeps the previously registered
 *     provider but exposes zero models (listModels() -> []). This is the
 *     fail-closed direction: removing all models must not silently
 *     resurrect an unregistered provider on a later add.
 *
 * In-flight streams are NEVER aborted by a config change: an active
 * `provider.chat()` generator holds a closure reference to the old
 * snapshot only for its `allowedModels.has(req.model)` check, which
 * already ran. The upstream fetch and the SSE writer are unaffected.
 */
export function createRegistry(env: RegistryConfig): Registry {
  const providers: Provider[] = [];
  let gatewayProvider: KiwiCraftAIGatewayProvider | null = null;

  if (env.mockEnabled) {
    providers.push(new MockProvider());
  }

  const source = env.aiGateway.modelConfigSource;
  const staticModels = env.aiGateway.models ?? [];
  const staticLabels = env.aiGateway.modelLabels ?? {};
  const staticSplit = env.aiGateway.splitThinkingModels ?? new Set<string>();

  /**
   * Build (or re-build) the gateway provider. Called at boot and, when
   * the provider was not registered at boot, on config changes that make
   * registration possible.
   */
  function registerGateway(config: ModelConfig): void {
    if (
      !env.aiGateway.enabled ||
      !env.aiGateway.baseUrl ||
      !env.aiGateway.apiKey ||
      config.models.length === 0
    ) {
      return;
    }
    try {
      const provider = new KiwiCraftAIGatewayProvider({
        baseUrl: env.aiGateway.baseUrl,
        apiKey: env.aiGateway.apiKey,
        models: config.models,
        modelLabels: config.labels,
        allowedHosts: env.aiGateway.allowedHosts,
        timeoutMs: env.aiGateway.timeoutMs,
        splitThinkingModels: config.splitThinkingModels,
      });
      providers.push(provider);
      gatewayProvider = provider;
      // eslint-disable-next-line no-console
      console.log('[registry] AI gateway provider registered', {
        baseUrl: env.aiGateway.baseUrl,
        models: config.models.length,
        allowedHosts: env.aiGateway.allowedHosts,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[registry] AI gateway provider NOT registered:', err);
    }
  }

  if (source) {
    // Hot-reload mode: derive the initial snapshot from the source (which
    // itself falls back to the env-derived config when the file is
    // missing) and subscribe to changes.
    registerGateway(source.get());
    source.onChange((config) => {
      // Any change invalidates the model->provider index; it is rebuilt
      // lazily from the CURRENT provider state on the next lookup.
      modelIndex = null;
      if (gatewayProvider) {
        // Fast path: swap the snapshot inside the running provider. No
        // re-registration, no new fetch stack, no dropped streams.
        gatewayProvider.applyModels(config.models, config.labels, config.splitThinkingModels);
        // eslint-disable-next-line no-console
        console.log('[registry] AI gateway model config reloaded', {
          models: config.models.length,
        });
        return;
      }
      // Slow path: provider was not registered at boot (e.g. the file
      // was empty / missing). Try to register with the new snapshot.
      registerGateway(config);
    });
  } else {
    // Legacy static mode (tests / programmatic use without the file source).
    registerGateway({
      models: staticModels,
      labels: staticLabels,
      splitThinkingModels: staticSplit,
    });
  }

  // Map of modelId -> provider. Filled lazily from provider.listModels().
  // Invalidated on every hot reload so added/removed models are reflected
  // immediately in resolveProvider().
  let modelIndex: Map<string, Provider> | null = null;
  async function getIndex(): Promise<Map<string, Provider>> {
    if (modelIndex) return modelIndex;
    const idx = new Map<string, Provider>();
    for (const p of providers) {
      const models = await p.listModels();
      for (const m of models) idx.set(m.id, p);
    }
    modelIndex = idx;
    return idx;
  }

  return {
    providers,
    async resolveProvider(modelId: string) {
      const idx = await getIndex();
      const found = idx.get(modelId);
      if (found) return found;
      // Phase 3.8: the lazy index is a boot-time snapshot. After a hot
      // reload the newly added models are not in it, so fall back to a
      // live scan across the (current) provider list.
      for (const p of providers) {
        const models = await p.listModels();
        if (models.some((m) => m.id === modelId)) return p;
      }
      return undefined;
    },
    async listModels() {
      // Always live: after a hot reload the cache would be stale.
      const all: ModelInfo[] = [];
      for (const p of providers) {
        const models = await p.listModels();
        all.push(...models);
      }
      return all;
    },
    stop() {
      source?.stop();
    },
  };
}
