# AdSense Review Checklist (Phase 3.5)

This document is the operator-facing acceptance gate for the Phase 3
monetization rollout. It consolidates the AdSense program-policy
requirements that the implementation already enforces, the items the
operator must complete before requesting AdSense approval, and the
post-launch validation steps. Nothing in this file is implemented in
code — it is a written contract that the milestone-3.5 verify suite
asserts against.

The implementation contract that the checklist verifies is documented
in [`PHASE_3_PLAN.md`](../PHASE_3_PLAN.md) §2.3, §2.4, §6, §7 and
applied in:

- `apps/web/src/lib/ads.ts` (single source of truth for provider
  resolution, AdSense config getters, idempotent script loader)
- `apps/web/src/components/ads/AdSlot.tsx` (provider dispatcher)
- `apps/web/src/components/ads/AdsenseAdProvider.tsx` (failure-safe
  AdSense render)
- `apps/web/public/ads.txt` (AdSense program requirement)

---

## 1. AdSense program-policy compliance (operator responsibility)

These items are NOT enforced by the codebase; they require the
operator's real account. The implementation is designed so that
**none of these can break the chat** when the operator has not yet
completed them — the AdSlot dispatcher falls back to the placeholder.

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1.1 | AdSense publisher account created | Operator | TODO |
| 1.2 | Publisher id (format `ca-pub-XXXXXXXXXXXXXXXX`) issued | Operator | TODO |
| 1.3 | Production domain is registered and reachable over HTTPS | Operator | TODO |
| 1.4 | Domain is added to the AdSense "Sites" list and verified | Operator | TODO |
| 1.5 | Privacy Policy page is live and linked from the footer | Operator | TODO |
| 1.6 | Terms of Service page is live and linked from the footer | Operator | TODO |
| 1.7 | Cookie/consent banner is deployed if the operator's audience requires it (e.g. EU/UK under GDPR/ePrivacy, child-directed under COPPA, California under CCPA) | Operator | TODO |
| 1.8 | `apps/web/public/ads.txt` is updated from the placeholder `pub-0000000000000000` to the operator's real publisher id and served from the production origin | Operator | TODO |
| 1.9 | `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT_TOP/BOTTOM/INLINE` are set in the production `.env` (not committed) | Operator | TODO |
| 1.10 | AdSense account is in good standing (no policy strikes, no invalid click activity) | Operator | TODO |

---

## 2. Accidental-click prevention (enforced by code + verify)

The implementation deliberately avoids the patterns AdSense flags as
"deceptive or accidental-click inducing" (PHASE_3_PLAN.md §4). The
verify suite pins these invariants so a future change cannot regress
them silently.

| # | Invariant | Where enforced | Verify check |
|---|-----------|----------------|--------------|
| 2.1 | Ad slots reserve a fixed `min-h-[60px]` so the page never shifts under a misclick | `AdSlot.tsx` (none branch), `PlaceholderAdProvider.tsx`, `AdsenseAdProvider.tsx` | `placeholder reserves min-h-[60px]`, `adsense ready branch reserves min-h-[60px]`, `adsense none-mode reserves min-h-[60px]` |
| 2.2 | Ad slots never overlap the chat input or send button | top/bottom/inline variants only; the `inline` variant is the only one near the composer and is offset by layout | Manual QA on the milestone-3.5 acceptance run |
| 2.3 | No "click here to skip", "X", or close-button overlays on ads | AdSenseAd renders only the official `<ins>` element | `adsense render is the official ins element` |
| 2.4 | The chat composer is reachable and fully usable when the ad slot transitions to any state (loading / failed / ready / none) | AdSlot dispatcher renders a fixed-height box in every state; the composer sits below the inline slot | `chat unaffected when ads fail` |
| 2.5 | Ad refresh does not move existing chat content | Slots are pinned at top/bottom/inline of fixed regions; no DOM re-ordering | Manual QA |
| 2.6 | No floating, sticky, or pop-up ads | Not implemented in any AdSlot variant | Manual QA |
| 2.7 | Ad slots do not show on a user opt-out (`?chat=1` chat-only mode) | Routing is in `App.tsx`; landing mode hides the AdSlot wrapper | `chat-only route does not include ad slots in the bundle` |

---

## 3. Prohibited-content considerations

WEB-AI is a free, no-login chat surface. The operator must ensure
that the product stays inside AdSense's content policies before
requesting review.

