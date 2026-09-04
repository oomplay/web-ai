// Phase 2B: live integration tests for the KiwiCraft AI Gateway provider.
//
// Spawns a local mock HTTP server that emulates the upstream, plus a
// second backend instance pointed at the mock. The real KiwiCraft
// gateway is NEVER contacted.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const TEST_KEY = 'sk-test-' + 'x'.repeat(20); // never real
const TEST_HOST = '127.0.0.1';

function startMockGateway() {
  return new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = new URL(req.url, 'http://' + TEST_HOST);
        requests.push({
          method: req.method,
          path: url.pathname + url.search,
          headers: { ...req.headers },
          body,
        });
        // Test hook: a user message whose content starts with `force-XXX`
        // makes the mock gateway return the upstream error code named
        // by XXX. The verify harness exercises this to assert that the
        // application sanitises upstream 5xx / 4xx into a user-safe
        // message instead of echoing the upstream's body.
        const forced = (() => {
          try {
            const parsed = JSON.parse(body || '{}');
            const last = Array.isArray(parsed.messages)
              ? [...parsed.messages].reverse().find(
                  (m) => m && m.role === 'user' && typeof m.content === 'string',
                )
              : null;
            const c = last && last.content ? last.content : '';
            const m = /^force-(\d{3})/.exec(c);
            return m ? m[1] : '';
          } catch {
            return '';
          }
        })();
        if (forced === '500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end('{"error":{"message":"upstream is on fire"}}');
          return;
        }
        if (forced === '401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end('{"error":{"message":"bad key"}}');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
        setTimeout(() => {
          res.write('data: {"choices":[{"delta":{"content":"world"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }, 20);
      });
    });
    server.on('error', reject);
    server.listen(0, TEST_HOST, () => {
      const addr = server.address();
      if (typeof addr === 'string' || !addr) {
        reject(new Error('mock gateway: no address'));
        return;
      }
      resolve({
        port: addr.port,
        url: `http://${TEST_HOST}:${addr.port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function startBackendWithGateway(baseUrl) {
  const proc = spawn(
    process.execPath,
    ['apps/api/dist/index.js'],
    {
      env: {
        ...process.env,
        CHAT_RATE_LIMIT_MAX: '1000',
        MAX_CONCURRENT_STREAMS_PER_IP: '50',
        MAX_TOTAL_CHARS: '30000',
        MOCK_CHUNK_DELAY_MS: '0',
        AI_GATEWAY_ENABLED: 'true',
        AI_GATEWAY_BASE_URL: baseUrl + '/v1',
        AI_GATEWAY_API_KEY: TEST_KEY,
        AI_GATEWAY_MODELS: 'mock-model-a,mock-model-b',
        AI_GATEWAY_ALLOWED_HOSTS: TEST_HOST,
        AI_GATEWAY_TIMEOUT_MS: '2000',
        // The harness points at a local 127.0.0.1 mock, so the SSRF
        // private/loopback guard is explicitly relaxed. The provider
        // code refuses to honour this opt-out when NODE_ENV=production.
        AI_GATEWAY_ALLOW_LOOPBACK: 'true',
        TRUST_PROXY_HOPS: '0',
        CORS_ORIGIN: 'http://localhost:5173',
      },
      stdio: 'ignore',
    },
  );
  // Wait for the new backend to bind 8787. We retry hard because the
  // OS may take a moment to release the port after the previous
  // process was killed.
  for (let i = 0; i < 80; i++) {
    await wait(250);
    const r = await fetch('http://127.0.0.1:8787/api/health')
      .then((r) => r.json().catch(() => null))
      .catch(() => null);
    if (r && r.ok) return proc;
  }
  proc.kill('SIGKILL');
  throw new Error('backend with gateway never came up');
}

function startBackendOnDefaultPort() {
  // Respawn the default backend (no gateway). Mirrors the env that
  // verify.mjs uses for its primary backend instance.
  const proc = spawn(
    process.execPath,
    ['apps/api/dist/index.js'],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        TRUST_PROXY_HOPS: '1',
        MOCK_CHUNK_DELAY_MS: '150',
        MAX_TOTAL_CHARS: '30000',
        MAX_CONCURRENT_STREAMS_PER_IP: '50',
        CHAT_RATE_LIMIT_MAX: '200',
      },
    },
  );
  return new Promise((resolve, reject) => {
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      const r = await fetch('http://127.0.0.1:8787/api/health')
        .then((r) => r.json().catch(() => null))
        .catch(() => null);
      if (r && r.ok) {
        clearInterval(t);
        resolve(proc);
      } else if (tries > 40) {
        clearInterval(t);
        reject(new Error('default backend never came up'));
      }
    }, 250);
  });
}

async function stopBackend(proc) {
  if (!proc) return;
  // Send SIGKILL (not SIGTERM) so the OS releases the listening port
  // immediately. We do NOT need a graceful shutdown here — the parent
  // process is a test harness and a clean exit is the only acceptable
  // outcome.
  try {
    proc.kill('SIGKILL');
  } catch {
    /* noop */
  }
  await new Promise((r) => {
    const t = setTimeout(r, 1500);
    proc.once('exit', () => {
      clearTimeout(t);
      r();
    });
  });
}

export async function runGatewayLiveChecks(existingBackend, record) {
  const mock = await startMockGateway();
  // If the caller already spawned a backend, stop it so we can rebind
  // port 8787 for the gateway-enabled instance. We always restart the
  // default backend in `finally` so subsequent test sections (or the
  // operator) see a sane state.
  const hadExisting = !!existingBackend;
  // eslint-disable-next-line no-console
  console.log('[verify-gateway] hadExisting:', hadExisting);
  if (hadExisting) {
    await stopBackend(existingBackend);
    // Give the OS a moment to release the port. Node's http server
    // close() is asynchronous, and on Windows TIME_WAIT can hold the
    // port for several seconds.
    await wait(1000);
    // eslint-disable-next-line no-console
    console.log('[verify-gateway] default backend stopped, port released');
  }
  // eslint-disable-next-line no-console
  console.log('[verify-gateway] spawning gateway backend...');
  const backend = await startBackendWithGateway(mock.url);
  // eslint-disable-next-line no-console
  console.log('[verify-gateway] gateway backend up');
  let restored = false;
  async function restoreDefault() {
    if (restored || !hadExisting) return;
    restored = true;
    try {
      await startBackendOnDefaultPort();
    } catch (e) {
      console.error('[verify] failed to restore default backend:', e);
    }
  }
  // We intentionally do NOT wrap the test body in try/catch so that
  // assertion failures (which throw) propagate to the caller. The
  // outer finally in this function still runs because the catch in
  // `runGatewayLiveChecks`'s caller re-raises after cleanup. To make
  // sure the default backend is restored even when the gateway
  // backend fails to start, wrap the start in its own try/catch.
  let body;
  try {
    // 1) /api/models lists the allowlisted ids, marked with the
    //    `ai-gateway` provider, and does NOT contain the API key.
    const modelsRes = await fetch('http://127.0.0.1:8787/api/models');
    body = await modelsRes.json();
    const ids = (body.models || []).map((m) => m.id);
    const providerSet = new Set(
      (body.models || []).map((m) => m.provider),
    );
    record(
      '/api/models lists allowlisted AI gateway model ids',
      ids.includes('mock-model-a') && ids.includes('mock-model-b'),
      ids.join(','),
    );
    record(
      '/api/models marks gateway models with provider "ai-gateway"',
      providerSet.has('ai-gateway'),
      Array.from(providerSet).join(','),
    );
    record(
      '/api/models does NOT contain the API key',
      !JSON.stringify(body).includes(TEST_KEY),
    );

    // 2) /api/health does NOT contain the API key.
    const healthBody = await fetch('http://127.0.0.1:8787/api/health').then(
      (r) => r.text(),
    );
    record(
      '/api/health does NOT contain the API key',
      !healthBody.includes(TEST_KEY),
    );

    // 3) Streaming end-to-end through the gateway.
    const chatRes = await fetch('http://127.0.0.1:8787/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model-a',
        messages: [{ role: 'user', content: 'live' }],
      }),
    });
    record(
      'live: /api/chat -> 200 + text/event-stream',
      chatRes.status === 200 &&
        (chatRes.headers.get('content-type') || '').includes('text/event-stream'),
    );
    const chatBuf = await new Response(chatRes.body).text();
    const deltas = (chatBuf.match(/"delta":"([^"]*)"/g) || [])
      .map((m) => m.replace(/"delta":"/, '').replace(/"$/, ''))
      .join('');
    record(
      'live: deltas concatenated to "Hello world"',
      deltas === 'Hello world',
      'deltas=' + JSON.stringify(deltas),
    );
    record('live: [DONE] terminator present', chatBuf.includes('[DONE]'));

    // 4) Mock gateway received the request with the right shape.
    const lastReq = mock.requests[mock.requests.length - 1];
    record(
      'live: upstream POST /v1/chat/completions',
      lastReq && lastReq.method === 'POST' && lastReq.path === '/v1/chat/completions',
      lastReq && lastReq.path,
    );
    record(
      'live: Authorization: Bearer <key> present',
      lastReq && /^Bearer /.test(lastReq.headers['authorization'] || ''),
      lastReq && lastReq.headers['authorization'],
    );
    record(
      'live: Authorization header contains the key',
      lastReq && lastReq.headers['authorization'] === 'Bearer ' + TEST_KEY,
    );
    record(
      'live: API key NOT in URL query string',
      !/\?.*(api[_-]?key|token)=/i.test(lastReq?.path || ''),
      lastReq && lastReq.path,
    );
    record(
      'live: Content-Type is application/json',
      lastReq && lastReq.headers['content-type'] === 'application/json',
      lastReq && lastReq.headers['content-type'],
    );
    let parsedBody = null;
    try { parsedBody = JSON.parse(lastReq?.body || '{}'); } catch { /* */ }
    record(
      'live: body.model is the whitelisted model id',
      parsedBody && parsedBody.model === 'mock-model-a',
      parsedBody && parsedBody.model,
    );
    record(
      'live: body.stream is true',
      parsedBody && parsedBody.stream === true,
      parsedBody && String(parsedBody.stream),
    );
    record(
      'live: body.messages echoes the user message',
      parsedBody &&
        Array.isArray(parsedBody.messages) &&
        parsedBody.messages[0]?.content === 'live',
      parsedBody && JSON.stringify(parsedBody.messages),
    );

    // 5) Arbitrary model id (NOT in the allowlist) -> 404.
    const badRes = await fetch('http://127.0.0.1:8787/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'totally-made-up',
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    record(
      'live: arbitrary model id -> 404',
      badRes.status === 404,
      'status=' + badRes.status,
    );
    if (badRes.body) { try { await badRes.arrayBuffer(); } catch { /* */ } }

    // 6) Upstream 500 -> sanitised "temporarily unavailable" message.
    const e500 = await fetch('http://127.0.0.1:8787/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model-b',
        messages: [{ role: 'user', content: 'force-500' }],
      }),
    });
    const e500Buf = await new Response(e500.body).text();
    record(
      'live: upstream 500 -> sanitised "temporarily unavailable"',
      e500.status === 200 && /temporarily unavailable/.test(e500Buf),
      e500Buf.slice(0, 200),
    );

    // 7) Upstream 401 -> sanitised "authentication failed" message.
    const e401 = await fetch('http://127.0.0.1:8787/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model-b',
        messages: [{ role: 'user', content: 'force-401' }],
      }),
    });
    const e401Buf = await new Response(e401.body).text();
    record(
      'live: upstream 401 -> sanitised "authentication failed"',
      e401.status === 200 && /authentication failed/.test(e401Buf),
      e401Buf.slice(0, 200),
    );
  } finally {
    await stopBackend(backend);
    await mock.close();
    await restoreDefault();
  }
}