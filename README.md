# WEB-AI — Free AI Chat Platform

A free, public, ad-funded AI chat web app. No login, no signup, no subscription.
The backend talks to free AI providers and the UI is a self-branded ChatGPT-style interface.

> **Status:** **Phase 2B — Real provider wired in (opt-out, not opt-in).**
> Phase 2B adds `KiwiCraftAIGatewayProvider` (OpenAI-compatible
> `/chat/completions`, SSRF guard, host allowlist, model allowlist,
> per-request timeout, sanitised errors) and switches the default
> behaviour to a real provider. The mock provider is still available
> for offline development; both can be registered simultaneously.
> Set `MOCK_PROVIDER_ENABLED=true` and `AI_GATEWAY_ENABLED=false` to
> run mock-only. Phase 3 (AdSense) and Phase 4 (hardening) are still
> pending.

## Architecture

```
User
  │  (no login)
  ▼
Web Chat UI  (React + Vite + TS + Tailwind, port 5173)
  │   POST /api/chat  (SSE-style streaming)
  ▼
Backend API  (Node.js + Express + TS, port 8787)
  │
  ├── MockProvider                  (Phase 1 — opt-in, no credentials)
  └── KiwiCraftAIGatewayProvider    (Phase 2B — OpenAI-compatible,
                                     default-on, requires env)
```

API keys, base URLs, and model routing live on the server. The frontend never sees them.

## Repository layout

```
.
├── apps/
│   ├── web/      # React + Vite frontend
│   └── api/      # Express + TypeScript backend
├── .env.example  # not used; see apps/*/.env.example
└── package.json  # npm workspaces
```

## Prerequisites

- Node.js 20+ (tested on 24.14)
- npm 10+ (tested on 11.9)

No database, no Docker, no Python runtime, no other toolchain is required for Phase 1.

## Getting started

```bash
# 1. Install all workspaces
npm install

# 2. Copy env templates (no real secrets needed for Phase 1)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. Run frontend + backend in dev mode
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8787 (`GET /api/health`)

## Available scripts (root)

| Command | What it does |
|---|---|
| `npm run dev` | Run backend and frontend concurrently |
| `npm run dev:api` | Run only the backend |
| `npm run dev:web` | Run only the frontend |
| `npm run build` | Production build for both apps |
| `npm run typecheck` | TypeScript type-check for both apps |
| `npm start` | Start the built backend |

## Backend endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/models` | List available models (from registered providers) |
| POST | `/api/chat` | Streaming chat (`Content-Type: text/event-stream`) |

