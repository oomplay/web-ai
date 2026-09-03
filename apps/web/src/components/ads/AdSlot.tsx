export function AdSlot({
  variant,
  className,
}: {
  variant: 'top' | 'bottom' | 'inline';
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

export function TopBanner({ className }: { className?: string }) {
  return <AdSlot variant="top" className={className} />;
}

export function BottomBanner({ className }: { className?: string }) {
  return <AdSlot variant="bottom" className={className} />;
}