| # | Risk | Mitigation in code | Operator action |
|---|------|--------------------|-----------------|
| 3.1 | Adult content surfaced in chat | Phase 2 backend has a sanitised-error path; Phase 3 does not loosen it. The model is the operator's choice; the platform does not log prompts. | Operator must choose an upstream model whose policy matches AdSense's content policy. |
| 3.2 | User-generated copyrighted content in the chat | The platform does not persist conversations; there is no public gallery. | Operator must not add a public-share feature without a takedown flow. |
| 3.3 | Deceptive or harmful content promoted through ads themselves | The AdSlot only accepts the three dispatch kinds (`placeholder`, `adsense`, `none`); no custom-network injection. | None. |
| 3.4 | Ads alongside sensitive content (e.g. health, finance, children) | The footer discloses "general-purpose chat" and the landing page states the model is operator-supplied. | Operator must add category disclosures if the product pivots. |

---

## 4. Production-domain preflight (before changing `VITE_ADS_PROVIDER=adsense`)

The operator must confirm **every** item in this section before the
production build is rebuilt with `VITE_ADS_PROVIDER=adsense`. The
verify suite cannot enforce these because they require a real account
and a real domain.

| # | Item |
|---|------|
| 4.1 | `PUBLIC_ORIGIN` decided and TLS certificate valid for that origin |
| 4.2 | `CORS_ORIGIN` matches `PUBLIC_ORIGIN` exactly (no trailing slash, no wildcard) |
| 4.3 | `TRUST_PROXY_HOPS` matches the reverse-proxy hop count exactly |
| 4.4 | The backend is bound behind a reverse proxy and not directly reachable on `:8787` from the public internet |
| 4.5 | `ads.txt` at `https://<PUBLIC_ORIGIN>/ads.txt` serves the real publisher id, not the placeholder |
| 4.6 | Privacy Policy and Terms of Service URLs resolve and link from the footer |
| 4.7 | `sitemap.xml` and `robots.txt` reflect the production origin (currently `https://web-ai.local/`; see `apps/web/public/sitemap.xml` and `apps/web/public/robots.txt`) |
| 4.8 | `VITE_ADSENSE_CLIENT` matches the AdSense "Tag" shown in the AdSense console for the verified site |
| 4.9 | `VITE_ADSENSE_SLOT_TOP` / `_BOTTOM` / `_INLINE` are real slot ids issued by AdSense for this domain |
| 4.10 | `VITE_ADSENSE_NPA` decision recorded (default `false`; set to `true` for cookie-less / child-directed / regulated deployments) |

---

## 5. Post-launch validation (operator, after first deploy with ads on)

The verify suite asserts the **build-time** invariants in §2. The
operator must perform these manual checks on the live production URL
within 24 hours of enabling `VITE_ADS_PROVIDER=adsense`.

| # | Check | Expected result |
|---|-------|-----------------|
| 5.1 | Load `/` on a desktop browser | Landing page shows above-the-fold hero and the AdSlot placeholders are not visible (ad slots only render in chat mode) |
| 5.2 | Click "Start chatting" (or navigate to `/?chat=1`) | Chat appears with top, inline, and bottom ad slots; slots show either AdSense ads or the labelled placeholder |
| 5.3 | Disable JavaScript in the browser and reload `/` | Landing page degrades gracefully; the chat is unreachable; no JS errors in the network panel |
| 5.4 | Enable an ad blocker (uBlock Origin, AdBlock Plus) and reload `/?chat=1` | Chat is fully functional; ad slots show the labelled placeholder; the network panel shows the adsbygoogle script request was blocked (no JS error in the console) |
| 5.5 | Open the AdSense console for the verified site | Impressions and clicks register from the production origin within 1 hour |
| 5.6 | Run `curl -I https://<PUBLIC_ORIGIN>/ads.txt` | Returns `200 OK` with the real publisher id (not the placeholder) |
| 5.7 | Run `curl -I https://<PUBLIC_ORIGIN>/robots.txt` | Returns `200 OK` and points to the sitemap |
| 5.8 | Open DevTools → Network → reload `/?chat=1` | The only third-party origin contacted is `pagead2.googlesyndication.com` (no unexpected third-party requests from the chat itself) |
| 5.9 | Lighthouse run on `/?chat=1` on a throttled "Mobile" profile | CLS = 0, LCP < 2.5s on a mid-tier device, TBT < 200ms |
| 5.10 | Sign in to the AdSense console and request a policy review if the operator has not already done so | Review status moves from "Ready" to "Under review" or further |

---

## 6. Rollback plan

If any post-launch check in §5 fails, or if the operator observes
abnormal click-through / invalid-click signals:

1. Set `VITE_ADS_PROVIDER=placeholder` in the production env.
2. Rebuild the web bundle and redeploy.
3. Confirm with the verify suite that the bundle is back to the
   placeholder size (`gzip < 158 KB`, per
   `docs/PERFORMANCE_NOTES.md`).
4. Investigate before re-enabling `adsense`. The AdSlot dispatcher
   guarantees that a rollback does not affect chat functionality.
