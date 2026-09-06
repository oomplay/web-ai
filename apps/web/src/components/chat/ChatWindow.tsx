import { useMemo } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { EmptyState } from './EmptyState';
import { BottomBanner } from '../ads';
import type { Conversation } from '../../types/chat';
import { ModelSelector } from '../common/ModelSelector';

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="thin-scroll flex-1 overflow-y-auto">
        {!active || active.messages.length === 0 ? (
          <EmptyState onSuggest={onSend} model={model} onModelChange={onModelChange} />
        ) : (
          <>
            <div className="mx-auto w-full max-w-3xl px-3 pt-4 sm:px-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Conversation
                  </div>
                  <h2 className="truncate text-base font-semibold">{active.title}</h2>
                </div>
                <div className="w-44">
                  <ModelSelector value={model} onChange={onModelChange} />
                </div>
              </div>
            </div>
            <MessageList
              messages={active.messages}
              streamingMessageId={streamingMessageId ?? lastAssistantId}
            />
            <div className="mx-auto w-full max-w-3xl px-3 sm:px-6">
              <BottomBanner />
            </div>
          </>
        )}
      </div>
      <MessageInput
        onSend={onSend}
        onStop={onStop}
        isStreaming={isStreaming}
        placeholder={
          active
            ? 'Message Web AI…   (Enter to send, Shift+Enter for newline)'
            : 'Type something to start a new chat…'
        }
        providerName={providerName}
      />
    </div>
  );
}
