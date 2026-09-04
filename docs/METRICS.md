# Metrics Reference (Phase 3.7-A)

The API exposes a single Prometheus-compatible endpoint:

```text
GET /api/metrics
```

This document is the operator-facing reference for the four metric
families it returns, the scrape configuration, and the security
posture. The implementation is in
`apps/api/src/metrics/registry.ts` (counters),
`apps/api/src/routes/metrics.ts` (route), and `apps/api/src/index.ts`
(mount order).

---

## 1. Scrape configuration

```yaml
scrape_configs:
  - job_name: web-ai
    metrics_path: /api/metrics
    scrape_interval: 15s
    static_configs:
      - targets: ['api.internal:8787']
```

**Important:** the operator MUST block `/api/metrics` at the reverse
proxy so the public internet cannot reach it. The route is mounted
before CORS on the application side, but that is defence-in-depth,
not a substitute for a network-level block.

---

## 2. Metric families

All metric names are prefixed with `web_ai_` to make scraping
multi-tenant safe. Every family has a `# HELP` and `# TYPE` line
per the Prometheus exposition format.

### 2.1 `web_ai_rate_limit_rejections_total` (counter)

Total number of rate-limit rejections since process start. The
`route` label is one of `chat` or `models`; any other value is
bucketed under `other`. The IP itself is **never** a label.

```text
# HELP web_ai_rate_limit_rejections_total Total number of rate-limit rejections.
# TYPE web_ai_rate_limit_rejections_total counter
web_ai_rate_limit_rejections_total{route="chat"} 0
web_ai_rate_limit_rejections_total{route="models"} 0
web_ai_rate_limit_rejections_total{route="other"} 0
```

Use for: rate-limit rejection ratio alert
(`rate(web_ai_rate_limit_rejections_total[5m])`).

### 2.2 `web_ai_active_streams` (gauge)

Number of SSE streams currently open. Increments when a chat stream
is acquired, decrements on every exit path (normal completion, idle
timeout, max-duration, client disconnect, provider error).

```text
# HELP web_ai_active_streams Number of SSE streams currently open.
# TYPE web_ai_active_streams gauge
web_ai_active_streams 0
```

Use for: stream saturation alert (sustained value close to
`MAX_CONCURRENT_STREAMS_PER_IP` × unique IPs is the saturation
signal).

### 2.3 `web_ai_sse_streams_started_total` (counter)

Cumulative number of SSE streams started since process start. Useful
for dividing `web_ai_active_streams` by a recent window to estimate
arrival rate.

### 2.4 `web_ai_sse_aborts_total` (counter)

Total number of SSE streams that ended in a non-clean state. The
`reason` label is one of `idle`, `max-duration`, `client-abort`,
`other`. See the route file for the mapping.

### 2.5 `web_ai_provider_errors_total` (counter)

Total number of AI provider errors since process start. The `kind`
label is one of `http-4xx-client`, `http-4xx-rate`, `http-5xx`,
`timeout`, `network`, `parse`, `aborted`, `other`. The label is
derived only from the error's `kind` and `status`, never from the
message.

Use for: provider error rate alert
(`rate(web_ai_provider_errors_total[5m])`). A spike in
`{kind="http-5xx"}` or `{kind="timeout"}` indicates upstream trouble.

---
## 3. Security posture

The snapshot is **intentionally small**. The following are
explicitly not present in the output, by construction:

- **No API keys**, no `Authorization` headers, no upstream URL paths.
- **No user message content** — only the `err.kind` and `err.status`
  (when the error has them) drive the label, never the message.
- **No client IPs** — labels are an enumerated allowlist (`chat`,
  `models`, `other` for routes; `idle`, `max-duration`, `client-abort`,
  `other` for aborts; eight fixed kinds for provider errors).
- **No cookies** are issued or read by the route.
- **No third-party dependency** is added — the renderer is a pure
  string concatenation in `apps/api/src/metrics/registry.ts`. The
  `prom-client` package is explicitly not used.

The route is mounted **before** the CORS middleware and **before**
the per-route rate limiters, so:

- A browser context cannot scrape it cross-origin.
- The operator's Prometheus scrape loop is never throttled.

The application-side hardening is defence-in-depth. The network
boundary (reverse-proxy block of `/api/metrics` from the public
internet) is the primary control.

---

## 4. Cardinality and retention

The four families have a fixed, bounded label cardinality:

| Family | Labels | Max cardinality |
|--------|--------|-----------------|
| `rate_limit_rejections_total` | `route` | 3 |
| `active_streams` | — | 1 |
| `sse_streams_started_total` | — | 1 |
| `sse_aborts_total` | `reason` | 4 |
| `provider_errors_total` | `kind` | 8 |

Total: at most 17 unique time series. Safe for long-running scrape
intervals and multi-year retention without series-rotation
concerns.

---

## 5. Future work (Phase 4, not in scope of 3.7-A)

- Move counters to a shared store (Redis) for multi-instance
  deployments. The `MetricsRegistry` interface is small enough that
  the drop-in is a follow-up.
- Optional: structured JSON log formatter, exported as a separate
  file, to pair with this metrics surface.
- Optional: a `node_exporter` textfile-collector style dashboard
  bundle in `docs/grafana/` for operators using Grafana.
