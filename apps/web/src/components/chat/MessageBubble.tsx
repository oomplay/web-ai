import { Markdown } from '../common/Markdown';
import { classNames } from '../../lib/format';
import type { ChatMessage } from '../../types/chat';
import { ThinkingPanel } from './ThinkingPanel';

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
          'max-w-[85%] rounded-2xl px-4 py-3 pb-4 text-sm leading-relaxed shadow-sm sm:max-w-[75%]',
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
          ) : (
            <>
              {/*
                Thinking panel: rendered only for assistant messages that
                actually have a thinking prefix. When absent, the bubble
                looks exactly like before, so providers that do not
                separate reasoning from the answer (e.g. the mock) are
                unaffected.
              */}
              {message.thinking ? (
                <ThinkingPanel text={message.thinking} isStreaming={isStreaming} />
              ) : null}
              {message.content ? (
                <Markdown>{message.content}</Markdown>
              ) : isStreaming ? (
                <span className="text-zinc-400">…</span>
              ) : null}
            </>
          )}
          {isStreaming && !isUser && (
            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-current align-baseline opacity-70" />
          )}
        </div>
      </div>
    </div>
  );
}
