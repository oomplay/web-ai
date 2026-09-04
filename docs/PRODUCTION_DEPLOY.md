# Production Deployment Guide (Phase 3.6)

This document is the operator-facing acceptance gate between
**Phase 3 (monetization)** and **Phase 4 (operational hardening)**.
It consolidates every production-readiness item, labels each as
**Implemented** / **Required** / **Recommended** / **Optional**, and
documents the exact values the operator must supply to the running
service.

Nothing in this file is implemented in code; it is a written
contract. The verify suite (Phase 3.6) pins the **Implemented**
items so that a future change cannot regress them silently. The
**Required** items are operator responsibilities and cannot be
verified by the build.

The implementation contract that this guide describes is documented
in [`PHASE_3_PLAN.md`](../PHASE_3_PLAN.md) §5 and §6, and lives in
`apps/api/src/index.ts` (CORS validation, `trust proxy`, rate
limiters, `/api/health`), `apps/api/src/config.ts`, the
`apps/api/src/safety/` modules, and `apps/api/.env.example`.

---

## 1. Status legend

| Label | Meaning |
|-------|---------|
| **Implemented** | Already enforced by code; pinned by the verify suite. |
| **Required** | Operator must complete before public deploy. The verify suite cannot enforce this (it needs a real domain / account). |
| **Recommended** | Strongly advised for any production deploy; not strictly required. |
| **Optional** | Nice-to-have. Operator may defer without blocking the rollout. |

---

## 2. Items already **Implemented** (pinned by the verify suite)

These items are present in the code today. Phase 3.6 adds verify
assertions so a future change cannot quietly remove them.

| # | Item | Where in code | Status |
|---|------|---------------|--------|
| 2.1 | CORS validation refuses empty list, refuses `*`, requires http(s) origins, parses each entry | `apps/api/src/index.ts` `validateCorsConfig` | Implemented |
| 2.2 | `trust proxy` is set from `TRUST_PROXY_HOPS`; never defaults to `true` | `apps/api/src/index.ts` | Implemented |
| 2.3 | `/api/health` returns a minimal `{ok:true}` payload (no config leak) | `apps/api/src/routes/health.ts` | Implemented |
| 2.4 | Per-IP sliding-window rate limits (chat 30/min, models 120/min default) | `apps/api/src/safety/rate-limit.ts` | Implemented |
| 2.5 | Per-IP concurrent caps (3 streams, 10 requests) | `apps/api/src/safety/concurrency.ts` | Implemented |
| 2.6 | Input bounds: max 100 messages, max 32K chars per message, max 200K total | `apps/api/src/safety/validation.ts` | Implemented |
| 2.7 | SSE lifecycle: idle 30s, max 120s, keepalive 15s | `apps/api/src/safety/concurrency.ts` + chat route | Implemented |
| 2.8 | Body size cap (64 KB) | `apps/api/src/index.ts` `express.json({limit:'64kb'})` | Implemented |
| 2.9 | Sanitised provider errors (no upstream body echo) | `apps/api/src/providers/ai-gateway-utils.ts` `safeProviderError` | Implemented |
| 2.10 | SSRF guard: host allowlist, hard-block localhost / metadata.* / private / loopback | `apps/api/src/providers/ai-gateway-ssrf.ts` | Implemented |
| 2.11 | Model allowlist: only operator-whitelisted ids are exposed by `/api/models` | `apps/api/src/providers/registry.ts` | Implemented |
| 2.12 | Outbound provider request budget (default 30s) combined with client abort signal | `apps/api/src/providers/ai-gateway-utils.ts` | Implemented |
| 2.13 | No `console.log` of user content; server logs limited to IP / status / size | `apps/api/src/routes/chat.ts` | Implemented |
| 2.14 | No cookies issued by the API; CORS pre-flight is the only state | (no cookie code in repo) | Implemented |
| 2.15 | Web build is pure static assets (no SSR, no Node runtime on the edge) | `apps/web/dist/` after `npm run build:web` | Implemented |