### `POST /api/chat` request body
```json
{
  "model": "mock-mini",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

### Streaming format
Server emits one JSON object per line, prefixed with `data:`:
```
data: {"delta":"Hello"}
data: {"delta":" world"}
data: [DONE]
```

## Configuration

Both providers are gated by env vars. The defaults in
`apps/api/.env.example` ship with **mock off and AI Gateway on** —
that is the production posture (the app is a real product, not a
demo).

| Variable | Purpose |
|---|---|
| `PORT` | Backend port |
| `CORS_ORIGIN` | Allowed origin for the frontend (comma-separated, no `*`) |
| `TRUST_PROXY_HOPS` | Number of trusted reverse-proxy hops (0 = direct) |
| `MOCK_PROVIDER_ENABLED` | Register the in-process mock provider (`true`/`false`) |
| `MODEL_CONFIG_FILE` | Hot-reloadable model config file (default `models.config.json` relative to the API working directory) |
| `AI_GATEWAY_ENABLED` | Register the real AI Gateway provider (`true`/`false`) |
| `AI_GATEWAY_BASE_URL` | OpenAI-compatible base URL (must be `https:`) |
| `AI_GATEWAY_API_KEY` | Upstream API key (treat as a secret) |
| `AI_GATEWAY_MODELS` | **Fallback** comma-separated model-id allowlist (used only when the model config file is absent/invalid) |
| `AI_GATEWAY_MODEL_LABELS` | **Fallback** JSON `{"id":"Label"}` map for human-readable labels in the model picker |
| `AI_GATEWAY_ALLOWED_HOSTS` | Comma-separated hostname allowlist (SSRF guard) |
| `AI_GATEWAY_TIMEOUT_MS` | Per-request outbound timeout (default 30 000) |

### Adding / editing / removing models — no restart required

The model list no longer requires a process restart. Edit
`apps/api/models.config.json` (template: `models.config.example.json`):

```json
{
  "models": ["provider/model-id-a", "provider/model-id-b"],
  "labels": {
    "provider/model-id-a": "Human-readable Model A"
  },
  "splitThinkingModels": ["provider/model-id-a"]
}
```

- `models` — the allowlist exposed via `GET /api/models`; anything else
  returns 404.
- `labels` — optional display names for the model picker (every key must
  appear in `models`).
- `splitThinkingModels` — ids whose `content` stream needs the heuristic
  thinking/answer splitter (see `AI_GATEWAY_SPLIT_THINKING_MODELS` in
  `apps/api/.env.example` for when to use it).

The file is validated on every load (fail-closed: a bad file keeps the
last-known-good config) and watched with `fs.watch`. While the process
keeps running:

- **open SSE streams are never interrupted** — a model added or removed
  mid-conversation does not affect a response that is already streaming;
- new models are usable **immediately** (`GET /api/models` and
  `POST /api/chat` pick them up within ~250 ms);
- the in-memory safety layer (rate-limit windows, concurrency caps) is
  untouched.

If `fs.watch` does not fire on your filesystem (network mounts, some
container volumes), `kill -HUP <pid>` re-reads the file manually. The
legacy `AI_GATEWAY_MODELS` / `AI_GATEWAY_MODEL_LABELS` /
`AI_GATEWAY_SPLIT_THINKING_MODELS` env vars remain the fallback snapshot
used when the file is missing or invalid, so existing deployments boot
unchanged.

### Operational notes on the model config file

- **Path pinning:** the file path is resolved from `MODEL_CONFIG_FILE`
  (default `models.config.json` relative to the API working directory)
  at boot. It is read only by the server process — no HTTP endpoint can
  write or trigger it, so the public attack surface is unchanged. Only
  someone with filesystem access (or the ability to signal the process)
  can change the model list.
- **Fail-closed reload:** a malformed file (bad JSON, unknown label or
  thinking-split id, duplicate model id) is rejected; the previous
  config keeps serving and the error is logged. The process never dies
  from a bad config file.
- **Removing a model:** existing conversations that referenced it keep
  their history (the frontend stores its own model id per conversation
  and falls back to the first available model for the picker); the
  backend refuses *new* chat requests for the removed id with 404.

Provider registration rules (see `apps/api/src/providers/registry.ts`):

- The mock provider is registered whenever `MOCK_PROVIDER_ENABLED=true`.
- The AI Gateway provider is registered **only when all four** hold:
  `AI_GATEWAY_ENABLED=true`, `AI_GATEWAY_BASE_URL` set,
  `AI_GATEWAY_API_KEY` set, `AI_GATEWAY_MODELS` non-empty.
- Both can be active at the same time; the model id routes to the
  provider that owns it. `GET /api/models` returns the union.
- Model ids may contain `/`, spaces, and parentheses (some upstreams
  expose them that way); the safety layer rejects only control
  characters, `"`, and `\`, and the upstream's own allowlist is the
  authoritative control on what actually reaches the gateway.

**No credentials are stored in the repository.** `.env` files are git-ignored; only
`.env.example` is committed.

## What is intentionally NOT in Phase 1

- No login, accounts, sessions server-side, or cookies
- No real AI provider calls (only the mock provider)
- No API keys, billing, or paid models
- No AdSense or any third-party ad network
- No RAG, agents, or web search
- No database or persistence on the server
- No CI/CD or deployment configuration

## Roadmap (next phases)

- **Phase 2A — Public Safety Layer (DONE in this repo):** Per-IP rate
  limit, per-IP concurrent SSE cap, input bounds (message count, per-message
  length, total length), `system` role rejected, CORS allowlist with
  bootstrap validation, `trust proxy` from `TRUST_PROXY_HOPS`, SSE idle +
  max-duration + keepalive timers, error sanitisation, body size cap,
  health endpoint de-leaked. See `apps/api/src/safety/`.
