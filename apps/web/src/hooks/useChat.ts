import { useCallback, useRef, useState } from 'react';
import { streamChat } from '../lib/api';
import type { ChatMessage, Conversation } from '../types/chat';

export interface UseChatArgs {
  model: string;
  active: Conversation | undefined;
  onCreateConversation: () => Conversation;
  onAppendMessage: (
    conversationId: string,
    msg: Omit<ChatMessage, 'id' | 'createdAt'>,
  ) => ChatMessage;
  onUpdateLastMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void;
}

export interface UseChatResult {
  isStreaming: boolean;
  error: string | null;
  send: (content: string) => void;
  stop: () => void;
}

export function useChat(args: UseChatArgs): UseChatResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Keep the latest args in a ref so the imperative `send` callback below can
  // read the freshest values without re-creating itself on every render.
  // Without this, `args` is a brand-new object every time the parent re-renders
  // (which it does on every streaming delta, because `active` is recomputed),
  // and that would invalidate `useCallback([args, isStreaming])`, creating a
  // new `send` reference and triggering downstream re-renders / effects.
  const argsRef = useRef(args);
  argsRef.current = args;

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  // `send` is intentionally NOT wrapped in useCallback: it reads the latest
  // args via argsRef and reads isStreaming from the current closure, so its
  // identity does not need to be stable. The function is invoked from a button
  // click handler (in MessageInput) and from a programmatic caller; neither
  // depends on `send` reference identity.
  const send = (content: string) => {
    const a = argsRef.current;
    const trimmed = content.trim();
    if (!trimmed || isStreaming) return;

    // Ensure we have a conversation to write into.
    const conv = a.active ?? a.onCreateConversation();

    a.onAppendMessage(conv.id, { role: 'user', content: trimmed });
    const assistantMsg = a.onAppendMessage(conv.id, {
      role: 'assistant',
      content: '',
    });

    setError(null);
    setIsStreaming(true);

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...conv.messages
        .filter((m): m is typeof m & { role: 'user' | 'assistant' } =>
          m.role === 'user' || m.role === 'assistant',
        )
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: trimmed },
    ];

    const handle = streamChat({ model: a.model, messages: history });
    abortRef.current = handle.abort;

    (async () => {
    let accAnswer = '';
    let accThinking = '';
    let settled = false;
    try {
      for await (const ev of handle.events) {
        if (ev.type === 'thinking') {
          accThinking += ev.text;
          a.onUpdateLastMessage(conv.id, assistantMsg.id, {
            thinking: accThinking,
            content: accAnswer,
          });
        } else if (ev.type === 'answer' || ev.type === 'delta') {
          accAnswer += ev.text;
          a.onUpdateLastMessage(conv.id, assistantMsg.id, {
            thinking: accThinking,
            content: accAnswer,
          });
        } else if (ev.type === 'error') {
          settled = true;
          setError(ev.message);
          // Keep the streamed prefix visible and append the error note.
          const errSuffix = accAnswer
            ? `\n\n_Error: ${ev.message}_`
            : `_Error: ${ev.message}_`;
          a.onUpdateLastMessage(conv.id, assistantMsg.id, {
            thinking: accThinking,
            content: accAnswer + errSuffix,
          });
          break;
        } else if (ev.type === 'aborted') {
          // The user pressed Stop (fetch threw AbortError). Intentional
          // cancel — not a connection failure. Finalize with a neutral
          // note instead of the misleading "stream ended" warning.
          settled = true;
          const suffix = accAnswer
            ? '\n\n_⏹ Stopped by user._'
            : '_⏹ Stopped by user before an answer was generated._';
          a.onUpdateLastMessage(conv.id, assistantMsg.id, {
            thinking: accThinking,
            content: accAnswer + suffix,
          });
          break;
        } else if (ev.type === 'done') {
          settled = true;
          break;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!settled) {
        // Stream ended without an explicit 'done', 'error' or 'aborted'
        // event: a genuine unexpected cut (network drop, backend restart,
        // proxy timeout). This is NOT a user stop, so the message must
        // say the connection was lost — previously this path reused the
        // same text as a user-initiated stop, which misled users into
        // thinking they had cancelled it themselves.
        //
        // This includes the thinking-only case: without a visible note
        // here, the bubble would finalize with empty content and render
        // as blank space below the ThinkingPanel.
        const suffix = accAnswer
          ? '\n\n_⚠️ Connection lost while responding. Please try again._'
          : '_⚠️ Connection lost before an answer was generated. Please try again._';
        a.onUpdateLastMessage(conv.id, assistantMsg.id, {
          thinking: accThinking,
          content: accAnswer + suffix,
        });
      }
      abortRef.current = null;
      setIsStreaming(false);
    }
    })();
  };

  return { isStreaming, error, send, stop };
}
