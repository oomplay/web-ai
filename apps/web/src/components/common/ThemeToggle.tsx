import { classNames } from '../../lib/format';
import type { Theme } from '../../hooks/useTheme';

interface Props {
  theme: Theme;
  onToggle: () => void;
  className?: string;
}

/**
 * Presentational theme toggle. The theme state itself lives in `App`
 * (single owner) so the `dark` class is applied at boot on EVERY route —
 * previously this component was the only `useTheme` consumer, so the
 * landing page (which renders no header toggle) never themed itself.
 */
export function ThemeToggle({ theme, onToggle, className }: Props) {
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`}
      className={classNames(
        'theme-fade inline-flex h-9 w-9 items-center justify-center rounded-md',
        'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500/50',
        'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
        className,
      )}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
