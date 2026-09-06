export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
}

/**
 * A single piece of streamed output from a provider.
 *
 * Providers that do not split reasoning from the final answer MUST yield
 * only `kind: 'answer'` parts. Providers that do (e.g. the KiwiCraft
 * gateway with `splitThinking: true`) may yield `kind: 'thinking'`
 * parts followed by `kind: 'answer'` parts; the route forwards them
 * as separate SSE events so the frontend can render them in a
 * collapsible panel.
 */
export interface StreamPart {
  kind: 'thinking' | 'answer';
  text: string;
}

export interface Provider {
  readonly id: string;
  listModels(): Promise<ModelInfo[]>;
  /**
   * Streams assistant tokens for the given request.
   * Implementations must respect `signal` and stop yielding when it aborts.
   */
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamPart>;
}
