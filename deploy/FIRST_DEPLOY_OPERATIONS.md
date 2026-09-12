# WEB-AI First Production Deploy — Operator Script (copy-paste, section by section)

Run this ON the production host (`vps-ubuntu-24.04`) as `root` (or with
`sudo` per command). Paste **one section at a time**, read the output,
and paste the output back to the assistant for verification before
continuing to the next section. Every section ends with a `CHECK`
block whose output is what you paste back.

Three things in this script are **deliberately left as placeholders**
and Section 3 will refuse to continue until you replace them:

| Placeholder | What it is | Why it is not pre-filled |
|---|---|---|
| `ASK_TRUST_PROXY_HOPS` | `TRUST_PROXY_HOPS` in the API `.env` | Must match the REAL number of trusted proxy hops. Wrong value = clients can spoof `X-Forwarded-For` and bypass every per-IP rate limit. Confirm the topology first (Section 3). |
| `ASK_AI_GATEWAY_API_KEY` | The real AI-gateway credential | Secret. Never generated, guessed, or committed. Paste it only on the host, only into `.env`. |
| `ASK_MODEL_IDS` | The real allowlisted model ids | Operator decision — determines what every visitor can call. |

DNS (`chat.kiwicraft.in`) is also not set yet. Sections 0–7 work
WITHOUT DNS. Section 8 (external verification) needs the Cloudflare
dashboard steps in Section 5 done first.

Two facts about this codebase the original runbook did not account
for (both now fixed in the repo — `git pull` before starting):

1. The Node API serves **no static files**. A second systemd unit
   (`web-ai-web`, port 8788) serves `apps/web/dist`, and the tunnel
   routes non-`/api` paths to it.
2. `/api/metrics` is operator-only. The tunnel config now 403-blocks
   it at the edge; Prometheus must scrape it via loopback.

---

## Section 0 — Prerequisites check (no changes made)

```bash
set -e
echo "=== SECTION 0: prerequisites ==="
node --version || echo "FAIL: node missing"
npm --version || echo "FAIL: npm missing"
systemctl --version | head -1
cloudflared --version || echo "FAIL: cloudflared missing (Section 1 installs it)"
git --version
curl --version | head -1
echo "--- free disk ---"
df -h /opt || true
echo "--- is anything already on 8787/8788? ---"
ss -ltnp | grep -E ':8787|:8788' || echo "ports 8787/8788 free"
echo "=== END SECTION 0 ==="
```

**Paste back:** the entire block output. Do not continue if node < 20
or npm is missing.

---

## Section 1 — Install cloudflared (runbook §2, one-time)

Skip if Section 0 already showed a cloudflared version.

```bash
set -e
echo "=== SECTION 1: install cloudflared ==="
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' \
  | tee /etc/apt/sources.list.d/cloudflared.list
apt-get update -qq && apt-get install -y cloudflared
echo "--- CHECK ---"
cloudflared --version
which cloudflared   # must print /usr/bin/cloudflared or /usr/local/bin/cloudflared
echo "=== END SECTION 1 ==="
```

**Paste back:** version + path. If the path is NOT
`/usr/local/bin/cloudflared`, tell the assistant — the systemd unit's
`ExecStart` needs that exact path.

---

## Section 2 — Create user, clone straight to /opt/web-ai, build

This is the runbook §3 flow with the **clone-path fix**: the repo is
cloned DIRECTLY to `/opt/web-ai` (no `/opt/web-ai/repo` + symlink
scheme), because `deploy/api/web-ai-api.service` expects
`EnvironmentFile=/opt/web-ai/apps/api/.env` and
`WorkingDirectory=/opt/web-ai`.

```bash
set -e
echo "=== SECTION 2: user + clone + build (this takes a few minutes) ==="
id web-ai &>/dev/null || useradd --system --home /opt/web-ai --shell /usr/sbin/nologin web-ai
mkdir -p /opt/web-ai
chown -R web-ai:web-ai /opt/web-ai
if [ -d /opt/web-ai/.git ]; then
  echo "repo exists, pulling latest"
  sudo -u web-ai git -C /opt/web-ai pull --ff-only
else
  sudo -u web-ai git clone https://github.com/oomplay/web-ai.git /opt/web-ai
fi
echo "--- expected HEAD: ae11639 or newer ---"
git -C /opt/web-ai log --oneline -1
echo "--- npm ci + build (verbose; takes minutes) ---"
sudo -u web-ai bash -c 'cd /opt/web-ai && npm ci && npm run build'
echo "--- CHECK ---"
git -C /opt/web-ai log --oneline -1
ls -la /opt/web-ai/apps/api/dist/index.js || echo "FAIL: api build output missing"
ls -la /opt/web-ai/apps/web/dist/index.html || echo "FAIL: web build output missing"
ls /opt/web-ai/apps/web/dist/assets/ | head -5
echo "=== END SECTION 2 ==="
```

