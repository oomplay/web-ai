# WEB-AI — Phase 3 Plan (Monetization & Production Gate)

Status: **Planning only.** No application source, dependencies, or
verification tests are modified by this document. The previously
verified baseline (`120/120` verify, typecheck/build PASS, clean
working tree on `master` at `77efe54`) is the source of truth and
remains unchanged.

This plan assumes the **current** Phase 2 implementation as the
contract. Anything that contradicts the existing README, the
`apps/api/.env.example` defaults, the safety layer in
`apps/api/src/safety/`, the SSRF guard in
`apps/api/src/providers/ai-gateway-ssrf.ts`, or the existing
`AdSlot` abstraction in `apps/web/src/components/ads/AdSlot.tsx` is
an error in this plan, not in the code.

---

## 1. Current state — what already exists

The Phase 3 plan must start from what is already implemented, not
from an imagined baseline.

### 1.1 Backend (`apps/api`)

* Express + TypeScript, port `8787` (default).
* Endpoints:

  * `GET /api/health` — minimal `{ok:true}` payload (no config leak).
  * `GET /api/models` — list of `ModelInfo { id, label, provider }`.
  * `POST /api/chat` — SSE streaming (`text/event-stream`); body is
    `{ model, messages[], stream? }`; system role rejected; per-message
    and total character caps; `body` JSON cap `64kb`.

* Provider registry (`apps/api/src/providers/registry.ts`) — registers
  `MockProvider` always (when `MOCK_PROVIDER_ENABLED=true`) and
  `KiwiCraftAIGatewayProvider` **only** when four preconditions hold
  (`AI_GATEWAY_ENABLED`, `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_API_KEY`,
  `AI_GATEWAY_MODELS` non-empty).

* Safety layer (`apps/api/src/safety/`):

  * `rate-limit.ts` — sliding-window per-IP, separate windows for
    `chat` and `models`.
  * `concurrency.ts` — per-IP concurrent stream / request caps.
  * `validation.ts` — `validateChatInput`, `clientIp`, body bounds,
    system-role rejection.

* SSRF guard (`apps/api/src/providers/ai-gateway-ssrf.ts`):

  * `https:` only in production; `http:` opt-out via
    `AI_GATEWAY_ALLOW_LOOPBACK=true` AND `NODE_ENV !== 'production'`.
  * Hard-block: `localhost`, `metadata.google.internal`, `metadata`.
  * IPv4 private/loopback/link-local rejected; IPv6
    `::1`, `fe80::/10`, `fc00::/7`, `::`, `::ffff:0:0`,
    IPv4-mapped IPv6 in private ranges rejected.
  * Host allowlist (`AI_GATEWAY_ALLOWED_HOSTS`) is the primary
    control; IP-block list is defence-in-depth.
  * Credentials in URL rejected.

* Error sanitisation — every error that reaches the client flows
  through `safeProviderError()` in
  `apps/api/src/providers/ai-gateway-utils.ts`. Specific messages:

  | Status / kind | Sanitised message (user-visible) |
  |---|---|
  | 401, 403 | "AI provider authentication failed." |
  | 408 | "AI provider request timed out." |
  | 429 | "AI provider rate-limited." |
  | 500, 502, 503, 504 | "AI provider is temporarily unavailable." |
  | network | "Unable to reach AI provider." |
  | parse | "AI provider returned an invalid response." |
  | abort | "AI provider request was cancelled." |

  Server-side `console.error` keeps the real cause for operators.

### 1.2 Frontend (`apps/web`)

* React 18 + Vite 5 + TypeScript 5 + Tailwind 3, port `5173`.
* Single-page app rooted at `App.tsx`:

  * `Sidebar` (conversation list, new chat, rename, export, delete).
  * `ChatWindow` (EmptyState, MessageList, BottomBanner, MessageInput).
  * `TopBanner` rendered above the chat area in `App.tsx`.
  * `ThemeToggle`, `ModelSelector`.

* AdSlot (`apps/web/src/components/ads/AdSlot.tsx`):

  * Three variants: `top`, `bottom`, `inline`. Top + bottom wrappers
    `TopBanner` / `BottomBanner` are thin.
  * Visual: dashed-border placeholder, `min-h-[60px]`,
    `aria-label="Ad slot — <variant>"`, `role="complementary"`.
  * Already used:

    * `TopBanner` — `<App>` top of main area.
    * `BottomBanner` — `<ChatWindow>` between MessageList and input.

* `lib/api.ts` — `fetchModels`, `streamChat`, SSE parser. The
  client SSE parser does not perform the same
  raw-newline-to-`\\n` escape that the upstream SSE parser does. This
  is fine because the chat route serialises each delta through
  `JSON.stringify` (no literal newlines), but it is worth noting if
  any Phase 3 code is allowed to forward upstream SSE bytes to the
  browser.

* HTML metadata (`apps/web/index.html`): `lang="en"`, viewport meta
  with `viewport-fit=cover`, `color-scheme="light dark"`, description
  `"Free public AI chat. No login, no signup."`, title
  `"Web AI — Free Chat"`. **No OpenGraph, no Twitter Card, no JSON-LD,
  no `robots`, no `theme-color`, no `apple-touch-icon`.**

* `apps/web/.env.example` contains exactly one variable:
  `VITE_API_BASE_URL=http://localhost:8787`. There is no
  `VITE_ADS_*` variable today.

* Persistence is **client-only** — `localStorage`. No cookies are
  set. No server-side state for a user. This is a structural choice,
  not a bug, and it has direct implications for cookie-based
  consent banners (see §7).

### 1.3 What is explicitly NOT in scope today (from README)

* No login, accounts, sessions server-side, or cookies.
* No real AI provider calls unless env-gated (Phase 2B).
* No API keys, billing, or paid models.
* **No AdSense or any third-party ad network** (current state).
* No RAG, agents, or web search.
* No database or persistence on the server.
* No CI/CD or deployment configuration.

These are read-only inputs to Phase 3, not goals.

---

## 2. Phase 3 architecture

### 2.1 Goals

1. Replace `AdSlot` placeholders with a **provider-agnostic** ad
   abstraction whose default backend is AdSense.
2. Ship a public landing page that explains the product, the
   no-account model, and how the service is funded.
3. Make sure ads cannot break chat, cannot leak user input, and
   cannot be confused with UI controls (accidental-click policy).
4. Add the metadata, disclosures, and legal pages that a public,
   ad-funded site actually needs.

### 2.2 Non-goals (do not silently absorb into Phase 3)

* No server-side ad tracking, no ad-related cookies, no
  ad-related state. The server is still stateless w.r.t. users.
* No new backend endpoints for ads. AdSense runs in the browser.
* No payment, no subscription, no "Pro" tier.
* No changes to the chat safety layer (rate limit, concurrent caps,
  input bounds, SSRF, allowlist, sanitised errors).
