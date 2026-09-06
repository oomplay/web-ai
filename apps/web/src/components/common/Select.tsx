import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { classNames } from '../../lib/format';

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered in red inside the list; used for the error pseudo-option. */
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Compact render for inline placements (status bar style). */
  compact?: boolean;
  /** Screen-reader label; required for accessibility. */
  ariaLabel: string;
  className?: string;
  /** Rendered next to the trigger when set (e.g. a Retry button). */
  trailing?: React.ReactNode;
}

/**
 * Custom styled select — replaces the native <select> so the dropdown
 * matches the app's panel language (rounded-xl, shadow-lg, themed
 * surfaces) instead of the browser's default listbox.
 *
 * Implementation notes:
 *  - Panel width matches the trigger (`w-full` min-content guard), so
 *    it aligns inside cards and never overflows narrow viewports.
 *  - Closes on outside click and on Escape; selection is click or
 *    Enter/Space (full keyboard support incl. arrow keys and Home/End).
 *  - Opens downward, flipping above the trigger when there is no room
 *    below (small viewports near the bottom of the screen).
 *  - Content fades in with the shared .animate-fade language; reduced
 *    motion users get an instant panel.
 *  - The popper is position:absolute within a position:relative wrapper
 *    (no portal needed — the nearest scroll container is the chat
 *    column, which scrolls the wrapper with it naturally).
 */
export function Select({
  options,
  value,
  onChange,
  compact,
  ariaLabel,
  className,
  trailing,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );

  const selected = options.find((o) => o.value === value);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Escape closes; arrows move the active option while open.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const selectable = options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => !o.disabled);
    const curIdx = selectable.findIndex(({ o }) => o.value === options[activeIdx]?.value);
    const move = (delta: number) => {
      e.preventDefault();
      if (selectable.length === 0) return;
      const next =
        selectable[(curIdx + delta + selectable.length) % selectable.length];
      if (next) setActiveIdx(next.i);
    };
    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        if (selectable[0]) setActiveIdx(selectable[0].i);
        break;
      case 'End':
        e.preventDefault();
        if (selectable.length > 0)
          setActiveIdx(selectable[selectable.length - 1]!.i);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const opt = options[activeIdx];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          close();
        }
        break;
      }
      case 'Tab':
        close();
        break;
    }
  };

  // Decide drop direction before paint to avoid a flicker frame.
  useLayoutEffect(() => {
    if (!open || !rootRef.current || !panelRef.current) return;
    const triggerRect = rootRef.current.getBoundingClientRect();
    const panelH = panelRef.current.offsetHeight;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    setDropUp(spaceBelow < panelH + 8 && triggerRect.top > panelH + 8);
  }, [open, options.length]);

  // Keep the active option visible while arrowing through a long list.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const el = panelRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const pick = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    close();
  };

  return (
    <div
      ref={rootRef}
      className={classNames('relative', className)}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={classNames(
          'theme-fade flex w-full min-w-0 items-center justify-between gap-1.5 rounded-xl border text-left',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
          compact
            ? 'h-7 max-w-full border-transparent bg-transparent px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            : 'h-9 border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600',
          open && !compact && 'border-brand-400 dark:border-brand-500/60',
        )}
      >
        <span className="min-w-0 truncate">
          {selected?.label ??
            (options[0]?.label ?? 'Select…')}
        </span>
        {/* Chevron rotates with open state (compositor-only transform). */}
        <svg
          viewBox="0 0 24 24"
          className={classNames(
            'h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {trailing}
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label={ariaLabel}
          className={classNames(
            'animate-fade absolute z-50 w-full min-w-[10rem] rounded-xl border p-1 shadow-lg',
            'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900',
            'max-h-64 overflow-y-auto thin-scroll',
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {options.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-zinc-400">No options</div>
          )}
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === activeIdx;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-idx={i}
                disabled={opt.disabled}
                onClick={() => pick(opt)}
                onMouseEnter={() => setActiveIdx(i)}
                className={classNames(
                  'theme-fade flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm',
                  'focus:outline-none',
                  isActive &&
                    !opt.disabled &&
                    'bg-brand-50 dark:bg-zinc-800',
                  isSelected
                    ? 'font-medium text-brand-600 dark:text-brand-400'
                    : 'text-zinc-700 dark:text-zinc-200',
                  opt.danger && 'text-red-600 dark:text-red-400',
                  opt.disabled && 'cursor-default text-zinc-400 dark:text-zinc-600',
                )}
              >
                <span className="min-w-0 truncate">{opt.label}</span>
                {isSelected && (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
