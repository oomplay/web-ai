# WEB-AI — Free AI Chat Platform

A free, public, ad-funded AI chat web app. No login, no signup, no subscription.
The backend talks to free AI providers and the UI is a self-branded ChatGPT-style interface.

> **Status:** **Phase 1 — MVP Skeleton.**
> Phase 1 ships a working chat UI, streaming responses, markdown + code highlighting,
> conversation history in the browser, dark/light theme, model selection, responsive
> layout, and an `AdSlot` placeholder. The backend uses a `MockProvider` only — no real
> provider is contacted and no API key is required. Real provider integration, rate
> limiting, abuse protection, and AdSense are scheduled for Phase 2.

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
  ├── MockProvider         (Phase 1 — default, no credentials)
  └── OpenAICompatibleProvider  (Phase 2 skeleton, disabled until env is set)
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

Phase 1 only needs the mock provider to be enabled (default). See `apps/api/.env.example`:

| Variable | Purpose | Phase |
|---|---|---|
| `PORT` | Backend port | 1 |
| `CORS_ORIGIN` | Allowed origin for the frontend | 1 |
| `MOCK_PROVIDER_ENABLED` | Use the in-process mock provider | 1 |
| `OPENAI_COMPAT_BASE_URL` | OpenAI-compatible base URL | 2 |
| `OPENAI_COMPAT_API_KEY` | OpenAI-compatible API key | 2 |

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