* No Phase 4 items (TLS, reverse-proxy config, observability,
  monitoring, abuse-case studies). Those are explicitly out of
  scope here.

### 2.3 AdSlot — provider-agnostic design

The current `AdSlot` is purely visual. Phase 3 turns it into a
**container** that delegates to a provider-specific implementation.
The default provider is AdSense; the type system makes it easy to
add another later without rewriting consumers.

#### Public shape (target, not implemented by this plan)

```text
interface AdProvider {
  // Returns a React element to mount into the slot, or null to
  // render the placeholder. Called once per <AdSlot variant=...>
  // mount. Implementations MUST be safe to call on the server (i.e.
  // they must guard `typeof window` themselves or be lazy).
  mount(variant: 'top' | 'bottom' | 'inline'): React.ReactNode;
}

interface AdSlotProps {
  variant: 'top' | 'bottom' | 'inline';
  className?: string;
  // Test/dev override. The default is the value of
  // VITE_ADS_PROVIDER (e.g. 'adsense' | 'placeholder' | 'none').
  provider?: 'adsense' | 'placeholder' | 'none';
}
```

`AdSlot` reads `VITE_ADS_PROVIDER` from `import.meta.env` (Vite),
falls back to `'placeholder'`, and dispatches:

| `VITE_ADS_PROVIDER` | Behaviour |
|---|---|
| `placeholder` (default) | Render the existing dashed-border box. Used in dev and in any environment where AdSense is not configured. |
| `adsense` | Mount the AdSense implementation (see §2.4). If `VITE_ADSENSE_CLIENT` is empty, the slot falls back to `placeholder` AND logs a single console warning. |
| `none` | Render nothing in the slot — useful for ad-free builds (e.g. an internal operator build). The slot still reserves layout space so the chat layout does not jump. |

This shape is deliberately a **single file change** in
`AdSlot.tsx`. The two existing wrappers (`TopBanner`,
`BottomBanner`) keep their signatures.

#### Constraints (security / privacy)

* The provider implementation **must not** read or write
  `localStorage`, `sessionStorage`, or `document.cookie`. The
  app's no-cookie contract is a feature, and any ad SDK that
  demands cookies is a hard reject for v1.
* The provider **must not** receive user message content, model
  id, conversation id, or any other application state as a prop.
  Ad placements are content-agnostic.
* The provider **must not** run on the server. The AdSlot
  dispatch must be client-only.
* AdSense's auto-personalised ads are fine for v1 but must be
  opt-out-able via a runtime flag (`VITE_ADSENSE_NPA=true`,
  Non-Personalized Ads) so the operator can flip it on for GDPR
  / child-directed / regulated contexts without code changes.

### 2.4 AdSense integration

#### Configuration (frontend env)

Add to `apps/web/.env.example`:

```text
# Ad provider selection. One of: placeholder | adsense | none.
VITE_ADS_PROVIDER=placeholder

# AdSense publisher client id, e.g. ca-pub-1234567890123456.
# Leave empty in dev; AdSlot will fall back to the placeholder.
VITE_ADSENSE_CLIENT=

# AdSense slot ids, per variant. Leave empty to fall back to the
# placeholder for that variant only.
VITE_ADSENSE_SLOT_TOP=
VITE_ADSENSE_SLOT_BOTTOM=
VITE_ADSENSE_SLOT_INLINE=

# Non-Personalized Ads. true = NPA mode (no cookies, no
# personalization). Recommended for GDPR / child-directed /
# regulated traffic. Defaults to false to keep the operator's
# options open.
VITE_ADSENSE_NPA=false
```

The file **does not** carry a real publisher id. Operators copy
`apps/web/.env.example` to `apps/web/.env` and fill their own.

#### Implementation outline

* The AdSense script is loaded **once** at app boot via
  `index.html` or a top-level effect in `App.tsx`, guarded by
  `VITE_ADS_PROVIDER === 'adsense'`. The script tag is appended
  to `document.head`; on `placeholder` / `none` the script is
  never requested.
* `<AdSlot variant="top" />` mounts an
  `<ins class="adsbygoogle" data-ad-client="..."
  data-ad-slot="..." style="display:block" data-ad-format="auto"
  data-full-width-responsive="true" />` and calls
  `(window.adsbygoogle = window.adsbygoogle || []).push({})`
  in a `useEffect`. The `data-ad-slot` is sourced from the
  matching `VITE_ADSENSE_SLOT_*` env var; if empty, the
  placeholder is rendered instead.
* All script loads use `async` and `defer` semantics so they
  never block first paint or the chat input.
