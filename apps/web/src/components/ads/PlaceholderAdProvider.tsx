import type { AdSlotVariant } from '../../lib/ads';

/**
 * The default provider render: a labelled house-ad card.
 *
 * Restyled (from the original flat dashed box) into a rounded card in
 * the same visual language as the rest of the app: small icon badge on
 * the top-left, a bold title, a one-line description, a faint "Ad"
 * label in the top-right corner, and an underlined destination link
 * with an arrow in the bottom-right corner.
 *
 * Extracted verbatim from the original inline AdSlot JSX (flat dashed
 * box) in Phase 2 and re-skinned in the UI polish pass; the props and
 * the `data-ad-slot` contract are unchanged. No network calls, no
 * storage access, no third-party requests.
 */

/** Per-variant card copy. The destination URL is the deploy's own
 * landing anchor (real, in-app target — no external tracking). */
const CARD_COPY: Record<AdSlotVariant, { title: string; body: string }> = {
  top: {
    title: 'Free AI chat, funded by ads.',
    body: 'No account, no subscription — ads keep this service free.',
  },
  bottom: {
    title: 'Your chats stay on this device.',
    body: 'History lives in your browser only. Start a new chat anytime.',
  },
  inline: {
    title: 'Ad space available.',
    body: 'This slot supports the free tier of Web AI.',
  },
};

export function PlaceholderAd({
  variant,
  className,
}: {
  variant: AdSlotVariant;
  className?: string;
}) {
  const label = `Ad slot — ${variant}`;
  const copy = CARD_COPY[variant];
  return (
    <div
      data-ad-slot={variant}
      aria-label={label}
      role="complementary"
      className={[
        'my-2 flex w-full items-stretch justify-between gap-3 rounded-xl border px-4 py-3',
        'border-zinc-200 bg-zinc-100/80',
        'dark:border-zinc-800 dark:bg-zinc-900',
        'min-h-[60px] select-none',
        className ?? '',
      ].join(' ')}
    >
      {/* Left: icon badge + title + description */}
      <div className="flex min-w-0 items-center gap-3">
        <div
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500 text-[11px] font-bold text-white"
        >
          W
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {copy.title}
          </div>
          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {copy.body}
          </div>
        </div>
      </div>
      {/* Right: faint Ad label (top) + CTA link (bottom) */}
      <div className="flex shrink-0 flex-col items-end justify-between">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Ad
        </span>
        <a
          href="#how-it-works"
          className="hidden items-center gap-0.5 text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 sm:inline-flex dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          How it works
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </a>
      </div>
    </div>
  );
}
