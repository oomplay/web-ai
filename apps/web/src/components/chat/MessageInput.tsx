import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { classNames } from '../../lib/format';
import { ModelSelector } from '../common/ModelSelector';
import { PANEL_SURFACE } from '../ads/BottomAdPanel';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  model: string;
  onModelChange: (id: string) => void;
}

export function MessageInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  model,
  onModelChange,
}: Props) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Single owner of the textarea height measurement (used by the native
  // `input` listener below AND by submit — see the comment there).
  const resize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }, []);

  // Auto-grow up to ~6 lines. Sized from the DOM value via a native
  // `input` listener — NOT keyed on React state. The DOM value can
  // diverge from state (browser form restoration on reload, IME
  // composition, cut/paste edge cases); when that happens a state-keyed
  // effect never re-runs (state goes '' → '') and the textarea stays
  // stuck at its last measured height (e.g. 180px while empty). The
  // native `input` event fires for every real value change regardless
  // of React state, and the mount-time resize() picks up any restored
  // draft.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    resize();
    // Sync state with a browser-restored draft so the send button and
    // the visible text agree after a reload.
    if (ta.value && !ta.defaultValue) setText(ta.value);
    ta.addEventListener('input', resize);
    return () => ta.removeEventListener('input', resize);
  }, [resize]);

  const submit = () => {
    const v = text.trim();
    if (!v || isStreaming) return;
    onSend(v);
    setText('');
    // Clearing via React state sets `value` programmatically, which does
    // NOT fire a native `input` event — the listener above never runs, and
    // the box would stay at its grown height. Re-measure once the cleared
    // value has committed.
    requestAnimationFrame(resize);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-3xl px-3 sm:px-6"
    >
      <div
        className={classNames(
          // Top half of the attached composer+ad-panel surface; the bottom
          // half is rendered by BottomAdPanel. Both build on the shared
          // PANEL_SURFACE, so the colors cannot drift apart.
          'flex flex-wrap items-end gap-2 rounded-t-2xl border-b-0 p-2 shadow-none',
          PANEL_SURFACE,
          'focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-brand-500/30',
          'dark:focus-within:border-zinc-700',
        )}
      >
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? 'Ask…'}
          className={classNames(
            'max-h-[180px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm',
            'text-zinc-900 placeholder:text-zinc-400 focus:outline-none',
            'dark:text-zinc-100 dark:placeholder:text-zinc-500',
            // Placeholder softens in/out instead of snapping.
            'transition-opacity duration-150',
          )}
        />
        {/* Inline compact model selector (reference design): model name +
          chevron, borderless, sits right of the input inside the composer.
          On mobile the long model label is truncated harder (max-w) and the
          selector moves below the textarea row so neither is squeezed —
          the composer stays usable and the model stays switchable at
          every width (the empty-state selector was removed on purpose;
          this is the only source of truth). */}
        <div className="mb-1.5 hidden shrink-0 sm:block">
          <ModelSelector value={model} onChange={onModelChange} compact />
        </div>
        <div className="order-last flex w-full items-center justify-end sm:hidden">
          <div className="max-w-[60%]">
            <ModelSelector value={model} onChange={onModelChange} compact />
          </div>
        </div>
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="theme-fade inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            aria-label="Stop generating"
            title="Stop generating"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!hasText || disabled}
            aria-label="Send message"
            title="Send message"
            className={classNames(
              // Geometry never changes between states (fixed h-9 w-9);
              // only colors fade, so surrounding content cannot shift.
              'theme-fade inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              hasText && !disabled
                ? 'bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/50'
                : 'cursor-default bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600',
            )}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
