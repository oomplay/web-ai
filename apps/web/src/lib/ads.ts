/**
 * Central ad-provider resolution — the single source of truth for
 * which ad backend renders inside the <AdSlot> containers.
 *
 * Milestone 3.2 introduces the dispatch without shipping AdSense
 * (that is milestone 3.3). Constraints from PHASE_3_PLAN.md §2.3:
 *  - no web-storage (local or session) and no cookie access of any kind
 *  - no user message content, model ids, or conversation ids flow
 *    through here; ad placements are content-agnostic
 *  - client-only: import.meta.env is read at build time by Vite and
 *    inlined, so nothing here runs on the server
 */

export type AdProviderKind = 'placeholder' | 'adsense' | 'none';

export type AdSlotVariant = 'top' | 'bottom' | 'inline';

const ALLOWED_KINDS: readonly AdProviderKind[] = ['placeholder', 'adsense', 'none'];

let warnedUnknownProvider = false;

/**
 * Pure resolver: map a raw env value to an AdProviderKind.
 *
 * - undefined / empty -> 'placeholder' (the safe default for dev and
 *   for production deployments that have not configured ads yet)
 * - case-insensitive match against the allowed kinds
 * - anything else -> 'placeholder' with a single operator-facing
 *   console.warn (module-level flag, so repeated mounts never spam)
 */
export function resolveAdProvider(raw: string | undefined | null): AdProviderKind {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'placeholder';
  if ((ALLOWED_KINDS as readonly string[]).includes(value)) {
    return value as AdProviderKind;
  }
  if (!warnedUnknownProvider && typeof console !== 'undefined') {
    warnedUnknownProvider = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[ads] unknown VITE_ADS_PROVIDER '${raw}'; falling back to 'placeholder'.`,
    );
  }
  return 'placeholder';
}

/**
 * Read the configured provider for this build. Vite inlines
 * `import.meta.env.VITE_ADS_PROVIDER` at build time from
 * apps/web/.env (see apps/web/.env.example).
 */
export function getAdProvider(): AdProviderKind {
  return resolveAdProvider(
    import.meta.env.VITE_ADS_PROVIDER as string | undefined,
  );
}
