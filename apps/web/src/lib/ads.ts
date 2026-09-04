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

// --- AdSense configuration (milestone 3.3) ---

/**
 * The publisher client id, e.g. `ca-pub-1234567890123456`. Empty when
 * the operator has not configured ads — callers must fall back to the
 * placeholder.
 */
export function getAdsenseClientId(): string {
  return ((import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) ?? '').trim();
}

const SLOT_ENV_KEYS: Record<AdSlotVariant, string> = {
  top: 'VITE_ADSENSE_SLOT_TOP',
  bottom: 'VITE_ADSENSE_SLOT_BOTTOM',
  inline: 'VITE_ADSENSE_SLOT_INLINE',
};

/**
 * The per-variant AdSense slot id. Empty means "not configured for
 * this variant" — callers must render the placeholder for that slot
 * only (PHASE_3_PLAN.md §2.4).
 */
export function getAdsenseSlotId(variant: AdSlotVariant): string {
  const key = SLOT_ENV_KEYS[variant];
  return ((import.meta.env[key] as string | undefined) ?? '').trim();
}

/**
 * Non-Personalized Ads mode (no personalisation cookies). Set
 * `VITE_ADSENSE_NPA=true` for GDPR / child-directed / regulated
 * deployments without a code change.
 */
export function isNpaMode(): boolean {
  const v = ((import.meta.env.VITE_ADSENSE_NPA as string | undefined) ?? '').trim();
  return v.toLowerCase() === 'true';
}

// --- AdSense script loader (singleton) ---

const ADSENSE_SRC =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=';

type AdsenseScriptState = 'idle' | 'loading' | 'ready' | 'failed';

let adsenseScriptState: AdsenseScriptState = 'idle';
const adsenseListeners = new Set<(state: 'ready' | 'failed') => void>();

export function getAdsenseScriptState(): AdsenseScriptState {
  return adsenseScriptState;
}

/**
 * Idempotently append the AdSense loader script to <head>.
 *
 * - Runs at most once per page lifetime (singleton guard).
 * - The script is created via DOM with `async = true`, so it never
 *   blocks first paint; nothing is requested at all unless the
 *   operator resolved the provider to 'adsense' with a client id.
 * - No-op outside the browser (SSR safety).
 * - The URL is the only AdSense byte in the build artefact; the
 *   script itself is fetched at runtime only.
 */
export function ensureAdsenseScript(): void {
  if (typeof document === 'undefined') return; // SSR safety
  if (adsenseScriptState !== 'idle') return; // already loading/ready/failed
  const client = getAdsenseClientId();
  if (!client) return; // unconfigured; caller renders the placeholder
  adsenseScriptState = 'loading';
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = ADSENSE_SRC + encodeURIComponent(client);
  script.onload = () => {
    adsenseScriptState = 'ready';
    for (const fn of adsenseListeners) fn('ready');
  };
  script.onerror = () => {
    // Ad blocker, offline, or CSP block: stay on the placeholder
    // forever; never surface a JS error to the user.
    adsenseScriptState = 'failed';
    for (const fn of adsenseListeners) fn('failed');
  };
  document.head.appendChild(script);
}

/**
 * Subscribe to script resolution. Returns an unsubscribe function so
 * a mounted slot can detach if it goes away before the script lands.
 */
export function onAdsenseScriptStateChange(
  fn: (state: 'ready' | 'failed') => void,
): () => void {
  adsenseListeners.add(fn);
  return () => {
    adsenseListeners.delete(fn);
  };
}
