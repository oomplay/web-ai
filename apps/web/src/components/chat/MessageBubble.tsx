import { Markdown } from '../common/Markdown';
import { classNames } from '../../lib/format';
import type { ChatMessage } from '../../types/chat';

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === 'user';
  return (
    <div
      className={classNames(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={classNames(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[75%]',
          isUser
            ? 'bg-brand-500 text-white'
            : 'bg-white text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800',
        )}
      >
        <div className={classNames('md', isUser && 'text-white')}>
          {isUser ? (
            <pre className="whitespace-pre-wrap break-words font-sans">
              {message.content}
            </pre>
          ) : message.content ? (
            <Markdown>{message.content}</Markdown>
          ) : (
            <span className="text-zinc-400">…</span>
          )}
          {isStreaming && !isUser && (
            <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-current align-baseline opacity-70" />
          )}
        </div>
      </div>
    </div>
  );
}