- **Phase 2B — Real providers & safety:** OpenAI-compatible provider
  (OpenRouter / Groq / Gemini / etc.) with host allowlist (SSRF guard),
  upstream key stored as a secret (env, not code), per-token budget,
  provider fallback, request signing where supported. The Phase 2A
  safety layer is the only thing standing between Phase 2B and quota
  exhaustion from a single bad client.
- **Phase 3 — Monetization:** Replace `AdSlot` placeholders with AdSense,
  add a landing page, consider rewarded ad flows if useful.
- **Phase 4 — Hardening:** Production deploy, observability, abuse case
  studies, scaling notes.

## Production safety requirements (Phase 2A baseline)

The backend is a **public**, **no-account** service. Before exposing it
beyond localhost, the operator MUST verify the following in
`apps/api/.env`. The defaults are conservative for a small free-tier
deployment; tune only with a clear operational reason.

| Variable | Purpose | Default |
|---|---|---|
| `CORS_ORIGIN` | Comma-separated **exact** origins. No wildcard. | `http://localhost:5173` |
| `TRUST_PROXY_HOPS` | Number of trusted reverse-proxy hops. `0` if exposed directly; `1` if behind nginx / Cloudflare. | `0` |
| `CHAT_RATE_LIMIT_WINDOW_MS` | Chat rate-limit sliding window. | `60000` |
| `CHAT_RATE_LIMIT_MAX` | Chat rate-limit max hits per IP per window. | `30` |
| `MODELS_RATE_LIMIT_WINDOW_MS` | Models rate-limit sliding window. | `60000` |
| `MODELS_RATE_LIMIT_MAX` | Models rate-limit max hits per IP per window. | `120` |
| `MAX_CONCURRENT_STREAMS_PER_IP` | Per-IP concurrent SSE streams. | `3` |
| `MAX_CONCURRENT_REQUESTS_PER_IP` | Per-IP concurrent cheap requests. | `10` |
| `MAX_MESSAGES` | Max messages per chat request. | `100` |
| `MAX_MESSAGE_LENGTH` | Max characters per message. | `32000` |
| `MAX_TOTAL_CHARS` | Max total characters per request. | `200000` |
| `SSE_IDLE_TIMEOUT_MS` | Per-stream idle timeout. | `30000` |
| `SSE_MAX_DURATION_MS` | Per-stream hard ceiling. | `120000` |
| `SSE_KEEPALIVE_MS` | Per-stream keepalive comment period. | `15000` |
| `PROVIDER_TIMEOUT_MS` | Outbound provider request budget (Phase 2B). | `30000` |

### Production deployment checklist

1. **Terminate TLS at a reverse proxy** (nginx, Caddy, Cloudflare). The
   Node process must listen on `127.0.0.1` only; do not expose `:8787`
   directly to the public internet.
2. **Set `TRUST_PROXY_HOPS=1`** (or more, matching the actual hop count).
   Do not set higher than the real count, or clients can spoof their IP
   in `X-Forwarded-For` and bypass the per-IP safety layer.
3. **Set `CORS_ORIGIN` to the exact public origin** of the frontend.
   The bootstrap validation refuses empty lists and `*`.
4. **Bind to a high port** and rely on the reverse proxy for port 80/443.
5. **Forward logs** to a structured log sink. The current implementation
   uses `console.log`/`console.error`; production should ship JSON.
6. **Add monitoring** for: rate-limit reject ratio, concurrent-stream
   saturation, SSE idle / max-duration aborts, provider error rate
   (Phase 2B). These are the early-warning signals of an abuse campaign.
7. **Phase 2B is gated on this checklist.** Do not enable a real
   provider until the per-IP safety layer is in production and you have
   monitoring on the metrics above.

### Threat model recap

- **Anonymous, no-account public client.** No authentication, no
  cookies, no tokens. The safety layer is the only thing standing
  between a `curl` loop and the upstream provider's free quota.
- **Cheap DoS shapes the layer is designed to absorb:**
  - High-frequency small requests (rate limit).
  - Long-lived SSE connections (concurrent cap + idle / max-duration).
  - Memory-bomb bodies (body size cap + per-message / total chars).
  - Prompt-injection via `system` role (rejected).
  - Provider error reflection (sanitised to `Provider error.`).
  - Config reflection via `/api/health` (now minimal `{ok:true}`).

## License

TBD
