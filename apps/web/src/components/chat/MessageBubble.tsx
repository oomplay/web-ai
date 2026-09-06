import { useEffect, useRef, useState } from 'react';
import { Markdown } from '../common/Markdown';
import { classNames } from '../../lib/format';
import type { ChatMessage } from '../../types/chat';
import { ThinkingPanel } from './ThinkingPanel';

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  /** Re-stream this assistant reply (drops it and everything after). */
  onRegenerate?: (assistantMessageId: string) => void;
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (permissions/insecure context) — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied!' : 'Copy message'}
      className={classNames(
        'theme-fade rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600',
        'focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
      )}
    >
      {copied ? (
        // Checkmark feedback state (same geometry as the copy icon).
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function MessageBubble({ message, isStreaming, onRegenerate }: Props) {
  const isUser = message.role === 'user';
  // Action row (retry / copy) belongs to finished assistant messages.
  const showActions = !isUser && !isStreaming;
  return (
    <div
      className={classNames(
        'flex w-full flex-col gap-1',
        isUser ? 'items-end' : 'items-start',
        // Subtle entrance: 2px rise + fade, compositor-only. The bubble
        // itself is the animated element (one per message, mount-once);
        // streaming text inside is never re-animated.
        'animate-rise',
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
        {/*
          User messages are plain text, NOT markdown, so they deliberately
          render outside the `.md` wrapper. The global `.md pre` rule in
          index.css paints every `<pre>` with the code-block background,
          which used to bleed into the user bubble (white text on a
          near-white box in light mode / a dark inset box in dark mode).
          Keeping the user `<pre>` out of `.md` scope fixes the contrast
          without touching the assistant markdown styles.
        */}
        {isUser ? (
          <pre className="whitespace-pre-wrap break-words font-sans">
            {message.content}
          </pre>
        ) : (
          <div className="md">
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
          </div>
        )}
        {isStreaming && !isUser && (
          // Streaming cursor: opacity pulse on a compositor-only layer.
          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-current align-baseline opacity-70" />
        )}
      </div>
      {showActions && (
        // Action row under the bubble: regenerate + copy (reference design).
        // Hidden while streaming; copy uses the raw content (thinking
        // excluded) so what lands on the clipboard is the answer text.
        <div className="flex items-center gap-0.5 px-1">
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              aria-label="Regenerate response"
              title="Regenerate response"
              className={classNames(
                'theme-fade rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600',
                'focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
              )}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
          )}
          <CopyButton getText={() => message.content} />
        </div>
      )}
    </div>
  );
}