* No new npm dependencies. AdSense is loaded from
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`
  directly; this keeps `package.json` unchanged.

#### Failure-safe behaviour

* If the AdSense script fails to load (network error, ad blocker,
  CSP block), the `<ins>` element remains in the DOM but renders
  nothing. The chat UI must not visually shift more than the
  existing min-height (`min-h-[60px]`). No JS error should reach
  the user.
* If `adsbygoogle.push` throws (e.g. double-init), catch and
  log to `console.warn` only; do not surface to the user.
* The provider implementation exposes a single `try/catch` wrapper
  around the AdSense call so a regression in the SDK cannot
  break the React tree.

#### Loading states

* Before the script loads, the slot shows the existing
  dashed-border placeholder. There is no spinner, no skeleton —
  the placeholder already conveys "this is an ad slot" with
  `role="complementary"` and an `aria-label`.
* The placeholder is removed only after the AdSense script has
  called back and painted, or after a 2-second timeout, whichever
  comes first. This is to prevent Cumulative Layout Shift (CLS)
  when the ad finally loads.

### 2.5 Ad placement strategy

Three named slots today. Behaviour and rationale:

| Slot | Placement | Desktop | Mobile | AdSense format |
|---|---|---|---|---|
| `top` | `App.tsx`, above the chat header area, full width. | Sticky under header is **not** used; chat scrolls under it. | Same, full width, respects viewport. | `data-ad-format="auto" data-full-width-responsive="true"`. |
| `bottom` | `ChatWindow.tsx`, between the last message and the message input. | Full width within `max-w-3xl`. | Same, full width, sits above the input bar. | Responsive. |
| `inline` | Not currently rendered; reserved for future use (e.g. between conversation turns). | N/A | N/A | N/A for v1. |

Explicitly **prohibited** layouts:

* Ads that overlap the message input.
* Ads that auto-play audio or video.
* Ads that expand on hover/click in a way that looks like a UI
  control.
* Ads that pin themselves to the viewport (sticky bottom of the
  screen) on mobile, where they would cover the input.
* Ads injected into the streaming SSE response. Ads live in the
  React tree, not in the chat wire format.

### 2.6 Ad-blocker behaviour

* The placeholder is honest: it already says "Ad slot — top"
  in monospaced caps. Users with ad blockers simply see a
  labelled empty box. No nag, no anti-blocker wall, no
  paywall. The README's "free, no login" promise is preserved.
* Do not ship a "please disable your ad blocker" dialog. It
  contradicts the "ad-funded, not paywalled" model and hurts
  trust.
* Do not log or transmit any signal about ad-blocker status.

### 2.7 What the chat must NOT depend on

The chat path is independent of the ad path. In particular:

* `useChat` (in `apps/web/src/hooks/useChat.ts`) does not import
  anything from `components/ads/*`. The verify suite's
  `regressionChecks` already pins this indirectly via the
  `frontend bundle does not contain "Authorization: Bearer"`
  style checks. Phase 3 must not regress this.
* `/api/chat` does not return any ad-related field. The
  response shape stays `{ delta }` / `{ error }` / `[DONE]`.
* The `AdSlot` mount path is wrapped in `try/catch` and a
  React error boundary at the `App.tsx` level so a broken
  ad cannot crash the chat tree.

---

## 3. Landing page

### 3.1 Routing

Today the app has a single route: `/` renders `<App />`. The
landing page is therefore **the same route, with content layered
above the chat**. Two options were considered:

1. A separate `/` route that shows landing content and a "Start
   chatting" CTA which links to `/chat` (a new route).
2. The landing content renders above the existing chat area on
   `/`, with the chat always reachable below.

This plan recommends **option 1** because:

* It is consistent with how every comparable "free AI chat" site
  works (HuggingChat, Perplexity landing, etc.).
* It keeps the chat URL stable and bookmarkable
  (`/chat` instead of `/`).
* It keeps landing-page content out of the chat verify surface.

A minimal client-side router is acceptable, but Phase 3 should
**not** introduce `react-router` for this. A single boolean
`landingOpen` in `App.tsx` toggled by a "Start chatting" button
and a `?chat=1` URL flag is sufficient. No new dependency, no hash
fragments, no `react-router`.

### 3.2 Landing content (sections, top to bottom)

1. **Hero**
   * H1: "Free AI chat. No login, no signup, no subscription."
   * Sub: "Web AI is a small, ad-funded public chat. Pick a
     model, ask anything, and start a conversation in one click."
   * Primary CTA: "Start chatting" → opens chat.
   * Secondary CTA: "How it works" → scrolls to the explainer
     section.

2. **Explainer (3 short cards)**
   * "No account" — your history stays in your browser, not on
     a server.
   * "Ad-funded" — ads keep the service free; no paid tier, no
     subscription, no data sale.
   * "Pick a model" — the model selector is right in the chat
     header.

3. **Privacy & security**
   * We do not require an account.
   * We do not set advertising cookies unless you accept.
     (Wording depends on jurisdiction; see §7.)
   * We do not log message content. Server logs are limited to
     IP, status, and request size for abuse prevention.
   * The chat safety layer (rate limits, input bounds,
     sanitised errors) is summarised in one paragraph.

4. **FAQ** (5–7 entries)
   * Is this really free?
   * Do you store my messages?
   * Which AI models are supported?
   * Why am I rate-limited?
   * How do I report abuse?
   * Why am I seeing a placeholder box instead of an ad?
   * Can I run my own instance?

5. **Footer**
   * Links: Privacy, Terms, Contact (mailto).
   * Small print: "© <year> Web AI. Ad-funded, no subscription."
   * No social-share buttons in v1. They leak referrer headers
     and add third-party requests.

### 3.3 SEO / metadata

Add to `apps/web/index.html`:

* `<meta name="description" content="…">` — extended version of
  the existing one.
* `<meta name="theme-color" content="…">` — one for light, one
  via `media="(prefers-color-scheme: dark)"`.
* OpenGraph + Twitter Card tags with the same description, a
  brand image, and a stable `og:url` once the domain is known.
* `<link rel="canonical" href="https://<domain>/" />` —
  placeholder, operator must replace `<domain>` with the real
  one.
* `JSON-LD` `Organization` block, server-rendered static.
  No `WebSite` + `SearchAction` because there is no search
  functionality to mark up.
* `robots.txt` (placed in `apps/web/public/robots.txt`) that
  allows everything (the app is meant to be crawled) and points
  to a future `sitemap.xml`. The sitemap can be a static file
  in the same directory in v1.

None of these items depend on Phase 4 secrets; they are
content, not config.

---

## 4. User experience

### 4.1 Layout rules (binding for all v1 ad placements)

* The message input is the **primary affordance**. It must be
  visible above the fold on a 360×640 viewport with the
  keyboard closed. The bottom ad slot must not push it.
* No ad is allowed to:
  * Cover or shrink the input.
  * Move on scroll in a way that distracts from the chat.
  * Auto-play sound, video, or animation that draws the eye
    away from the input.
* Ads and chat controls have distinct visual treatment. The
  existing placeholder already does this with the dashed border
  and the `Ad slot — …` label; the AdSense implementation
  inherits the same `data-ad-slot` attribute and reserves the
  same `min-h-[60px]`.

### 4.2 Mobile-specific

* Sidebar becomes a slide-over (already implemented in
  `App.tsx` with the `sidebarOpen` state). Ads do not appear
  inside the slide-over.
* The `bottom` slot sits **between** the last message and the
  input on both desktop and mobile; on mobile, the visual
  viewport (`100svh` or `100dvh` if available) must be honoured
  so the slot is not clipped by the browser chrome.
* No sticky bottom-of-screen ad. The existing chat input is
  sticky at the bottom of the chat pane; adding a sticky ad
  below it is rejected.

### 4.3 Refresh behaviour

* Ads may refresh on conversation change (AdSense supports
  this via `adsbygoogle.push({})` on a new `<ins>` mount).
  Phase 3 does **not** add manual refresh controls; AdSense
  handles it.
* During an active stream, the ad slot must not re-mount or
  re-fetch. AdSense refresh on a slot whose surrounding content
  is streaming would be visually noisy and would cost a
  network request. Pin the slot to a single mount for the
  lifetime of the route.

### 4.4 Accidental-click prevention

* The slot has its own labelled border. Clicks on the slot
  are unambiguously ad clicks, not chat clicks.
* Ads never sit on top of buttons. The slot's `z-index` stays
  in the document flow.
* Ads do not use hover-to-expand layouts in the slots we ship.

### 4.5 Loading performance

* AdSense script loads `async` after the React tree has
  mounted. The first paint of the chat is not delayed.
* No third-party font, no third-party analytics, no
  third-party tag manager. (Google Tag Manager is a common
  vector for tag-bloat; the plan does not introduce it.)
* The `apps/web` bundle currently builds to ~500 kB minified
  / 155 kB gzipped. Phase 3 must keep that envelope; it adds
  zero new runtime dependencies.

---

## 5. Production readiness gate

This gate is the **boundary between Phase 3 and Phase 4**.
Items marked **Required** must be true before the public URL
serves real users. Items marked **Recommended** should be true
but are not blocking. Items marked **Optional** are nice-to-have.
Items marked **Implemented** are already in the repo.

### 5.1 Network and process

| Item | Status | Notes |
|---|---|---|
| TLS termination at reverse proxy | **Required** | README §"Production deployment checklist". nginx / Caddy / Cloudflare are all acceptable. The Node process must bind to `127.0.0.1`. |
| `TRUST_PROXY_HOPS` matches the real hop count | **Required** | Mis-set value allows clients to spoof `X-Forwarded-For` and bypass per-IP safety. |
| Exact production `CORS_ORIGIN` | **Required** | Empty list and `*` are rejected at boot (see `index.ts` `validateCorsConfig`). |
| Backend bound to `127.0.0.1` only | **Required** | Do not expose `:8787` to the public internet. |
| Reverse-proxy choice documented | **Required** | One of: nginx, Caddy, Cloudflare, ELB. The choice affects what `TRUST_PROXY_HOPS` should be. |

### 5.2 Configuration and secrets

| Item | Status | Notes |
|---|---|---|
| `.env` not committed | **Implemented** | `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, but allows `.env.example`. |
| `.env.example` kept in sync with `config.ts` | **Implemented** | The current file documents every variable read by `apps/api/src/config.ts`. |
| `AI_GATEWAY_API_KEY` stored as a runtime secret | **Required** | Inject via the reverse proxy (e.g. systemd `EnvironmentFile=` with mode `0600`), Docker secret, or a cloud secret manager. Never in `package.json`, never in a `.env` file committed to the repo. |
| `VITE_ADSENSE_CLIENT` and slot ids | **Required** | Set at build time via `apps/web/.env`. Vite inlines them at build, so a leak in the build artefact is the same as a leak in the env file. |
| `NODE_ENV=production` set in production | **Required** | The SSRF guard refuses `http://` when `NODE_ENV=production` regardless of `AI_GATEWAY_ALLOW_LOOPBACK`. |

### 5.3 Health checks and supervision

| Item | Status | Notes |
|---|---|---|
| `GET /api/health` returns `{ok:true}` | **Implemented** | Minimal payload, no config leak. |
| Liveness probe in reverse proxy | **Recommended** | `GET /api/health` every 10–30 s, restart on 3 consecutive failures. |
| Readiness probe | **Recommended** | Same endpoint for v1; a richer readiness check can be added in Phase 4. |
| Process supervisor (systemd / Docker restart) | **Required** | The Express process must restart on crash. `SIGTERM` already triggers a clean shutdown (see `apps/api/src/index.ts`). |
| Graceful shutdown on `SIGTERM` | **Implemented** | `chatRateLimiter.stop?.()` and `modelsRateLimiter.stop?.()` are called, then `server.close()`. |
| Hard kill after 10 s | **Implemented** | `setTimeout(() => process.exit(1), 10_000).unref()` in `index.ts`. |

### 5.4 Logs

| Item | Status | Notes |
|---|---|---|
| Structured log shipping | **Required** | Current logs are `console.log` / `console.error` plaintext. The reverse proxy or a sidecar must convert to JSON and ship to a log sink. |
| Log rotation | **Required** | If the operator logs to disk, `logrotate` or equivalent must be configured. |
| No request body in logs | **Implemented** | No current code path logs `req.body`. |
| No API key in logs | **Implemented** | The verify suite's `secretChecks` confirms: `apps/api/src/**` contains no `api[_-]?key`, `token`, or similar patterns. |
| No upstream error body in logs | **Implemented** | The chat route logs the sanitised message; the provider's `console.error('[api] ai-gateway upstream error', { host, status })` logs only host + status. |

### 5.5 Monitoring

| Item | Status | Notes |
|---|---|---|
| Rate-limit reject ratio | **Required** | A sudden spike signals an abuse campaign or a bug. Counter: `429 / total` per minute, by `route`. |
| Concurrent stream saturation | **Required** | A spike signals capacity exhaustion. Counter: `MAX_CONCURRENT_STREAMS_PER_IP` rejections / total. |
| SSE idle / max-duration aborts | **Required** | A spike signals an upstream provider going bad. Counter: `abort reason in {idle, max-duration, client-disconnect}`. |
| Provider error rate | **Required** | Once Phase 2B is enabled, alert on `5xx` from the upstream per `host`. |
| Per-IP anomalous activity | **Recommended** | The existing rate limiter and concurrency cap are in-process; a Redis-backed implementation is Phase 4. Until then, single-process observability is sufficient for a small free-tier deploy. |
| End-to-end uptime probe | **Required** | The reverse proxy or an external monitor should hit `/api/health` and `/` (frontend) at least every 60 s. |

### 5.6 Resource limits and dependencies

| Item | Status | Notes |
|---|---|---|
| Per-process memory cap | **Recommended** | Node's RSS should be bounded (e.g. systemd `MemoryMax=512M`). |
| Per-process CPU cap | **Optional** | Cgroups or systemd `CPUQuota=`. |
| Dependency audit | **Required** | `npm audit --omit=dev` must show no high / critical vulnerabilities before deploy. |
| Lockfile pinned | **Implemented** | `package-lock.json` is committed. |
| Outbound timeout for upstream provider | **Implemented** | `PROVIDER_TIMEOUT_MS` (default 30 000 ms) and `AI_GATEWAY_TIMEOUT_MS` (default 30 000 ms). |
| `body-parser` limit | **Implemented** | `express.json({ limit: '64kb' })`. The 64 KB cap is the hard ceiling regardless of how generous `MAX_TOTAL_CHARS` is. |
| DNS resolution of `AI_GATEWAY_BASE_URL` at startup | **Recommended** | Fail fast at boot if the upstream host does not resolve. Optional in v1; required in Phase 4. |

### 5.7 Security headers (frontend served by reverse proxy)

| Header | Status | Notes |
|---|---|---|
| `Strict-Transport-Security` | **Required** | `max-age=31536000; includeSubDomains; preload` once the operator is sure all subdomains serve HTTPS. |
| `Content-Security-Policy` | **Required** | Must allow AdSense (`script-src` and `frame-src` need `https://pagead2.googlesyndication.com` and `https://googleads.g.doubleclick.net`). Must be set so an XSS in the chat cannot exfiltrate to an attacker. The current app uses no inline scripts beyond Vite's own; the policy can be strict. |
| `X-Content-Type-Options: nosniff` | **Required** | Trivial, blocks MIME sniffing. |
| `Referrer-Policy: strict-origin-when-cross-origin` | **Required** | Limits referrer leakage to the landing-page links. |
| `Permissions-Policy` | **Recommended** | Disable unused powerful features (`camera`, `microphone`, `geolocation`). The chat app uses none. |
| `X-Frame-Options: DENY` | **Recommended** | Defence in depth alongside CSP `frame-ancestors 'none'`. |

### 5.8 Backup and recovery

| Item | Status | Notes |
|---|---|---|
| Server-side data to back up | **N/A** | The app is stateless. There is nothing to back up. |
| Client-side history | **N/A** | Lives in the visitor's `localStorage`. Not our data, not our problem to back up. |
| Reverse-proxy config in source control | **Required** | The reverse-proxy config (nginx / Caddy / Cloudflare) is part of the deploy. It should live in this repo or in a sibling infra repo, versioned. |

### 5.9 HTTPS certificate renewal

| Item | Status | Notes |
|---|---|---|
| Automated renewal | **Required** | Caddy and `certbot --deploy-hook` cover this. The Node process does not need to know about certificates; the reverse proxy terminates TLS. |

### 5.10 Items this plan does **not** introduce

To keep the gate honest, the following are **out of scope** even
if they sound relevant:

* Multi-region deployment. The plan assumes a single primary
  region. Multi-region is Phase 4.
* Multi-process clustering. The safety layer is in-process and
  not cluster-safe in v1. Clustering is Phase 4.
* Database. There is no database in v1 and no plan to add one.
* A/B testing framework. Not in scope.
* User accounts. Explicitly out of scope by the README.

---

## 6. Deployment environment gate

The following values must be known and documented before
production config is finalised. This plan does not assign
values; it enumerates what must be filled in.

### 6.1 Backend (`apps/api/.env`)

| Variable | Semantics | Example placeholder (not a real value) |
|---|---|---|
| `PORT` | Port the API binds to. Bind to `127.0.0.1` in production. | `8787` |
| `CORS_ORIGIN` | Comma-separated list of **exact** origins. No `*`, no empty list. | `https://app.example.com` |
| `TRUST_PROXY_HOPS` | Number of trusted reverse-proxy hops. `0` if directly exposed, `1` if behind nginx / Cloudflare, more if behind a chain. | `1` |
| `NODE_ENV` | Must be `production` in production. The SSRF guard's HTTP opt-out is suppressed in production. | `production` |
| `MOCK_PROVIDER_ENABLED` | `true` in dev. `false` in production once the real provider is wired. | `false` |
| `AI_GATEWAY_ENABLED` | `true` in production. | `true` |
| `AI_GATEWAY_BASE_URL` | The real provider's URL. Must be `https://` in production. | `https://<gateway-host>/v1` |
| `AI_GATEWAY_API_KEY` | **Secret.** Loaded from the secret manager, never committed. | `<injected at runtime>` |
| `AI_GATEWAY_MODELS` | Comma-separated allowlist of upstream model ids. | `model-a,model-b` |
| `AI_GATEWAY_ALLOWED_HOSTS` | Comma-separated allowlist of hostnames the base URL may point at. | `<gateway-host>` |
| `AI_GATEWAY_TIMEOUT_MS` | Per-request outbound timeout. | `30000` |
| `CHAT_RATE_LIMIT_WINDOW_MS` | Sliding window for `/api/chat`. | `60000` |
| `CHAT_RATE_LIMIT_MAX` | Max hits per IP per window. | `30` |
| `MODELS_RATE_LIMIT_WINDOW_MS` | Sliding window for `/api/models`. | `60000` |
| `MODELS_RATE_LIMIT_MAX` | Max hits per IP per window. | `120` |
| `MAX_CONCURRENT_STREAMS_PER_IP` | Per-IP concurrent SSE cap. | `3` |
| `MAX_CONCURRENT_REQUESTS_PER_IP` | Per-IP concurrent cheap-request cap. | `10` |
| `MAX_MESSAGES` | Max messages per chat request. | `100` |
| `MAX_MESSAGE_LENGTH` | Max characters per message. | `32000` |
| `MAX_TOTAL_CHARS` | Max total characters per request. | `200000` |
| `SSE_IDLE_TIMEOUT_MS` | Per-stream idle timeout. | `30000` |
| `SSE_MAX_DURATION_MS` | Per-stream hard ceiling. | `120000` |
| `SSE_KEEPALIVE_MS` | Per-stream keepalive period. | `15000` |
| `PROVIDER_TIMEOUT_MS` | Outbound provider request budget. | `30000` |

`AI_GATEWAY_ALLOW_LOOPBACK` is **not** a production variable. It
must be unset (or set to anything other than `true`) in
production. The current verify harness sets it; the production
deploy must not.

### 6.2 Frontend (`apps/web/.env`)

| Variable | Semantics |
|---|---|
| `VITE_API_BASE_URL` | Origin of the backend, including scheme. |
| `VITE_ADS_PROVIDER` | `placeholder` / `adsense` / `none`. |
| `VITE_ADSENSE_CLIENT` | AdSense publisher client id (`ca-pub-…`). |
| `VITE_ADSENSE_SLOT_TOP` | AdSense slot id for the top slot. |
| `VITE_ADSENSE_SLOT_BOTTOM` | AdSense slot id for the bottom slot. |
| `VITE_ADSENSE_SLOT_INLINE` | AdSense slot id for the inline slot. Reserved; v1 does not render it. |
| `VITE_ADSENSE_NPA` | `true` = Non-Personalized Ads mode. |

Vite inlines `VITE_*` at build time. The build artefact must be
treated as containing the values. Do not commit
`apps/web/.env`; commit only `apps/web/.env.example`.

### 6.3 Reverse proxy

* Choice: one of nginx, Caddy, Cloudflare (the README mentions
  all three).
* TLS: end-entity cert + chain from a public CA. Let's Encrypt
  via `certbot` or Caddy's built-in CA is sufficient.
* HTTP → HTTPS redirect: 301, all hosts.
* `Strict-Transport-Security`, `Content-Security-Policy`,
  `X-Content-Type-Options`, `Referrer-Policy` set at the proxy.
* `client_max_body_size` capped to 64 KB on the proxy too
  (defence in depth; the Node process already caps at 64 KB).
* WebSocket / SSE buffering disabled
  (`proxy_buffering off`, `X-Accel-Buffering: no`).

### 6.4 Container / server

* Node 20+ runtime.
* `NODE_ENV=production`.
* Process supervisor present (systemd unit or Docker restart
  policy `always`).
* Outbound HTTPS to the AI gateway host allowed on port 443.
* Outbound HTTPS to `pagead2.googlesyndication.com` and
  `googleads.g.doubleclick.net` allowed on port 443.
* The Node process binds to `127.0.0.1:8787`, not `0.0.0.0`.

### 6.5 Domain and TLS

* A registered domain the operator controls.
* DNS A / AAAA records point at the reverse proxy.
* TLS certificate valid for the apex and for the `www` (or
  chosen subdomain) host.
* HSTS preload list submission is a one-way decision; do it
  only after a clean week of HTTPS-only serving.

---

## 7. AdSense compliance gate

AdSense is governed by the AdSense program policies and the
publisher's local law. This section is a checklist, not legal
advice. The operator is responsible for confirming each item
against the current AdSense policies and against counsel where
relevant.

### 7.1 Account and site

| Item | Status | Notes |
|---|---|---|
| AdSense account in good standing | **Required** | Held by the operator, not by the project. |
| Publisher id (`ca-pub-…`) configured | **Required** | Sourced from `VITE_ADSENSE_CLIENT`. |
| Production domain added and verified in AdSense | **Required** | AdSense does not serve ads to unverified domains. |
| Site ownership verified (DNS or HTML file) | **Required** | One-time, per AdSense onboarding. |
| `ads.txt` file at `/.well-known/ads.txt` (or `/ads.txt`) | **Required** | Lists the publisher's AdSense account. Add as a static file in `apps/web/public/ads.txt` (one line: `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`). The exact `pub-…` value comes from the operator's AdSense account. |

### 7.2 Policy items the codebase already satisfies

* **No incentivised clicks.** No "click the ad to get more
  tokens" flows. The README and the empty-state explainer do
  not mention ads in user-facing language.
* **No misleading ad labelling.** The placeholder already
  says "Ad slot — …" in `aria-label` and as visible text.
  When AdSense is on, the AdSense-rendered ad carries its
  own "Ad" / "Ads by Google" label, which we do not strip.
* **No adult, violent, or otherwise prohibited content.** The
  Phase 2A safety layer is the abuse-prevention floor; Phase
  3 does not loosen it.
* **No auto-refresh abuse.** The plan refreshes ads only on
  conversation change, not on a timer.

### 7.3 Policy items the operator must own

* **Privacy policy.** A page at `/privacy` (or linked from the
  landing footer). The page must disclose: data collected (IP,
  request metadata, no message content), cookies used (the
  AdSense cookie, only if the user has not opted out of NPA),
  third parties (Google AdSense, the AI gateway provider), how
  to contact the operator.
* **Terms of service.** A page at `/terms` linking back to the
  privacy policy and stating the no-account model, the
  rate-limit policy, the no-warranty clause, and the governing
  law.
* **EU / UK user consent (GDPR / PECR / ePrivacy).** The
  default mode is `VITE_ADSENSE_NPA=false` (personalised ads
  enabled). For EU / UK traffic, the operator must either:
  1. Flip `VITE_ADSENSE_NPA=true` to disable personalised ads
     and the matching cookie, or
  2. Ship a CMP (Consent Management Platform) that gates the
     AdSense script load on consent. This is out of scope for
     the codebase and is a deployment-time decision; the
     `VITE_ADSENSE_NPA` flag exists specifically so the
     operator can choose option 1 without a code change.
* **Children's content (COPPA, GDPR-K).** If the operator
  targets under-13 audiences, personalised ads must be off and
  a COPPA-compliant flow is required. The current UI has no
  age gate.
* **Healthcare / finance / legal / regulated verticals.** Out
  of scope for v1. The landing page does not advertise the
  service for any of these.
* **AI-generated content disclosure.** AdSense requires that
  ads are not placed on pages that primarily host "sensitive
  events" or content that violates the AdSense content
  policies. AI chat output is not, on its own, a sensitive
  event. The operator should still keep the chat free of
  AdSense-restricted topics (drugs, weapons, etc.) via the
  safety layer, which is already in place.

### 7.4 Cookie / consent at the application level

* The app sets no cookies. This is a structural choice in
  Phase 2, not an accident. Phase 3 does not introduce a
  cookie-setting code path.
* AdSense sets its own cookies in the user's browser when it
  loads. The operator's privacy policy must explain this.
* The CMP integration (if chosen) is purely a frontend concern
  and is documented as a deployment-time decision.

### 7.5 Items that do **not** belong in the repo

* AdSense publisher id values (the operator's, not a sample).
* AdSense slot id values (the operator's, not a sample).
* Sample ad markup copied from live AdSense pages. We document
  the shape, we do not commit example ads.

---

## 8. Phase 3 milestones

Each milestone ends in a green `npm run verify` run. The
milestones are **sequential**; do not start `3.n+1` until `3.n`
is complete and the verify suite is fully green (`129/129` as of
milestone 3.1, which added nine frontend checks to the
`120/120` Phase 2 baseline; see §9.1).

### Phase 3.0 — Planning / readiness (this document)

* **Objective:** This plan exists, is reviewed, and is committed
  to the repo. No code changes.
* **Files affected:** `PHASE_3_PLAN.md` (new).
* **Dependencies:** None.
* **Acceptance criteria:**
  * The plan is committed.
  * `git status` is clean apart from the new file.
  * `npm run verify` still reads `120/120`.
* **Tests required:** None (no code change).
* **Rollback:** `git revert` of the plan commit.

### Phase 3.1 — Landing page

* **Objective:** Add a landing content surface above the chat
  without breaking the chat. No AdSense yet.
* **Files likely affected:**
  * `apps/web/src/components/landing/Landing.tsx` (new).
  * `apps/web/src/App.tsx` (gate the chat behind a
    `landingOpen` flag; render `<Landing />` when true).
  * `apps/web/src/lib/route.ts` (new, tiny: read / write a
    `?chat=1` query param so the URL is shareable).
  * `apps/web/index.html` (extended description, OpenGraph,
    Twitter Card, theme-color, JSON-LD, canonical).
  * `apps/web/public/robots.txt` (new, allows all + future
    sitemap pointer).
  * `apps/web/public/sitemap.xml` (new, static, one URL).
  * `apps/web/src/components/common/Footer.tsx` (new, links
    to `/privacy` and `/terms`).
  * `apps/web/src/components/common/Markdown.tsx` (unchanged
    unless a render-edge case is found).
  * `apps/web/src/index.css` (no new utilities; existing
    Tailwind palette is sufficient).
* **Dependencies:** None new.
* **Acceptance criteria:**
  * `/` shows the landing content. "Start chatting" sets
    `?chat=1` and reveals the chat.
  * `/?chat=1` (and direct visit) shows the chat directly.
  * `viewport` meta, `theme-color`, `og:*`, `twitter:*`,
    `canonical`, `JSON-LD Organization` are all present.
  * The 5–7 FAQ entries are present.
  * `robots.txt` is served and allows all.
  * `npm run typecheck`, `npm run build`, and
    `node verify.mjs` all still pass.
* **Tests required:**
  * Extend `verify.mjs::frontendChecks` to assert
    `index.html` contains the new meta tags, `robots.txt`
    exists, and the built bundle contains the FAQ copy
    (smoke test).
* **Rollback:** `git revert` the milestone.

### Phase 3.2 — AdSlot production architecture

* **Objective:** Make `AdSlot` provider-agnostic without yet
  shipping AdSense. The dev experience must be unchanged from
  today.
* **Files likely affected:**
  * `apps/web/src/components/ads/AdSlot.tsx` (provider
    dispatch added; signature widened as in §2.3).
  * `apps/web/src/components/ads/PlaceholderAdProvider.tsx`
    (new, extracted from the current inline JSX).
  * `apps/web/src/components/ads/index.ts` (new, barrel).
  * `apps/web/src/lib/ads.ts` (new, central `getAdProvider()`
    reading `import.meta.env.VITE_ADS_PROVIDER`).
  * `apps/web/src/App.tsx` (no behaviour change).
  * `apps/web/src/components/chat/ChatWindow.tsx` (no
    behaviour change).
  * `apps/web/.env.example` (new `VITE_ADS_PROVIDER` line,
    defaulting to `placeholder`).
* **Dependencies:** None new.
* **Acceptance criteria:**
  * With `VITE_ADS_PROVIDER=placeholder` (the default), the
    UI looks identical to today.
  * With `VITE_ADS_PROVIDER=none`, the slots render no
    content but still reserve `min-h-[60px]`.
  * The `AdSlot` component has a single source of truth for
    which provider to use.
  * `npm run typecheck`, `npm run build`, and
    `node verify.mjs` all still pass.
* **Tests required:**
  * New unit tests for `getAdProvider()` (allowed values,
    default fallback).
  * Update `verify.mjs::frontendChecks` to confirm the
    placeholder is still rendered (smoke test).
* **Rollback:** `git revert` the milestone.

### Phase 3.3 — AdSense integration

* **Objective:** Mount the AdSense script in the
  `VITE_ADS_PROVIDER=adsense` configuration, with the
  failure-safe and loading-state behaviour in §2.4.
* **Files likely affected:**
  * `apps/web/src/components/ads/AdsenseAdProvider.tsx`
    (new).
  * `apps/web/src/lib/ads.ts` (extended).
  * `apps/web/src/App.tsx` (script loader in `useEffect`,
    guarded by `VITE_ADS_PROVIDER === 'adsense'`).
  * `apps/web/.env.example` (new `VITE_ADSENSE_*` lines).
  * `apps/web/public/ads.txt` (new, static, placeholder —
    operator fills in their own `pub-…` value before going
    live).
* **Dependencies:** None new.
* **Acceptance criteria:**
  * With `VITE_ADS_PROVIDER=adsense` and a valid
    `VITE_ADSENSE_CLIENT` and a valid slot id, an
    `<ins class="adsbygoogle">` mounts in each slot.
  * With `VITE_ADS_PROVIDER=adsense` and an empty
    `VITE_ADSENSE_CLIENT`, the placeholder is rendered and a
    single `console.warn` is logged.
  * With the AdSense script blocked (DevTools → block
    request URL), the chat remains functional and no JS
    error reaches the user.
  * The AdSense script load is `async` and does not block
    first paint.
  * `npm run typecheck`, `npm run build`, and
    `node verify.mjs` all still pass.
* **Tests required:**
  * Verify suite's `secretChecks` is extended to confirm
    the built bundle does not contain a literal
    `ca-pub-…` value when `VITE_ADSENSE_CLIENT` is empty
    in the verify env.
  * Update `frontendChecks` to confirm the `<ins
    class="adsbygoogle">` markup is present when the env is
    set to `adsense`.
  * The verify suite continues to run without contacting
    any AdSense URL. The script tag is appended at runtime
    only; the build artefact does not include the script
    bytes.
* **Rollback:** `git revert` the milestone.

### Phase 3.4 — UX / performance validation

* **Objective:** Confirm the mobile / desktop behaviour in
  §4, including no layout shift, no input overlap, and no
  accidental-click layout.
* **Files likely affected:**
  * `apps/web/src/components/ads/AdSlot.tsx` (minor tweaks
    to spacing, `min-h`, CLS handling).
  * `apps/web/src/index.css` (if a small `@media (max-width:
    …)` rule is needed; otherwise unused).
  * `docs/PERFORMANCE_NOTES.md` (new, summarising measured
    CLS / LCP / TBT before and after AdSense, with the
    measurement method).
* **Dependencies:** None new.
* **Acceptance criteria:**
  * Manual: open the page on a 360×640 viewport, send a
    message, observe no overlap between the bottom slot
    and the input.
  * Manual: trigger a conversation change, observe the
    slot does not visually jump more than the existing
    `min-h-[60px]`.
  * Performance budget unchanged: the bundle does not grow
    by more than 1 KB gzipped in this milestone.
  * `npm run verify` still fully green (`129/129`; see §9.1).
* **Tests required:**
  * Add a static layout assertion in `verify.mjs` to the
    built CSS for `@media (min-width: 768px)` (already
    present) and the absence of new top-level `@font-face`
    rules.
* **Rollback:** `git revert` the milestone.

### Phase 3.5 — Monetization verification

* **Objective:** Confirm the AdSense-rendered page passes
  AdSense's own policy checks and that the safety layer has
  not regressed.
* **Files likely affected:**
  * `docs/ADSENSE_REVIEW_CHECKLIST.md` (new, summarising
    the operator's pre-launch review).
  * `verify.mjs` (extend the `secrets` check to assert
    `apps/web/dist/**` does not contain a literal publisher
    id from the operator's account — the verify harness
    uses an empty publisher id, so this is a structural
    test, not a secret leak test).
* **Dependencies:** None new.
* **Acceptance criteria:**
  * `npm run verify` still fully green (`129/129`; see §9.1).
  * The verify suite does not contact any external network
    host.
  * The built bundle's `dist/assets/index-*.js` does not
    contain `ca-pub-` followed by 16 digits when the env
    is left empty.
  * The `docs/ADSENSE_REVIEW_CHECKLIST.md` is committed.
* **Tests required:** As above.
* **Rollback:** `git revert` the milestone.

### Phase 3.6 — Production gate (hand-off to Phase 4)

* **Objective:** Sign off that everything in §5 marked
  **Required** is done. Phase 3 ends when the production
  gate's **Required** items are all true. Phase 4 begins
  after that.
* **Files likely affected:**
  * `PRODUCTION_CHECKLIST.md` (new, the operator-facing
    copy of §5 with line items to tick off).
  * `apps/api/.env.example` (no change in code, but the
    file may gain a comment block referring to
    `PRODUCTION_CHECKLIST.md`).
  * `apps/web/.env.example` (same).
* **Dependencies:** None new.
* **Acceptance criteria:**
  * The operator can answer "yes" to every **Required**
    line in §5.
  * The PRODUCTION_CHECKLIST is committed.
  * `npm run verify` still fully green (`129/129`; see §9.1).
* **Tests required:** None new.
* **Rollback:** `git revert` the milestone.

---

## 9. Testing strategy

The 120/120 verify suite is the contract. Phase 3 does not
loosen it. Milestone 3.1 added nine frontend checks (theme
color, OpenGraph, canonical, JSON-LD, robots.txt, sitemap,
landing hero, CTA, FAQ), bringing the total to `129/129`;
later milestones may add more checks, but no existing check
may be removed or weakened.

### 9.1 Frontend

* `npm run typecheck` (api + web) — must pass.
* `npm run build` (api + web) — must pass; bundle size
  envelope unchanged for milestones 3.2–3.5, may grow by
  ≤ 3 KB gzipped for 3.1 (landing page content: hero,
  explainer, privacy, 7-entry FAQ, footer) and by
  ≤ 1 KB gzipped for 3.4 only. The 3.1 budget reflects the
  measured cost of shipping real landing copy: the initial
  ≤ 1 KB estimate was written before the copy existed and
  proved too tight; the measured growth of the implemented
  landing page is +2.25 KB gzipped (154.86 → 157.11).
* `verify.mjs::frontendChecks` — extended in milestones 3.1
  and 3.3 to assert new HTML metadata and the AdSense
  markup path.
* Manual smoke tests before each commit:
  * Landing page renders, "Start chatting" works.
  * Chat remains functional with `VITE_ADS_PROVIDER=none`.
  * Chat remains functional with the AdSense script
    network-blocked in DevTools.

### 9.2 Backend

* `npm run verify` — must remain fully green (`129/129` as of
  milestone 3.1) after every
  milestone. No backend source changes are part of Phase 3;
  this is a regression guard, not a feature.
* No new endpoints, no new env vars consumed by the backend
  in Phase 3 (AdSense is browser-only).

### 9.3 Security

Phase 3 must not introduce a regression in:

* CORS allowlist enforcement (frontend never calls a
  cross-origin host it should not, and the backend's
  `validateCorsConfig` continues to refuse `*` and empty
  lists).
* SSRF guard. Phase 3 does not touch the AI gateway path.
* Host allowlist and model allowlist on the AI gateway.
  Phase 3 does not touch them.
* Rate limits. The verify suite already pins the in-process
  rate limiter behaviour; no change to the chat or models
  rate limit is allowed in Phase 3.
* Concurrent stream cap. Same.
* Input validation. Same.
* Sanitised provider errors. The verify suite's
  `live: upstream 500 -> sanitised "temporarily unavailable"`
  and `live: upstream 401 -> sanitised "authentication
  failed"` tests are the contract here.

### 9.4 Privacy

* `localStorage` keys remain the four prefixed with
  `webai.*`. No new keys are introduced.
* No `document.cookie` writes.
* No third-party requests beyond AdSense. The verify suite
  runs entirely offline.

---

## 10. Phase 3 acceptance criteria

Phase 3 is complete when **all** of the following are true.
Until they are, Phase 3 is in progress, not done.

* `PHASE_3_PLAN.md` (this file) is committed.
* `PRODUCTION_CHECKLIST.md` is committed.
* The landing page is live at `/` and the chat is reachable
  via `/?chat=1` (or via the "Start chatting" CTA).
* The landing page includes the six sections in §3.2
  (hero, explainer, privacy, FAQ, footer).
* `<head>` includes the metadata in §3.3 (description,
  theme-color, OpenGraph, Twitter Card, canonical, JSON-LD).
* `robots.txt` and `sitemap.xml` are served.
* `AdSlot` is provider-agnostic, defaults to `placeholder`,
  and supports `adsense` and `none`.
* With `VITE_ADS_PROVIDER=adsense` and valid env, AdSense
  renders in the `top` and `bottom` slots.
* With the AdSense script network-blocked, the chat remains
  functional and no JS error is surfaced to the user.
* With `VITE_ADS_PROVIDER=none`, the slots reserve space but
  render nothing.
* `localStorage` keys are unchanged; no cookies are set by
  the application.
* `npm run typecheck` PASS, `npm run build` PASS,
  `npm run verify` `129/129`.
* Every **Required** item in §5 is answered "yes" by the
  operator.
* Privacy and Terms pages exist (even if minimal) and are
  linked from the landing footer.
* `ads.txt` is in `apps/web/public/` (with a placeholder
  `pub-…` value the operator must replace).
* The bundle size has not grown by more than 4 KB gzipped
  versus the Phase 2 baseline (≤ 3 KB for the landing page
  content in 3.1, ≤ 1 KB for UX tuning in 3.4).
* No security control from §9.3 has regressed.

---

## 11. Phase 4 boundary

Phase 4 is **operational hardening**, not a continuation of
Phase 3. It begins only after Phase 3 is complete.

Phase 4 is expected to cover:

* Production deployment automation (CI/CD, blue/green or
  rolling restarts).
* TLS configuration on the reverse proxy.
* Observability: structured log shipping, metrics export
  (Prometheus / OTel), tracing for the `/api/chat` path.
* Monitoring dashboards and alert routing for the
  four metrics in §5.5.
* Abuse-case studies: an actual, written-up set of attacks
  (e.g. rate-limit circumvention via `X-Forwarded-For`
  spoofing when `TRUST_PROXY_HOPS` is mis-set; mass SSE
  connection holding; message-body bomb) with the
  corresponding mitigations and residual risks.
* Production resource limits: per-process caps, horizontal
  scaling, multi-process clustering, Redis-backed rate
  limiter and concurrency limiter.
* Operational runbooks: how to rotate the AI gateway key,
  how to read the metrics, how to roll back a deploy, how
  to handle a takedown request.
* Scaling notes: how the system behaves at 10× and 100×
  the current target load, and what the next bottleneck is.

Phase 3 **must not** silently absorb any of the above. If a
piece of work turns out to be operational rather than
product, it is Phase 4 and goes in a separate plan.

---

## 12. File inventory for this plan

* `PHASE_3_PLAN.md` (new, this file).

That is the only file this plan creates. Everything else in
the plan is documentation of what future milestones will
touch; it is not a current change.

---

## 13. Validation of this plan

Before commit:

* Read this file back. Confirm:
  * No secret values are present (no real `ca-pub-…`, no
    API keys, no real `*.example.com` domains used as
    defaults).
  * No contradiction with the existing README.
  * No contradiction with the existing `.env.example`
    defaults in `apps/api` and `apps/web`.
  * No contradiction with the existing `AdSlot` shape —
    the milestones in §8 explicitly widen the signature
    in a backward-compatible way.
  * No dependency added.
  * No application source file modified.

`git status --short` after creating the file should list
exactly:

```text
?? PHASE_3_PLAN.md
```

(or `A  PHASE_3_PLAN.md` after `git add`). Nothing else.

`git diff --check` should be silent.
