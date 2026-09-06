import { useState } from 'react';
import { classNames } from '../../lib/format';

interface Props {
  /** The chain-of-thought text. When empty/undefined the panel is hidden. */
  text: string | undefined;
  /**
   * Whether new text is still streaming in. Drives the live "Thinking…"
   * label so the user knows the panel is still updating.
   */
  isStreaming?: boolean;
}

/**
 * Collapsible panel that surfaces a model's chain-of-thought.
 *
 * Defaults to collapsed so the chat layout stays compact. When
 * streaming, a small spinner is shown so the user knows the panel is
 * still active even while it is closed.
 *
 * If `text` is empty (or only whitespace) the panel renders nothing,
 * which is the desired behaviour for providers that do not produce a
 * thinking prefix (e.g. the mock provider).
 */
export function ThinkingPanel({ text, isStreaming }: Props) {
  const [open, setOpen] = useState(false);
  if (!text || text.trim().length === 0) return null;

  return (
    <div
      className={classNames(
        'mb-2 rounded-lg border text-xs',
        'border-zinc-200 bg-zinc-50 text-zinc-700',
        'dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="thinking-panel-body"
        className={classNames(
          'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left',
          'font-medium uppercase tracking-wider text-[10px]',
          'hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
          // Smooth hover recolor.
          'theme-fade',
        )}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>{open ? '▾' : '▸'}</span>
          <span>
            {isStreaming && !open ? 'Thinking…' : 'Thought process'}
          </span>
          {isStreaming && !open ? (
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-70"
            />
          ) : null}
        </span>
        <span className="text-[10px] font-normal normal-case opacity-70">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open ? (
        <div
          id="thinking-panel-body"
          className={classNames(
            'max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t px-3 py-2 leading-relaxed',
            'border-zinc-200 text-zinc-700',
            'dark:border-zinc-700 dark:text-zinc-300',
            // Content fades in over the already-expanded panel.
            'animate-fade',
          )}
        >
          {text}
        </div>
      ) : null}
    </div>
  );
}