---

## 3. **Required** items (operator responsibility)

These are blockers for public deploy. The verify suite cannot enforce
them because they need a real domain, a real account, or operational
decisions. The operator must complete **every** item in this section
before Phase 4 (operational hardening) begins.

| # | Item | Reference |
|---|------|-----------|
| 3.1 | TLS termination at the reverse proxy (nginx / Caddy / Cloudflare / ELB). The Node process must bind to `127.0.0.1` so it is not directly reachable from the public internet. | PHASE_3_PLAN.md §5; README "Production deployment checklist" |
| 3.2 | `TRUST_PROXY_HOPS` set to the **exact** number of trusted hops in front of the API. A wrong value lets clients spoof `X-Forwarded-For` and bypass per-IP safety. | `apps/api/.env.example` `TRUST_PROXY_HOPS` |
| 3.3 | `CORS_ORIGIN` set to the **exact** production origin (no trailing slash, no wildcard). For multi-origin deployments, list each origin comma-separated. | `apps/api/.env.example` `CORS_ORIGIN` |
| 3.4 | `VITE_ADSENSE_CLIENT` set to the AdSense "Tag" id issued for the verified production domain. | `apps/web/.env.example` `VITE_ADSENSE_CLIENT` |
| 3.5 | `VITE_ADSENSE_SLOT_TOP/BOTTOM/INLINE` set to real AdSense slot ids for the verified domain. | `apps/web/.env.example` `VITE_ADSENSE_SLOT_*` |
| 3.6 | `apps/web/public/ads.txt` updated from the placeholder `pub-0000000000000000` to the real publisher id, then served from the production origin. | `docs/ADSENSE_REVIEW_CHECKLIST.md` §1.8 |
| 3.7 | Privacy Policy and Terms of Service pages are live and linked from the landing-page footer. | `docs/ADSENSE_REVIEW_CHECKLIST.md` §1.5, §1.6 |
| 3.8 | AdSense account is in good standing and the production domain is added to the "Sites" list. | `docs/ADSENSE_REVIEW_CHECKLIST.md` §1.1–§1.4 |
| 3.9 | `AI_GATEWAY_*` env vars set if the operator enables a real provider: `AI_GATEWAY_ENABLED=true`, `AI_GATEWAY_BASE_URL` on the `AI_GATEWAY_ALLOWED_HOSTS` allowlist, `AI_GATEWAY_API_KEY` set, `AI_GATEWAY_MODELS` non-empty. | `apps/api/.env.example` `AI_GATEWAY_*` |
| 3.10 | Production `.env` (and any secret material) is stored outside the repository, in a secret manager (Vault, AWS Secrets Manager, GCP Secret Manager, Doppler, etc.). Never commit `.env`. | `.gitignore` already excludes `.env` |

---

## 4. **Recommended** items

Strongly advised for any production deploy. None of these is
uniquely blocking, but the operator should have a clear answer for
each before going public.

