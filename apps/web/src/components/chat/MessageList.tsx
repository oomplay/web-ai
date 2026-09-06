import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../../types/chat';

interface Props {
  messages: ChatMessage[];
  streamingMessageId?: string;
  onRegenerate?: (assistantMessageId: string) => void;
}

export function MessageList({ messages, streamingMessageId, onRegenerate }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <div className="thin-scroll mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 py-4 sm:px-6">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          isStreaming={m.id === streamingMessageId}
          onRegenerate={onRegenerate}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
