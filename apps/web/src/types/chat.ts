export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /**
   * Optional chain-of-thought prefix, only present for models whose
   * provider separates reasoning from the final answer (e.g. via
   * `AI_GATEWAY_SPLIT_THINKING=true`). When present, the UI renders
   * this in a collapsible panel above `content`. When absent, the
   * message is rendered as a single bubble exactly like before.
   */
  thinking?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}