| # | Item | Rationale |
|---|------|-----------|
| 4.1 | Reverse-proxy choice documented (nginx, Caddy, Cloudflare, etc.) and reflected in a committed `deploy/<proxy>/` example config. | Repeatable deploys; audit trail. |
| 4.2 | Structured log shipping (e.g. JSON logs to Loki, CloudWatch, Datadog). Today the API uses `console.log` / `console.error`; a JSON formatter can be added without changing call sites. | Operability, alert rules, search. |
| 4.3 | Monitoring for: rate-limit rejection ratio, concurrent-stream saturation, SSE aborts, provider error rate, `/api/health` uptime. | Detects abuse and provider degradation before users do. |
| 4.4 | Process supervision (systemd unit, Docker restart policy, Kubernetes Deployment, or equivalent). The Node process should restart on crash. | Survives transient failures. |
| 4.5 | HTTPS certificate renewal automation (Let's Encrypt via certbot / Caddy / Cloudflare Origin cert). | Avoids expiry outages. |
| 4.6 | Security headers at the reverse proxy: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (or `Content-Security-Policy: frame-ancestors 'none'`). | Defence-in-depth. |
| 4.7 | Dependency auditing in CI (`npm audit --omit=dev` and `npm outdated`) on every PR. | Catches CVEs early. |
| 4.8 | Backup/restore for any persisted state. Today the API is stateless; if a cache (Redis) is added later, its backup posture must be documented. | Avoids data loss. |
| 4.9 | Resource limits (CPU / memory / file descriptors) at the container or systemd unit level. | Prevents noisy-neighbour issues. |
| 4.10 | Graceful shutdown: SIGTERM should let in-flight SSE streams complete within `SSE_MAX_DURATION_MS`; new requests get 503 during shutdown. | No half-completed responses. |

---

## 5. **Optional** items

Nice-to-have. The operator may defer these without blocking the
rollout.

| # | Item | Note |
|---|------|------|
| 5.1 | DNS record TTL strategy (low TTL during cutover, raised after stabilisation). | Aids rollback. |
| 5.2 | Staging environment that mirrors production, including the same `TRUST_PROXY_HOPS` and `CORS_ORIGIN` values. | Pre-deploy smoke tests. |
| 5.3 | Synthetic uptime check from a third region (Pingdom, UptimeRobot, etc.). | Faster incident detection. |
| 5.4 | Public status page. | Reduces support load. |
| 5.5 | Per-IP allowlist / blocklist (CIDR) at the reverse proxy. | Defence-in-depth against repeat abusers. |
| 5.6 | WAF rules at the reverse proxy or CDN (Cloudflare, AWS WAF) for the chat endpoint. | Common attack patterns. |
| 5.7 | Edge cache policy for `GET /api/models` (already low-cost; small but non-zero). | Marginal cost saving. |
| 5.8 | Per-model cost budget and rate-limit tuning per model id. | The current cap is one number for all models. |

---

## 6. Required environment variables (operator-supplied)

The operator must supply **exact** values for the variables below
before the first production boot. Variable names only — never
document real values.

### 6.1 `apps/api/.env`

| Variable | Semantics |
|----------|-----------|
| `PORT` | The TCP port the API binds to. The supervisor should pass `--bind 127.0.0.1:<PORT>` so the API is reachable only from the reverse proxy on the same host. |
| `CORS_ORIGIN` | Comma-separated list of **exact** public origins allowed to call the API. Empty list and `*` are rejected at boot. |
| `TRUST_PROXY_HOPS` | Number of trusted reverse-proxy hops. `0` = no proxy. `1` = behind one reverse proxy. Do not exceed the real hop count. |
| `AI_GATEWAY_ENABLED` | `true` to register the real AI provider; `false` (default) to run mock-only. |
| `AI_GATEWAY_BASE_URL` | OpenAI-compatible chat-completions base URL. Must be HTTPS, and the host must appear in `AI_GATEWAY_ALLOWED_HOSTS`. |
| `AI_GATEWAY_API_KEY` | Outbound AI-provider credential. Treated as a secret. |
| `AI_GATEWAY_MODELS` | Comma-separated model-id allowlist; anything else returns 404. |
| `AI_GATEWAY_ALLOWED_HOSTS` | Comma-separated hostname allowlist for the base URL. |
| `AI_GATEWAY_TIMEOUT_MS` | Per-request outbound timeout. |
| `CHAT_RATE_LIMIT_*`, `MODELS_RATE_LIMIT_*`, `MAX_CONCURRENT_*`, `MAX_MESSAGES`, `MAX_MESSAGE_LENGTH`, `MAX_TOTAL_CHARS`, `SSE_*` | Safety-layer knobs. Defaults are conservative; override only with a clear operational reason. |

### 6.2 `apps/web/.env` (build-time, inlined by Vite)

| Variable | Semantics |
|----------|-----------|
| `VITE_ADS_PROVIDER` | One of `placeholder`, `adsense`, `none`. Defaults to `placeholder` if unset. |
| `VITE_ADSENSE_CLIENT` | AdSense publisher id (`ca-pub-XXXXXXXXXXXXXXXX`). Empty = AdSense provider renders the placeholder. |
| `VITE_ADSENSE_SLOT_TOP/BOTTOM/INLINE` | Per-variant AdSense slot ids. Empty for a variant = that variant renders the placeholder. |
| `VITE_ADSENSE_NPA` | `true` to request non-personalised ads. Default `false`. |

### 6.3 Operational metadata (not env vars; recorded by the operator)

| Field | Semantics |
|-------|-----------|
| Public origin | The canonical https URL the user visits. |
| Reverse-proxy choice | nginx, Caddy, Cloudflare, ELB, etc. |
| Server / container environment | VM, bare metal, Docker, Kubernetes, Fly.io, Render, etc. |
| Domain | The DNS zone the operator controls. |
| TLS strategy | ACME (Let's Encrypt), Cloudflare Origin, commercial CA, etc. |
| AdSense publisher id | As issued by AdSense for the verified site. |
| AdSense slot ids | One per variant (top / bottom / inline). |

---

## 7. Deploy runbook (high-level)

The operator runs through these steps on the first production
deploy. Phase 4 (operational hardening) is **not** in scope of this
guide; it adds the actual reverse-proxy config, the structured-log
formatter, the monitoring rules, and the abuse-case studies.

1. **Build** the artifacts:
   - `npm install`
   - `npm run typecheck` (must pass with no errors)
   - `npm run build` (must pass; produces `apps/api/dist/` and
     `apps/web/dist/`)
2. **Smoke-test** the build with `node verify.mjs` — must report
   153/153 PASS (or more, as new checks are added). This is the
   same suite run in CI.
3. **Configure** the production env from §6.1 and §6.2.
4. **Deploy** the static web bundle (`apps/web/dist/`) behind the
   reverse proxy at the public origin. The web bundle is fully
   static; no Node runtime is required for the frontend.
5. **Deploy** the API (`apps/api/dist/`) bound to `127.0.0.1:8787`
   behind the reverse proxy. Configure `CORS_ORIGIN` and
   `TRUST_PROXY_HOPS` to the production values **before** the
   first boot, or the API will refuse to start.
6. **Update** `apps/web/public/ads.txt` to the real publisher id and
   redeploy the web bundle.
7. **Verify** against
   [`docs/ADSENSE_REVIEW_CHECKLIST.md`](./ADSENSE_REVIEW_CHECKLIST.md)
   §5 (post-launch validation): `curl -I` on `/ads.txt`,
   `/robots.txt`, `/sitemap.xml`; ad-blocker smoke test; AdSense
   console shows impressions within 1 hour.
8. **Hand off** to Phase 4 with the values from §6.3 recorded.

---

## 8. Phase 4 boundary (out of scope for this guide)

The items in §4.2 (structured logs), §4.3 (monitoring), §4.4
(process supervision), §4.5 (cert renewal), §4.6 (security headers),
§4.7 (dependency auditing), and §7 (the actual deploy runbook with
reverse-proxy config) are **Phase 4 — operational hardening**. They
require the operator's actual deploy environment and are documented
in `PHASE_3_PLAN.md` §6 as the explicit handoff point. The current
repository is a dev monorepo and does not ship a
`deploy/<proxy>/` example config; that is the first deliverable of
Phase 4 once the operator has chosen a proxy.

This document closes the Phase 3 implementation. Phase 3 is
considered complete when:

- All items in §2 are still passing in `node verify.mjs`.
- All items in §3 are completed and recorded.
- A first successful production deploy has been performed following
  §7 and the AdSense post-launch checks in
  [`docs/ADSENSE_REVIEW_CHECKLIST.md`](./ADSENSE_REVIEW_CHECKLIST.md) §5.
- The Phase 4 handoff fields in §6.3 are recorded.
