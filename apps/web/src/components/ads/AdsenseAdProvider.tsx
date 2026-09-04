import { useEffect, useState } from 'react';
import type { AdSlotVariant } from '../../lib/ads';
import {
  ensureAdsenseScript,
  getAdsenseClientId,
  getAdsenseScriptState,
  getAdsenseSlotId,
  isNpaMode,
  onAdsenseScriptStateChange,
} from '../../lib/ads';
import { PlaceholderAd } from './PlaceholderAdProvider';

/**
 * The adsbygoogle queue shape. The official AdSense snippet pushes
 * into a plain array; NPA mode sets a flag property on the same array.
 */
interface AdsenseQueue extends Array<Record<string, unknown>> {
  requestNonPersonalizedAds?: number;
}
interface AdsenseWindow {
  adsbygoogle?: AdsenseQueue;
}

type RenderState = 'waiting' | 'ready' | 'failed';

let warnedMissingClient = false;

/**
 * Milestone-2s failsafe: mount the <ins> even if the script's onload
 * has not fired yet. Pushing into the adsbygoogle queue before the
 * script arrives is the officially supported flow — the script drains
 * the queue when it lands. If the script never lands (ad blocker,
 * offline, CSP block), the <ins> simply renders nothing inside its
 * reserved box; no error reaches the user (PHASE_3_PLAN.md §2.4).
 */
const SCRIPT_FAILSAFE_MS = 2000;

/**
 * The AdSense provider render for one slot.
 *
 * Behaviour (PHASE_3_PLAN.md §2.4):
 *  - no client id configured  -> placeholder + a single console.warn
 *  - no slot id for a variant -> placeholder for that variant only
 *  - script loading           -> placeholder, swapped for the <ins>
 *    after onload or the 2s failsafe, whichever comes first
 *  - script failed            -> placeholder permanently; the chat is
 *    unaffected and no JS error is surfaced
 *
 * The component never receives user message content, model ids, or
 * conversation state; placements are content-agnostic.
 */
export function AdsenseAd({
  variant,
  className,
}: {
  variant: AdSlotVariant;
  className?: string;
}) {
  const clientId = getAdsenseClientId();
  const slotId = getAdsenseSlotId(variant);
  const [renderState, setRenderState] = useState<RenderState>(() => {
    const s = getAdsenseScriptState();
    if (s === 'ready') return 'ready';
    if (s === 'failed') return 'failed';
    return 'waiting';
  });

  const configured = clientId !== '' && slotId !== '';

  useEffect(() => {
    if (!configured) return undefined;
    if (renderState !== 'waiting') return undefined;
    ensureAdsenseScript();
    const off = onAdsenseScriptStateChange((s) =>
      setRenderState(s === 'ready' ? 'ready' : 'failed'),
    );
    return off;
  }, [configured, renderState]);

  useEffect(() => {
    if (!configured) return undefined;
    if (renderState !== 'waiting') return undefined;
    const t = setTimeout(() => setRenderState('ready'), SCRIPT_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [configured, renderState]);

  // Push the freshly-mounted <ins> into the adsbygoogle queue. Wrapped
  // so a regression in the SDK can never break the React tree.
  useEffect(() => {
    if (!configured || renderState !== 'ready') return;
    try {
      const w = window as unknown as AdsenseWindow;
      const queue: AdsenseQueue = (w.adsbygoogle = w.adsbygoogle || []);
      if (isNpaMode()) queue.requestNonPersonalizedAds = 1;
      queue.push({});
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ads] adsbygoogle.push failed; the slot stays empty.', err);
    }
  }, [configured, renderState, clientId, slotId]);

  if (!configured) {
    if (!clientId && !warnedMissingClient && typeof console !== 'undefined') {
      warnedMissingClient = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[ads] VITE_ADS_PROVIDER=adsense but VITE_ADSENSE_CLIENT is empty; ' +
          'rendering the placeholder.',
      );
    }
    return <PlaceholderAd variant={variant} className={className} />;
  }

  if (renderState !== 'ready') {
    return <PlaceholderAd variant={variant} className={className} />;
  }

  return (
    <div
      data-ad-slot={variant}
      className={['min-h-[60px] w-full', className ?? ''].join(' ')}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