**Paste back:** the HEAD commit line, both `ls` lines, and the tail of
the build output (last ~20 lines). If `npm ci` or `npm run build`
fails, stop and paste the error.

---

## Section 3 — STOP: operator inputs, then write the real `.env` files

### 3a. Confirm the topology BEFORE filling `TRUST_PROXY_HOPS`

Answer these questions (to yourself, then tell the assistant the
answers with the paste-back):

1. Is there **only** Cloudflare Edge → cloudflared → Node API, with
   nothing else in the path? (No Cloudflare Access, no local nginx/
   caddy, no second tunnel proxy, no corporate LB.)
2. If yes → `TRUST_PROXY_HOPS=1` is correct (Cloudflare Edge is the
   one trusted hop that sets `X-Forwarded-For`; the local cloudflared
   daemon does not count as a hop).
3. If anything else sits in the path → STOP and tell the assistant
   what the path looks like. Do NOT guess a number.

The script below writes the value as `ASK_TRUST_PROXY_HOPS` and the
gate in 3b refuses to boot until you replace it with the confirmed
number.

### 3b. Write `.env` files (with placeholders), then fill secrets by hand

```bash
set -e
echo "=== SECTION 3: write env templates ==="
# ---- API env (placeholders intact on purpose) ----
cat > /opt/web-ai/apps/api/.env <<'EOF'
# WEB-AI API production env — SECRETS IN THIS FILE, NEVER COMMIT.
# Topology: Internet -> Cloudflare Edge (TLS) -> cloudflared -> 127.0.0.1:8787
PORT=8787
CORS_ORIGIN=https://chat.kiwicraft.in
# !!! FILL BY HAND after confirming topology (Section 3a). Do not guess.
TRUST_PROXY_HOPS=ASK_TRUST_PROXY_HOPS
MOCK_PROVIDER_ENABLED=false
MODEL_CONFIG_FILE=models.config.json
AI_GATEWAY_ENABLED=true
AI_GATEWAY_BASE_URL=https://ai-gateway.kiwicraft.in/v1
# !!! FILL BY HAND from your secret manager. Never commit.
AI_GATEWAY_API_KEY=ASK_AI_GATEWAY_API_KEY
# Fallback only (models.config.json takes precedence). Comma-separated.
AI_GATEWAY_MODELS=
AI_GATEWAY_MODEL_LABELS=
AI_GATEWAY_ALLOWED_HOSTS=ai-gateway.kiwicraft.in
AI_GATEWAY_TIMEOUT_MS=30000
AI_GATEWAY_SPLIT_THINKING_MODELS=
AI_GATEWAY_SPLIT_THINKING=false
CHAT_RATE_LIMIT_WINDOW_MS=60000
CHAT_RATE_LIMIT_MAX=30
MODELS_RATE_LIMIT_WINDOW_MS=60000
MODELS_RATE_LIMIT_MAX=120
MAX_CONCURRENT_STREAMS_PER_IP=3
MAX_CONCURRENT_REQUESTS_PER_IP=10
MAX_MESSAGES=100
MAX_MESSAGE_LENGTH=32000
MAX_TOTAL_CHARS=200000
SSE_IDLE_TIMEOUT_MS=30000
SSE_MAX_DURATION_MS=120000
SSE_KEEPALIVE_MS=15000
PROVIDER_TIMEOUT_MS=30000
EOF
# ---- Web env (build-time; no edits needed for the placeholder-ad start) ----
cat > /opt/web-ai/apps/web/.env <<'EOF'
# Vite inlines these at BUILD time. Rerun `npm run build` after any change.
VITE_API_BASE_URL=https://chat.kiwicraft.in
VITE_ADS_PROVIDER=placeholder
VITE_ADSENSE_CLIENT=
VITE_ADSENSE_SLOT_BOTTOM=
VITE_ADSENSE_NPA=false
EOF
# ---- Model config (hot-reloadable allowlist; lives next to the API CWD) ----
cat > /opt/web-ai/models.config.json <<'EOF'
{
  "models": ["ASK_MODEL_IDS"],
  "labels": {},
  "splitThinkingModels": []
}
EOF
chown web-ai:web-ai /opt/web-ai/apps/api/.env /opt/web-ai/apps/web/.env /opt/web-ai/models.config.json
chmod 600 /opt/web-ai/apps/api/.env
chmod 644 /opt/web-ai/apps/web/.env /opt/web-ai/models.config.json
echo "--- CHECK: placeholder gate (must say REMAINING: none or list them) ---"
grep -n "ASK_" /opt/web-ai/apps/api/.env /opt/web-ai/models.config.json || echo "REMAINING: none"
echo "--- CHECK: .env is git-ignored (must print nothing / be ignored) ---"
git -C /opt/web-ai check-ignore apps/api/.env && echo "OK: .env ignored by git" || echo "WARN: .env NOT git-ignored"
git -C /opt/web-ai status --short | head -10
echo "=== END SECTION 3 ==="
```

