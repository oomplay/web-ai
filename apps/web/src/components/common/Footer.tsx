/**
 * Site footer shown on the landing page.
 *
 * Renders a small "© year Kiwi AI" line plus links to the legal pages.
 * No social-share buttons (they leak referrer headers and add
 * third-party requests; see PHASE_3_PLAN.md §3.2).
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="mx-auto w-full max-w-3xl px-3 pb-8 pt-12 text-xs text-zinc-500 sm:px-6 dark:text-zinc-400"
      aria-label="Site footer"
    >
      <div className="flex flex-col items-start gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <p>© {year} Kiwi AI. Ad-funded, no subscription.</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
          <a
            href="/privacy"
            className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
          >
            Privacy
          </a>
          <a
            href="/terms"
            className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
          >
            Terms
          </a>
          <a
            href="mailto:hello@kiwicraft.in"
            className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
