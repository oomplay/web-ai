# WEB-AI Production Deploy Runbook

This runbook walks a single operator through deploying the WEB-AI
monorepo to a `vps-ubuntu-24.04` host exposed at
`https://chat.kiwicraft.in` through a Cloudflare Tunnel. The Node
API binds to `127.0.0.1:8787` and is reachable from the public
internet **only** via `cloudflared`. Cloudflare Edge performs the
public TLS termination; no local certificate is required.

The repository must be cloned to `/opt/web-ai` and built there. The
two systemd units in this directory run as unprivileged system
users (`cloudflared`, `web-ai`) that this runbook creates on first
install.

The expected host layout:

```text
/opt/web-ai/
  apps/
    api/
      dist/         <- produced by `npm run build`
      .env          <- copied from apps/api/.env.production.example
    web/
      dist/         <- produced by `npm run build`
      .env          <- copied from apps/web/.env.production.example
  deploy/           <- this directory (also cloned)
/etc/cloudflared/
  config.yml        <- copy of deploy/cloudflared/config.yml
  <TUNNEL_ID>.json  <- copied from cloudflared tunnel credentials
/etc/systemd/system/
  cloudflared.service         <- copy of deploy/cloudflared/cloudflared.service
  web-ai-api.service          <- copy of deploy/api/web-ai-api.service
```

---

## 1. Prerequisites

On the application host (`vps-ubuntu-24.04`):

