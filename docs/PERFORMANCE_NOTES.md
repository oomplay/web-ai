# Performance notes — Phase 3

This file records the budget and the measurements taken at each
milestone, so a future operator can compare a fresh build against
the baseline without having to re-derive the numbers.

The repo does **not** ship any runtime observability for ads
(impressions, viewability, etc.). That is the operator's AdSense
console, not the application's. The numbers below are limited to
the **application surface**: build size, layout reservation, and
synchronous render behaviour.

## Bundle size budget (per `PHASE_3_PLAN.md` §9.1)

The Phase 2 baseline (commit `985c15a`) builds to roughly:

| Asset | Raw | Gzipped |
|---|---:|---:|
| `dist/assets/index-*.js` | 500.75 kB | **154.86 kB** |
| `dist/assets/index-*.css` | 23.81 kB | 5.23 kB |

The total Phase 3 budget is **≤ 4 kB gzipped** over the Phase 2
baseline, allocated as:

| Milestone | Budget | What it adds |
|---|---:|---|
| 3.1 — Landing page | ≤ 3 kB | Hero + 3-card explainer + privacy summary + 7-entry FAQ + footer + extended `<head>` metadata |
| 3.2 — AdSlot architecture | ≤ 0 kB (envelope unchanged) | Provider dispatch is mostly a no-op at the placeholder path |
| 3.3 — AdSense integration | ≤ 1 kB | `AdsenseAdProvider` + script loader + NPA + barrel re-export |
| 3.4 — UX / perf validation | ≤ 1 kB | Reserved for layout / CLS hardening if any is needed |
| **Total** | **≤ 4 kB** | |

## Measured growth (this build)

| Milestone | gzipped JS | Δ vs Phase 2 | Notes |
|---|---:|---:|---|
| 3.0 baseline (at `985c15a`) | 154.86 kB | — | |
| 3.1 (landing page)        | 157.11 kB | +2.25 kB | hero + explainer + privacy + FAQ copy |
| 3.2 (AdSlot architecture) | 157.39 kB | +2.53 kB | dispatcher + provider getter |
| 3.3 (AdSense integration) | 158.10 kB | +3.24 kB | AdsenseAd + script loader + NPA |

All three measured numbers stay under the per-milestone budget.

## Layout reservation (per `PHASE_3_PLAN.md` §2.4, §4.1)

Every code path inside `<AdSlot>` reserves the same minimum
height so the chat does not shift when the slot transitions
between states:

| Path | Element | min-height |
|---|---|---|
| `placeholder` (default) | `<div data-ad-slot>` | `min-h-[60px]` |
| `adsense` + waiting / loading / failed | `<div data-ad-slot>` → `<PlaceholderAd>` | `min-h-[60px]` |
| `adsense` + ready | `<div data-ad-slot>` containing `<ins>` | `min-h-[60px]` |
| `none` | `<div data-ad-slot aria-hidden>` | `min-h-[60px]` |

The `verify.mjs` suite pins each path by source-pinning the
`min-h-[60px]` class on every branch of the dispatcher.

## Async / no-blocking guarantees

* The AdSense loader script is appended via `document.createElement('script')`
  with `async = true` and `crossOrigin = 'anonymous'`. First paint of
  the chat is not delayed.
* The script is **not** requested at the placeholder path; the only
  AdSense byte in the build artefact is the upstream URL.
* The 2 s failsafe in `AdsenseAdProvider` swaps the placeholder for
  the `<ins>` even if the script is blocked; the chat tree never
  throws.
* `adsbygoogle.push({})` is wrapped in `try/catch`; a regression in
  the SDK cannot break the React tree.

## How to re-measure on a fresh checkout

```sh
npm ci
npm run build
ls -la apps/web/dist/assets
```

Then compare the `*.js` file's gzipped size against the table above
(`gzip -c apps/web/dist/assets/index-*.js | wc -c`).

For a real LCP / CLS number, run a Lighthouse audit against the
built preview (`npm run preview` after `npm run build`) and pin
the result in the operator's monitoring. The repo deliberately
ships no client-side telemetry.

## Out of scope

The following are explicitly **not** Phase 3 work and live in
Phase 4 (operational hardening):

* structured log shipping
* metrics export / dashboards
* ad impression / viewability tracking
* multi-region deployment
* clustering / horizontal scaling
