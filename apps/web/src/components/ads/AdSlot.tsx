import type { AdProviderKind, AdSlotVariant } from '../../lib/ads';
import { getAdProvider } from '../../lib/ads';
import { AdsenseAd } from './AdsenseAdProvider';
import { PlaceholderAd } from './PlaceholderAdProvider';

export interface AdSlotProps {
  variant: AdSlotVariant;
  className?: string;
  /**
   * Optional per-slot override of the global VITE_ADS_PROVIDER value.
   * Defaults to the globally resolved provider. Exists so tests and
   * future per-page layouts can pin a provider without touching env.
   */
  provider?: AdProviderKind;
}

/**
 * Ad container. Delegates rendering to the provider resolved by
 * lib/ads.ts (the single source of truth, PHASE_3_PLAN.md §2.3) and
 * never receives user content, model ids, or conversation state.
 *
 * Behaviour by resolved kind:
 *  - placeholder: the labelled dashed box (default; identical to Phase 2)
 *  - adsense: the AdsenseAd provider (milestone 3.3) — falls back to
 *    the placeholder itself when unconfigured or when the script is
 *    blocked / not yet loaded
 *  - none: ad-free build — renders nothing visible but reserves the
 *    same layout space so the chat does not shift
 */
export function AdSlot({ variant, className, provider }: AdSlotProps) {
  const kind = provider ?? getAdProvider();

  if (kind === 'none') {
    return (
      <div
        data-ad-slot={variant}
        aria-hidden
        className={['min-h-[60px] w-full select-none', className ?? ''].join(' ')}
      />
    );
  }

  if (kind === 'adsense') {
    return <AdsenseAd variant={variant} className={className} />;
  }

  return <PlaceholderAd variant={variant} className={className} />;
}

export function TopBanner({ className }: { className?: string }) {
  return <AdSlot variant="top" className={className} />;
}

export function BottomBanner({ className }: { className?: string }) {
  return <AdSlot variant="bottom" className={className} />;
}
