/**
 * Minimal URL query helpers for the landing -> chat gate.
 *
 * The app uses a single boolean flag in the URL: `?chat=1` reveals the
 * chat directly. The absence of the flag (or `chat=0`) shows the landing
 * page. We do this without `react-router` to keep the dependency surface
 * unchanged.
 *
 * SSR safety: every access is guarded by `typeof window` so this module
 * can be imported by components that may eventually be rendered on the
 * server.
 */

export function isChatParamSet(search: string | undefined | null): boolean {
  if (!search) return false;
  // Strip leading "?" if present.
  const s = search.startsWith('?') ? search.slice(1) : search;
  if (!s) return false;
  for (const part of s.split('&')) {
    const eq = part.indexOf('=');
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? '' : part.slice(eq + 1);
    if (k === 'chat' && (v === '1' || v === 'true')) return true;
  }
  return false;
}

/**
 * Read the current URL in the browser and decide whether the chat should
 * be shown directly. Returns `false` outside the browser.
 */
export function shouldStartInChat(): boolean {
  if (typeof window === 'undefined') return false;
  return isChatParamSet(window.location.search);
}

/**
 * Build a URL string that includes the `?chat=1` flag, preserving any
 * existing path. Returns a relative URL (`/...`).
 */
export function withChatFlag(path: string): string {
  // Normalise: ensure we have a path.
  const p = path && path.length > 0 ? path : '/';
  // If `?chat=1` is already present, return as-is.
  if (isChatParamSet(p)) return p;
  return p + (p.includes('?') ? '&chat=1' : '?chat=1');
}
