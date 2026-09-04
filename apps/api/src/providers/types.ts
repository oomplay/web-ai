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

export interface Provider {
  readonly id: string;
  listModels(): Promise<ModelInfo[]>;
  /**
   * Streams assistant tokens for the given request.
   * Implementations must respect `signal` and stop yielding when it aborts.
   */
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string>;
}
