import { useMemo } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { EmptyState } from './EmptyState';
import { BottomAdPanel } from '../ads';
import type { Conversation } from '../../types/chat';

interface Props {
  active: Conversation | undefined;
  model: string;
  onModelChange: (id: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  streamingMessageId?: string;
  providerName?: string;
}

export function ChatWindow({
  active,
  model,
  onModelChange,
  onSend,
  onStop,
  isStreaming,
  streamingMessageId,
  providerName,
}: Props) {
  const lastAssistantId = useMemo(() => {
    if (!active) return undefined;
    for (let i = active.messages.length - 1; i >= 0; i--) {
      const m = active.messages[i];
      if (m && m.role === 'assistant') return m.id;
    }
    return undefined;
  }, [active]);

  // The "real" streaming message id only applies while a stream is in
  // flight. The `lastAssistantId` fallback exists purely for the case
  // where the assistant bubble exists but has no content yet (e.g. the
  // model is still emitting `thinking` deltas) — it must NEVER mark a
  // finished message as streaming, otherwise the ThinkingPanel keeps
  // saying "Thinking…" and the typing cursor blinks forever after the
  // stream has ended.
  const effectiveStreamingMessageId = useMemo(() => {
    if (!isStreaming) return undefined;
    return streamingMessageId ?? lastAssistantId;
  }, [isStreaming, streamingMessageId, lastAssistantId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="thin-scroll flex-1 overflow-y-auto">
        {!active || active.messages.length === 0 ? (
          <EmptyState onSuggest={onSend} />
        ) : (
          <>
            <div className="mx-auto w-full max-w-3xl px-3 pt-4 sm:px-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Conversation
                  </div>
                  <h2 className="truncate text-base font-semibold">{active.title}</h2>
                </div>
              </div>
            </div>
            <MessageList
              messages={active.messages}
              streamingMessageId={effectiveStreamingMessageId}
            />
          </>
        )}
      </div>
      <MessageInput
        onSend={onSend}
        onStop={onStop}
        isStreaming={isStreaming}
        model={model}
        onModelChange={onModelChange}
        placeholder="Ask…"
      />
      {/* Bottom ad panel: single rotating placement (ad ↔ disclosure
        filler) attached below the composer (no gap, shared rounding —
        they read as one panel). Replaces the old top/inline slots and
        the floating footer disclosure. */}
      <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-4">
        <BottomAdPanel providerName={providerName} />
      </div>
      {/* Composer status bar: app badge only. Model selection lives in
        the empty state (full select) — a second live selector here was
        redundant and cluttered the minimal layout. */}
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-3 pb-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-500 text-[9px] font-bold text-white"
          >
            K
          </span>
          <span className="shrink-0 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Kiwi AI
          </span>
        </div>
      </div>
    </div>
  );
}