- Node.js 20+ (`node --version`)
- npm 10+ (`npm --version`)
- systemd (default on Ubuntu 24.04)
- `cloudflared` installed (Cloudflare's official package, NOT in npm)
- Outbound HTTPS to `api.trycloudflare.com` and `api.cloudflare.com`
  (no inbound ports need to be open)

In Cloudflare:

- A `kiwicraft.in` account with the `chat.kiwicraft.in` hostname
  available to add as a Tunnel route.
- A Zero Trust or Tunnel license (free tier is enough).

---

## 2. Install cloudflared (one-time)

```bash
# Cloudflare's official apt repo (Ubuntu/Debian):
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
cloudflared --version
```

The version is the same one the systemd unit expects at
`/usr/local/bin/cloudflared` after the apt package installs; if the
binary lives elsewhere on your system, update the `ExecStart=` line
in `cloudflared.service` accordingly.

---

## 3. Clone and build the application

```bash
sudo useradd --system --home /opt/web-ai --shell /usr/sbin/nologin web-ai
sudo mkdir -p /opt/web-ai
sudo chown -R web-ai:web-ai /opt/web-ai
sudo -u web-ai git clone <your-fork-or-upstream-url> /opt/web-ai/repo
# Build artefacts land in repo/apps/{api,web}/dist. We symlink so the
# systemd unit's WorkingDirectory=/opt/web-ai points at a stable path.
sudo ln -s /opt/web-ai/repo /opt/web-ai/app
sudo -u web-ai bash -c 'cd /opt/web-ai/app && npm ci && npm run build'
```

If you prefer the install path to match the systemd unit exactly
(`/opt/web-ai/apps/api/...`), clone directly to `/opt/web-ai` and
adjust `WorkingDirectory` and the path inside the unit's
`EnvironmentFile` to match.

---

## 4. Create the production `.env` files

```bash
sudo cp /opt/web-ai/app/apps/api/.env.production.example \
        /opt/web-ai/app/apps/api/.env
sudo cp /opt/web-ai/app/apps/web/.env.production.example \
        /opt/web-ai/app/apps/web/.env
sudo chown web-ai:web-ai /opt/web-ai/app/apps/api/.env \
                       /opt/web-ai/app/apps/web/.env
sudo chmod 600 /opt/web-ai/app/apps/api/.env
```

Edit `/opt/web-ai/app/apps/api/.env` and set:

- `AI_GATEWAY_API_KEY=<paste from secret manager>`
- `AI_GATEWAY_MODELS=<comma-separated model ids you whitelisted>`

The web env does not need editing for the placeholder phase; edit
it only when enabling AdSense (see `docs/ADSENSE_REVIEW_CHECKLIST.md`).

---

## 5. Build the web bundle with the production env

The frontend reads `apps/web/.env` at build time. The default in
the production template is `VITE_ADS_PROVIDER=placeholder`, so a
straight `npm run build` is the right starting point.

```bash
sudo -u web-ai bash -c 'cd /opt/web-ai/app/apps/web && npm run build'
```

The output is `apps/web/dist/`. The systemd unit for the API does
not serve static assets; the frontend is served directly by
Cloudflare (see step 8 below) or by a separate static host. For
the simplest deploy, configure the tunnel ingress to point at the
Node API for `/api/*` and at a static host for everything else.

For the purposes of this runbook we keep the tunnel pointing at
the Node API for all paths. The Node API does not serve the
frontend; deploy the frontend separately to a static host (e.g.
Cloudflare Pages) or extend the tunnel with a second ingress rule
that serves the static files. See "frontend hosting" at the bottom
of this runbook.

---

## 6. Create the cloudflared system user

```bash
sudo useradd --system --home /var/lib/cloudflared \
  --shell /usr/sbin/nologin cloudflared
sudo mkdir -p /etc/cloudflared /var/lib/cloudflared
sudo chown -R cloudflared:cloudflared /etc/cloudflared /var/lib/cloudflared
```

---

## 7. Configure the Cloudflare Tunnel

In Cloudflare (one-time, in a browser):

1. Log in to the Cloudflare dashboard for `kiwicraft.in`.
2. Go to Zero Trust -> Networks -> Tunnels.
3. Create a tunnel named `web-ai` (Cloudflare assigns the UUID; the
   TUNNEL_ID).
4. Download the credentials JSON for the tunnel. Save it as
   `/etc/cloudflared/<TUNNEL_ID>.json` on the host and chown to
   `cloudflared:cloudflared` with mode 600.
5. Add a public hostname route:
   - Subdomain: `chat`
   - Domain: `kiwicraft.in`
   - Service: `http://127.0.0.1:8787`
   This is equivalent to what the local `config.yml` says.

Then install the local config:

```bash
sudo cp /opt/web-ai/app/deploy/cloudflared/config.yml \
        /etc/cloudflared/config.yml
sudo sed -i "s|<TUNNEL_ID>|$(sudo cat /etc/cloudflared/credentials.json 2>/dev/null | head -c 36 || echo <TUNNEL_ID>)|" \
        /etc/cloudflared/config.yml
# If you do not have the credentials file yet, edit the placeholder
# manually and replace <TUNNEL_ID> with the UUID Cloudflare assigned.
sudo chown cloudflared:cloudflared /etc/cloudflared/config.yml
sudo chmod 644 /etc/cloudflared/config.yml
```

---

## 8. Install the systemd units

```bash
sudo cp /opt/web-ai/app/deploy/cloudflared/cloudflared.service \
        /etc/systemd/system/cloudflared.service
sudo cp /opt/web-ai/app/deploy/api/web-ai-api.service \
        /etc/systemd/system/web-ai-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared web-ai-api
```

---

## 9. Status checks

```bash
sudo systemctl status cloudflared --no-pager
sudo systemctl status web-ai-api --no-pager
sudo journalctl -u cloudflared -n 50 --no-pager
sudo journalctl -u web-ai-api -n 50 --no-pager
```

Healthy output for `cloudflared`:

```text
Active: active (running)
...
INF Starting tunnel ... id=<TUNNEL_ID>
INF Registered tunnel connection ... index=0
```

Healthy output for `web-ai-api`:

```text
Active: active (running)
...
[api] listening on http://localhost:8787 (mock=..., cors=https://chat.kiwicraft.in, trust-proxy=1, ...)
```

---

## 10. Smoke tests

Run these from any host that can reach `chat.kiwicraft.in` over the
public internet (NOT from the application host's loopback; the
tunnel terminates on the public hostname, not on localhost).

```bash
curl -fsS https://chat.kiwicraft.in/api/health
# expected: {"ok":true}

curl -fsS https://chat.kiwicraft.in/api/metrics | head
# expected: Prometheus text format starting with # HELP

curl -fsSI https://chat.kiwicraft.in/ | head -1
# expected: HTTP/2 200

curl -fsS https://chat.kiwicraft.in/sitemap.xml
# expected: <loc>https://chat.kiwicraft.in/</loc>

curl -fsS https://chat.kiwicraft.in/robots.txt
# expected: Sitemap: https://chat.kiwicraft.in/sitemap.xml
```

If `/api/health` does not return `{"ok":true}`:

1. Check `journalctl -u web-ai-api` for the startup line. If the
   API failed to start, the most common cause is a malformed
   `.env` (e.g. `CORS_ORIGIN` left empty).
2. Check `cloudflared tunnel info web-ai` shows the connector
   connected. If not, check the credentials file and the
   `tunnel: web-ai` name matches what Cloudflare shows.

---

## 11. Logs

- `journalctl -u cloudflared -f`
- `journalctl -u web-ai-api -f`

For a structured-log format (Phase 4 recommended), the API still
uses `console.log`/`console.error`. A future Phase 4.1 may add a
JSON formatter; the verify suite at 191/191 already pins the
metrics endpoint that pair with structured logs.

---

## 12. Rollback

To roll back to the placeholder ad path (or to disable a bad
gateway config) without redeploying the static bundle:

1. Edit `/opt/web-ai/app/apps/api/.env`:
   - `VITE_ADS_PROVIDER=placeholder` is a build-time variable; it
     only takes effect after a rebuild and redeploy of the
     frontend.
   - `AI_GATEWAY_ENABLED=false` switches the backend to mock-only
     (or no providers if mock is also disabled).
2. `sudo systemctl restart web-ai-api`

For a full revert to a known-good build:

```bash
cd /opt/web-ai/app
sudo -u web-ai git checkout <known-good-sha>
sudo -u web-ai npm ci && sudo -u web-ai npm run build
sudo systemctl restart web-ai-api
```

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl /api/health` returns 502 | `web-ai-api` crashed or never started | `journalctl -u web-ai-api -n 100` |
| `curl /api/health` returns 504 | cloudflared cannot reach the local API | Check the tunnel shows the connector as connected; check the API is bound to 127.0.0.1:8787 (`ss -ltnp | grep 8787`) |
| All requests get 429 | Per-IP rate limit (`CHAT_RATE_LIMIT_MAX`) exhausted from a single IP | Confirm `TRUST_PROXY_HOPS=1` is set and the systemd unit has `--proxy-add-x-forwarded-for` |
| `/api/metrics` is empty | The Node API has just started and no traffic has hit the chat route | Send one request, then re-curl; the counters increment lazily |
| CORS error in browser | `CORS_ORIGIN` in `.env` does not match the public origin exactly | `https://chat.kiwicraft.in` (no trailing path, no `www.`, no `http://`) |
| AdSense shows "publisher id missing" | `VITE_ADSENSE_CLIENT` is empty in the web bundle | The bundle was built before the env was set; rebuild the frontend |

---

## Frontend hosting (out of scope of the two systemd units)

This runbook keeps the Node API unit responsible only for `/api/*`.
The static frontend is meant to be served by one of:

- **Cloudflare Pages** (recommended): push `apps/web/dist/` to a
  Cloudflare Pages project bound to `kiwicraft.in`. The Tunnel
  then only carries `/api/*` to the Node API.
- **A second tunnel ingress** pointing at a local static server
  (e.g. `caddy file_server` on a different loopback port). Less
  common.
- **Cloudflare R2 + Worker** for the static bundle; same idea as
  Pages but with explicit Worker routing.

Whichever option is chosen, the build artefact in
`apps/web/dist/` is the same; the systemd unit for the API does
not need to change.

