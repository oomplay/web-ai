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
  /**
   * Drop `fromMessageId` and everything after it in the conversation.
   * Mutation-only (void). Used by `regenerate` to remove the stale
   * assistant reply after the prompt has been captured.
   */
  onTruncateFrom: (conversationId: string, fromMessageId: string) => void;
}

export interface UseChatResult {
  isStreaming: boolean;
  error: string | null;
  send: (content: string) => void;
  /** Re-stream the reply for an existing assistant message. */
  regenerate: (assistantMessageId: string) => void;
  stop: () => void;
}

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

function toHistory(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter((m): m is ChatMessage & HistoryMessage => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
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

  // Shared streaming body for `send` and `regenerate`: streams into a
  // freshly appended assistant message and finalizes it on every exit
  // path (done / error / aborted / unexpected cut).
  const runStream = (conv: Conversation, history: HistoryMessage[]) => {
    const a = argsRef.current;
    const assistantMsg = a.onAppendMessage(conv.id, {
      role: 'assistant',
      content: '',
    });

    setError(null);
    setIsStreaming(true);

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

    const history: HistoryMessage[] = [
      ...toHistory(conv.messages),
      { role: 'user', content: trimmed },
    ];
    runStream(conv, history);
  };

  // Regenerate: remove the assistant reply (and anything after it), then
  // re-stream using the history up to and including the preceding user
  // prompt. The prompt is derived from the CURRENT conversation snapshot
  // BEFORE truncation (truncateFrom is mutation-only; its state update
  // is not readable back). Regenerating a reply that is not the last
  // message destroys the turns after it — destructive cuts require the
  // app's standard `confirm()` first; cancelling leaves the conversation
  // completely untouched.
  const regenerate = (assistantMessageId: string) => {
    const a = argsRef.current;
    const conv = a.active;
    if (!conv || isStreaming) return;
    const idx = conv.messages.findIndex((m) => m.id === assistantMessageId);
    if (idx === -1) return;
    let promptIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (conv.messages[i]?.role === 'user') {
        promptIdx = i;
        break;
      }
    }
    if (promptIdx === -1) return;
    const prompt = conv.messages[promptIdx]!;
    // Destructive? Anything after the reply being regenerated would be
    // permanently removed — including persisted localStorage history.
    if (idx < conv.messages.length - 1) {
      const lost = conv.messages.length - 1 - idx;
      const ok = window.confirm(
        `Regenerating this message will remove the ${lost} message${lost === 1 ? '' : 's'} after it. Continue?`,
      );
      if (!ok) return;
    }
    const history: HistoryMessage[] = [
      ...toHistory(conv.messages.slice(0, promptIdx)),
      { role: 'user', content: prompt.content },
    ];
    a.onTruncateFrom(conv.id, assistantMessageId);
    runStream(conv, history);
  };

  return { isStreaming, error, send, regenerate, stop };
}