**NOW, by hand (not in the script):**

1. `nano /opt/web-ai/apps/api/.env` → replace `ASK_TRUST_PROXY_HOPS`
   with the number confirmed in 3a (expected: `1` if the topology is
   exactly Edge → cloudflared → Node) and `ASK_AI_GATEWAY_API_KEY`
   with the real key.
2. `nano /opt/web-ai/models.config.json` → replace `ASK_MODEL_IDS`
   with the real allowlisted model ids, e.g.
   `{"models": ["openai/gpt-4o-mini"], "labels": {"openai/gpt-4o-mini": "GPT-4o mini"}, "splitThinkingModels": []}`.
   Add every id the gateway actually exposes that you want public.
3. **If you rebuilt nothing yet — no action. If you changed
   `apps/web/.env`, rerun `sudo -u web-ai bash -c 'cd /opt/web-ai/apps/web && npm run build'`.**

**Paste back:** the `REMAINING:` line (must be `none` after your
manual edits — rerun the grep to prove it), the git-ignore check
line, the confirmed topology answer from 3a, and the final
`models.config.json` contents **with the key redacted** (never paste
the API key anywhere).

---

## Section 4 — Loopback smoke test (no systemd, no DNS needed)

Proves the API boots with the real `.env` and answers correctly on
loopback before anything is installed as a service.

```bash
set -e
echo "=== SECTION 4: loopback smoke test ==="
cd /opt/web-ai
set -a; source apps/api/.env; set +a
sudo -u web-ai env PORT=8787 MODEL_CONFIG_FILE=/opt/web-ai/models.config.json \
  node apps/api/dist/index.js > /tmp/web-ai-smoke.log 2>&1 &
SMOKE_PID=$!
sleep 3
echo "--- boot log ---"; cat /tmp/web-ai-smoke.log
echo "--- /api/health ---";      curl -fsS http://127.0.0.1:8787/api/health; echo
echo "--- /api/models ---";      curl -fsS http://127.0.0.1:8787/api/models; echo
echo "--- /api/metrics (loopback must work) ---"
curl -fsS http://127.0.0.1:8787/api/metrics | head -5
echo "--- static server smoke ---"
sudo -u web-ai node /opt/web-ai/deploy/web-static/static-server.mjs > /tmp/web-static-smoke.log 2>&1 &
STATIC_PID=$!
sleep 2
curl -fsS http://127.0.0.1:8788/ | head -3
cat /tmp/web-static-smoke.log
kill $SMOKE_PID $STATIC_PID 2>/dev/null || true
echo "=== END SECTION 4 ==="
```

Expected: boot log shows `listening on http://localhost:8787` with
`cors=https://chat.kiwicraft.in`, `mock=false`, and your
`trust-proxy` number; health is `{"ok":true}`; models is a JSON array
of YOUR ids (not HTML, not mock ids); metrics prints Prometheus text.

**Paste back:** everything the block printed, with the API key line
redacted if it appears anywhere.

---

## Section 5 — CLOUDFLARE DASHBOARD (do by hand, browser + logged-in CLI)

