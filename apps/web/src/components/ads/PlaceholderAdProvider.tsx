import type { AdSlotVariant } from '../../lib/ads';

/**
 * The default provider render: a labelled house-ad card.
 *
 * Visual language: small icon badge on the top-left, a bold title, a
 * one-line description, a faint "Ad" label in the top-right corner,
 * and an underlined destination link with an arrow in the bottom-right
 * corner.
 *
 * The card is content-only: the border/background/rounding surface is
 * supplied by the BottomAdPanel wrapper it renders inside, so the card
 * itself stays transparent and seamless in the attached composer
 * panel. No network calls, no storage access, no third-party requests.
 */

/** Card copy for the bottom placement. Emphasizes anonymity — the app
 * stores nothing server-side (chats live in the browser only). The
 * destination is the landing page's "How it works" section — a real,
 * in-app target (the path prefix makes the link work from the chat
 * view too, where the landing section is not mounted; a bare #hash
 * would be a no-op there). No external tracking. */
const CARD_COPY: Record<AdSlotVariant, { title: string; body: string }> = {
  bottom: {
    title: 'Chat anonymously — we store nothing.',
    body: 'No accounts, no server-side history. Your chats never leave your browser.',
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
        // Content-only card: surface styling comes from BottomAdPanel.
        'flex w-full items-stretch justify-between gap-3 px-4 py-3',
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
          K
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
          href="/#how-it-works"
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
