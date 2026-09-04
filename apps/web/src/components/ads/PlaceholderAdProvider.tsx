import type { AdSlotVariant } from '../../lib/ads';

/**
 * The default provider render: an honest, labelled placeholder box.
 *
 * Extracted verbatim from the original inline AdSlot JSX so the
 * default dev / unconfigured-production look is identical to Phase 2
 * (acceptance criterion for milestone 3.2). No network calls, no
 * storage access, no third-party requests.
 */
export function PlaceholderAd({
  variant,
  className,
}: {
  variant: AdSlotVariant;
  className?: string;
}) {
  const label = `Ad slot — ${variant}`;
  return (
    <div
      data-ad-slot={variant}
      aria-label={label}
      role="complementary"
      className={[
        'my-2 flex w-full items-center justify-center rounded-lg border border-dashed',
        'border-zinc-300 bg-zinc-100 text-xs text-zinc-500',
        'min-h-[60px] select-none',
        'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500',
        className ?? '',
      ].join(' ')}
    >
      <span className="font-mono uppercase tracking-wider">{label}</span>
    </div>
  );
}