These steps need YOUR Cloudflare credentials. Do not try to script
them. Order matters; the script sections that follow depend on 5c.

1. **Authorize:** on the host run `cloudflared tunnel login` and open
   the printed URL in your browser; pick the `kiwicraft.in` zone.
   This writes `~/.cloudflared/cert.pem` (root's home).
2. **Create the tunnel:** `cloudflared tunnel create web-ai`
   → note the printed TUNNEL_ID (a UUID) and the credentials file it
   writes (`~/.cloudflared/<TUNNEL_ID>.json`).
3. **DNS route (this is what fixes the missing `chat` record):**
   `cloudflared tunnel route dns web-ai chat.kiwicraft.in`
4. **Install credentials + config:**

```bash
set -e
echo "=== SECTION 5: install tunnel credentials + config ==="
read -rp "Paste the TUNNEL_ID (UUID): " TUNNEL_ID
mkdir -p /etc/cloudflared
cp ~/.cloudflared/${TUNNEL_ID}.json /etc/cloudflared/${TUNNEL_ID}.json
cp /opt/web-ai/deploy/cloudflared/config.yml /etc/cloudflared/config.yml
sed -i "s|<TUNNEL_ID>|${TUNNEL_ID}|g" /etc/cloudflared/config.yml
id cloudflared &>/dev/null || useradd --system --home /var/lib/cloudflared --shell /usr/sbin/nologin cloudflared
mkdir -p /var/lib/cloudflared
chown -R cloudflared:cloudflared /etc/cloudflared /var/lib/cloudflared
chmod 600 /etc/cloudflared/${TUNNEL_ID}.json
echo "--- CHECK ---"
grep -E "tunnel:|credentials-file:" /etc/cloudflared/config.yml
grep -A1 "path: ^/api/metrics" /etc/cloudflared/config.yml || echo "FAIL: metrics-block rule missing"
nslookup chat.kiwicraft.in 1.1.1.1 | tail -4
echo "=== END SECTION 5 ==="
```

**Paste back:** the grep outputs and the nslookup result. The
nslookup must now resolve (a CNAME to `<TUNNEL_ID>.cfargotunnel.com`).
If it does not, stop — Section 8 cannot run without DNS.

---

## Section 6 — Install systemd units (API + static web + tunnel)

```bash
set -e
echo "=== SECTION 6: systemd units ==="
cp /opt/web-ai/deploy/cloudflared/cloudflared.service /etc/systemd/system/cloudflared.service
cp /opt/web-ai/deploy/api/web-ai-api.service /etc/systemd/system/web-ai-api.service
cp /opt/web-ai/deploy/web-static/web-ai-web.service /etc/systemd/system/web-ai-web.service
systemctl daemon-reload
systemctl enable --now web-ai-api web-ai-web cloudflared
sleep 4
echo "--- CHECK: units ---"
systemctl is-active web-ai-api web-ai-web cloudflared
echo "--- CHECK: ExecStart lines (cloudflared MUST contain --proxy-add-x-forwarded-for) ---"
grep ExecStart /etc/systemd/system/cloudflared.service
echo "--- CHECK: boot log of API ---"
journalctl -u web-ai-api -n 15 --no-pager | tail -8
echo "--- CHECK: loopback endpoints through the real services ---"
curl -fsS http://127.0.0.1:8787/api/health; echo
curl -fsS http://127.0.0.1:8788/ -o /dev/null -w "static: %{http_code}\n"
echo "--- CHECK: both ports bound to LOOPBACK only ---"
ss -ltnp | grep -E ':8787|:8788'
echo "=== END SECTION 6 ==="
```

Expected: all three units `active`; cloudflared ExecStart contains
`--proxy-add-x-forwarded-for`; `ss` shows `127.0.0.1:8787` and
`127.0.0.1:8788` (NOT `0.0.0.0` or `*`). If `ss` shows a non-loopback
bind, STOP and report — that is a direct-internet exposure.

**Paste back:** all four CHECK blocks.

---

## Section 7 — Firewall (defence-in-depth; do not skip)

The API currently binds all interfaces at the OS level
(`app.listen(port)` without a host). systemd hardening does not fix
that; the firewall does. This closes the XFF-spoofing hole from any
direct hit on 8787/8788.

```bash
set -e
echo "=== SECTION 7: firewall ==="
apt-get install -y ufw
ufw default deny incoming
ufw allow OpenSSH
ufw --force enable
ufw status verbose
echo "--- CHECK: 8787/8788 unreachable from the public interface ---"
PUBIP=$(hostname -I | awk '{print $1}')
curl -s -m 3 -o /dev/null -w "8787 via public IP: %{http_code} (000 = blocked, GOOD)\n" http://${PUBIP}:8787/api/health || echo "8787 via public IP: blocked (GOOD)"
curl -s -m 3 -o /dev/null -w "8788 via public IP: %{http_code} (000 = blocked, GOOD)\n" http://${PUBIP}:8788/ || echo "8788 via public IP: blocked (GOOD)"
echo "=== END SECTION 7 ==="
```

**Paste back:** `ufw status verbose` + the two curl lines. If your
host uses a cloud-security-group instead of ufw, do the equivalent
deny there and say so in the paste-back.

---

## Section 8 — EXTERNAL verification (needs Sections 5c's DNS + 6 + 7 done)

Run this section ON the host first, then repeat the same curls from
your local machine (the assistant will also run them from the dev
machine). Paste both outputs.

```bash
set -e
echo "=== SECTION 8: external verification via https://chat.kiwicraft.in ==="
B=https://chat.kiwicraft.in
echo "--- 1. health ---"
curl -fsS $B/api/health; echo
echo "--- 2. models must be JSON, not HTML (past incident) ---"
curl -fsS $B/api/models
echo
echo "--- 3. metrics MUST be blocked from outside (expect 403) ---"
curl -s -o /dev/null -w "metrics: %{http_code} (want 403)\n" $B/api/metrics
echo "--- 4. SPA root ---"
curl -fsS -o /dev/null -w "root: %{http_code}\n" $B/
echo "--- 5. SEO files ---"
curl -fsS $B/robots.txt | head -3
curl -fsS $B/sitemap.xml | head -3
echo "--- 6. ads.txt placeholder ---"
curl -fsS $B/ads.txt | head -3
echo "=== END SECTION 8 ==="
```

Expected: 1 → `{"ok":true}`; 2 → JSON with YOUR model ids; 3 → 403;
4 → 200; 5/6 → the production-origin content.

**Then the human E2E test (no script can do this part):** open
`https://chat.kiwicraft.in` in a real browser, send a chat message,
and confirm: the reply streams in, the thinking panel renders (for
models with thinking), the bottom ad slot rotates placeholders, and
the model picker shows your real model labels. Paste a screenshot or
describe what you saw.

---

## Final paste-back summary (what the assistant needs to verify)

1. Section 0 output
2. Section 2 HEAD commit + build `ls` lines
3. Section 3: `REMAINING: none` proof + topology confirmation + redacted `models.config.json`
4. Section 4 full output
5. Section 5 greps + DNS nslookup
6. Section 6 all CHECK blocks
7. Section 7 ufw + reachability lines
8. Section 8 full output + browser E2E description
9. Anything that failed or looked off, verbatim

## Known discrepancies vs the original runbook (already fixed in repo)

| # | Discrepancy | Fix (already committed to `deploy/` in the repo — `git pull` on the host gets it) |
|---|---|---|
| 1 | Runbook §3 clone layout (`/opt/web-ai/repo` + symlink) contradicts the systemd unit's `EnvironmentFile=/opt/web-ai/apps/api/.env` | Script clones directly to `/opt/web-ai` |
| 2 | `cloudflared.service` comment promised `--proxy-add-x-forwarded-for` but `ExecStart` lacked it → per-IP rate limit would collapse to one counter | Flag added to `ExecStart` in `deploy/cloudflared/cloudflared.service` |
| 3 | Runbook §10 smoke tests expected `GET /` to return 200, but the API serves no static files → every non-API path would 502 | New `deploy/web-static/` static server + `web-ai-web.service` + tunnel ingress rule for non-API paths |
| 4 | Tunnel config forwarded `/api/metrics` publicly, contradicting the loopback-only requirement | `path: ^/api/metrics$` → 403 ingress rule added ahead of the API rule |
| 5 | API binds `0.0.0.0` (code), runbooks claim loopback-only | Section 7 firewall closes it; a code-level `HOST` env fix should follow later |
