import type { ModelInfo, Provider } from './types.js';
import { MockProvider } from './mock.js';
import { KiwiCraftAIGatewayProvider } from './kiwicraft-ai-gateway.js';

export interface Registry {
  providers: Provider[];
  resolveProvider(modelId: string): Promise<Provider | undefined>;
  listModels(): Promise<ModelInfo[]>;
}

export interface RegistryConfig {
  mockEnabled: boolean;
  aiGateway: {
    enabled: boolean;
    baseUrl?: string;
    apiKey?: string;
    models: string[];
    allowedHosts: string[];
    timeoutMs?: number;
  };
}

export function createRegistry(env: RegistryConfig): Registry {
  const providers: Provider[] = [];

  if (env.mockEnabled) {
    providers.push(new MockProvider());
  }

  // Register the AI Gateway ONLY when all four preconditions hold:
  //   1) AI_GATEWAY_ENABLED=true
  //   2) AI_GATEWAY_BASE_URL set
  //   3) AI_GATEWAY_API_KEY set
  //   4) AI_GATEWAY_MODELS has at least one entry
  // The constructor will further validate the base URL and refuse
  // private/loopback/non-https hosts. Failures are caught here and
  // logged so a misconfigured gateway does not crash the server.
  if (
    env.aiGateway.enabled &&
    env.aiGateway.baseUrl &&
    env.aiGateway.apiKey &&
    env.aiGateway.models.length > 0
  ) {
    try {
      providers.push(
        new KiwiCraftAIGatewayProvider({
          baseUrl: env.aiGateway.baseUrl,
          apiKey: env.aiGateway.apiKey,
          models: env.aiGateway.models,
          allowedHosts: env.aiGateway.allowedHosts,
          timeoutMs: env.aiGateway.timeoutMs,
        }),
      );
      // eslint-disable-next-line no-console
      console.log('[registry] AI gateway provider registered', {
        baseUrl: env.aiGateway.baseUrl,
        models: env.aiGateway.models.length,
        allowedHosts: env.aiGateway.allowedHosts,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[registry] AI gateway provider NOT registered:', err);
    }
  }

  // Map of modelId -> provider. Filled lazily from provider.listModels().
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
      return idx.get(modelId);
    },
    async listModels() {
      const all: ModelInfo[] = [];
      for (const p of providers) {
        const models = await p.listModels();
        all.push(...models);
      }
      return all;
    },
  };
}
