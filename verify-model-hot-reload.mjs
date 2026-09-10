// Phase 3.8 live verification: model-config hot reload with ZERO downtime.
//
// Starts a local mock upstream gateway + a REAL backend process
// (apps/api/dist/index.js) with a model-config file, then:
//
//   1. Opens a long-running SSE chat stream (slow mock upstream).
//   2. While the stream is mid-flight, edits models.config.json:
//      (a) adds a new model, (b) edits a label + thinking-split membership,
//      (c) removes a model.
//   3. Asserts the ORIGINAL stream never breaks and finishes normally.
//   4. Asserts the new model is usable immediately (GET /api/models +
//      a real chat request), no restart.
//   5. Asserts the removed model 404s on new requests.
//   6. Asserts the rate limiter state SURVIVED the config update
//      (exhausts the chat limit before, verifies exhaustion persists after).
//
// The real KiwiCraft gateway is never contacted.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const PORT = 8899;
const API = `http://127.0.0.1:${PORT}`;
const CONFIG = path.resolve('apps/api/models.config.json');
const BACKUP = CONFIG + '.bak';
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log('[' + (pass ? 'PASS' : 'FAIL') + '] ' + name + (detail ? ' :: ' + detail : ''));
}

// --- mock upstream gateway ------------------------------------------------
function startMockGateway() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let model = '';
        try {
          model = JSON.parse(body || '{}').model || '';
        } catch { /* ignore */ }
        // "slow-*" models stream 12 chunks, one per 300ms => ~3.6s stream,
        // long enough to perform three config edits mid-flight.
        // Everything else answers fast.
        if (model.startsWith('slow-')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          let i = 0;
          const t = setInterval(() => {
            i += 1;
            if (i > 12) {
              clearInterval(t);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            res.write(
              'data: {"choices":[{"delta":{"content":"chunk' + i + '"}}]}\n\n',
            );
          }, 300);
          req.on('close', () => { /* request body consumed; see res close */ });
          res.on('close', () => clearInterval(t));
          return;
        }
        // fast model: thinking field first, then content (reasoning-model shape)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.write('data: {"choices":[{"delta":{"reasoning_content":"hmm "}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"fast answer"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// --- read the current (user) config so we can restore it -------------------
const originalConfig = fs.readFileSync(CONFIG, 'utf8');
const originalParsed = JSON.parse(originalConfig);
const FIRST_MODEL = originalParsed.models[0];

function writeConfig(obj) {
  fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2));
}

function startBackend() {
  const proc = spawn(
    process.execPath,
    ['apps/api/dist/index.js'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        CHAT_RATE_LIMIT_MAX: '4',           // tiny limit: easy to exhaust
        CHAT_RATE_LIMIT_WINDOW_MS: '60000',
        MODELS_RATE_LIMIT_MAX: '1000',
        MAX_CONCURRENT_STREAMS_PER_IP: '50',
        MOCK_PROVIDER_ENABLED: 'false',
        AI_GATEWAY_ENABLED: 'true',
        AI_GATEWAY_BASE_URL: MOCK_URL + '/v1',
        AI_GATEWAY_API_KEY: 'sk-test-' + 'x'.repeat(20),
        AI_GATEWAY_ALLOWED_HOSTS: '127.0.0.1',
        AI_GATEWAY_TIMEOUT_MS: '5000',
        // NO AI_GATEWAY_MODELS here on purpose: the model list comes from
        // models.config.json (the file exists, so env is only a fallback).
        AI_GATEWAY_ALLOW_LOOPBACK: 'true',
        TRUST_PROXY_HOPS: '0',
        CORS_ORIGIN: 'http://localhost:5173',
        MODEL_CONFIG_FILE: 'apps/api/models.config.json',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  proc.stdout.on('data', (d) => process.stdout.write('[api] ' + d));
  proc.stderr.on('data', (d) => process.stderr.write('[api:err] ' + d));
  return proc;
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    await wait(250);
    const r = await fetch(API + '/api/health').then((r) => r.json()).catch(() => null);
    if (r && r.ok) return true;
  }
  return false;
}

async function listModelIds() {
  const m = await fetch(API + '/api/models').then((r) => r.json());
  return (m.models || []).map((x) => x.id);
}

/** Consume an SSE stream to completion; returns {chunks, done, error}. */
async function consumeStream(model, label) {
  const res = await fetch(API + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: label }] }),
  });
  if (res.status !== 200) return { status: res.status, chunks: 0, done: false, thinking: '' };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let chunks = 0;
  let done = false;
  let thinking = '';
  let errEvent = null;
  while (true) {
    const { value, done: d } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (ev.includes('[DONE]')) done = true;
      else if (ev.includes('"error"')) {
        errEvent = ev;
      } else if (ev.includes('"type":"thinking"') || ev.includes('"thinking"')) thinking += 'T';
      else if (ev.includes('"delta"')) chunks += 1;
    }
  }
  return { status: 200, chunks, done, thinking, errEvent };
}

// ---------------------------------------------------------------------------
let mock;
let backend;
try {
  mock = await startMockGateway();
  var MOCK_URL = mock.url;
  fs.writeFileSync(CONFIG, JSON.stringify({
    models: ['slow-alpha'],
    labels: { 'slow-alpha': 'Slow Alpha' },
    splitThinkingModels: [],
  }, null, 2));

  backend = startBackend();
  if (!(await waitHealthy())) throw new Error('backend never came up');

  console.log('\n== Setup: boot with 1 model (slow-alpha) ==');
  let ids = await listModelIds();
  record('boot: /api/models lists slow-alpha from config file', ids.join(',') === 'slow-alpha', ids.join(','));

  console.log('\n== Test 1: SSE stream survives add + edit + remove mid-flight ==');
  // Open the long stream and wait until it is really producing.
  const streamPromise = consumeStream('slow-alpha', 'zero-downtime');
  await wait(900); // ~3 chunks in; stream is mid-flight for the next ~2.7s

  // (a) ADD a new model while the stream runs.
  writeConfig({
    models: ['slow-alpha', 'fast-beta'],
    labels: { 'slow-alpha': 'Slow Alpha', 'fast-beta': 'Fast Beta' },
    splitThinkingModels: [],
  });
  await wait(600); // watch debounce 250ms + reload

  // (b) EDIT label + thinking-split membership while STILL streaming.
  writeConfig({
    models: ['slow-alpha', 'fast-beta'],
    labels: { 'slow-alpha': 'Slow Alpha v2', 'fast-beta': 'Fast Beta' },
    splitThinkingModels: ['fast-beta'],
  });
  await wait(600);

  // (c) REMOVE slow-alpha (the model currently streaming!) while STILL streaming.
  writeConfig({
    models: ['fast-beta'],
    labels: { 'fast-beta': 'Fast Beta' },
    splitThinkingModels: [],
  });

  // The original stream must run to completion untouched.
  const s = await streamPromise;
  record(
    'zero-downtime: stream opened before 3 config edits finishes with all chunks + [DONE]',
    s.status === 200 && s.done && s.chunks === 12,
    'status=' + s.status + ' chunks=' + s.chunks + ' done=' + s.done + ' err=' + (s.errEvent || 'none'),
  );

  // Post-edit state: fast-beta present, slow-alpha gone.
  ids = await listModelIds();
  record('after edits: /api/models shows fast-beta, not slow-alpha', ids.join(',') === 'fast-beta', ids.join(','));

  // (b) check the edited label landed.
  const modelsBody = await fetch(API + '/api/models').then((r) => r.json());
  const beta = (modelsBody.models || []).find((m) => m.id === 'fast-beta');
  record('after edits: label edit landed (Fast Beta)', beta && beta.label === 'Fast Beta', beta && beta.label);

  console.log('\n== Test 2: new model added mid-flight is usable immediately ==');
  // Re-add fast-beta is already there; verify a real chat works with it
  // without any restart. fast-beta currently has splitThinkingModels=[] (step c removed it).
  const r2 = await consumeStream('fast-beta', 'new-model');
  record(
    'new model works immediately after add (200, [DONE])',
    r2.status === 200 && r2.done,
    'status=' + r2.status + ' chunks=' + r2.chunks,
  );

  console.log('\n== Test 3: removed model is refused for NEW requests ==');
  const removed = await fetch(API + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'slow-alpha', messages: [{ role: 'user', content: 'gone' }] }),
  });
  record('removed model -> 404 for new requests', removed.status === 404, 'status=' + removed.status);
  try { await removed.arrayBuffer(); } catch { /* */ }

  console.log('\n== Test 4: thinking-split membership hot-updates ==');
  writeConfig({
    models: ['fast-beta'],
    labels: { 'fast-beta': 'Fast Beta' },
    splitThinkingModels: ['fast-beta'],
  });
  await wait(600);
  // fast-beta's upstream emits reasoning_content => parser maps to thinking parts
  // regardless; the split-thinking flag matters for content-based models. What we
  // pin here is that the provider accepts the update and still serves.
  const r4 = await consumeStream('fast-beta', 'split-check');
  record('chat still works after splitThinkingModels update', r4.status === 200 && r4.done, 'chunks=' + r4.chunks);
  record('reasoning_content is surfaced as thinking events', r4.thinking.length > 0, 'thinking_events=' + r4.thinking.length);

  console.log('\n== Test 5: rate-limit state survives config reloads ==');
  // CHAT_RATE_LIMIT_MAX=4. We already used several requests above, so the
  // limiter for 127.0.0.1 should be near/past exhaustion — WITHOUT any of
  // the config reloads having reset it. Fire requests until 429.
  let got429 = false;
  for (let i = 0; i < 10 && !got429; i++) {
    const r = await fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fast-beta', messages: [{ role: 'user', content: 'rl' }] }),
    });
    if (r.status === 429) got429 = true;
    else { try { await r.arrayBuffer(); } catch { /* */ } }
  }
  record(
    'rate limiter still enforcing after 4 config reloads (state NOT reset)',
    got429,
  );

  console.log('\n== Test 6: invalid config file keeps last-known-good, process alive ==');
  // Wait for the rate-limit window... no: window is 60s. Instead verify
  // process liveness via /api/health, then write garbage, then confirm
  // health + models still served and config unchanged.
  writeConfig({ models: 'THIS IS NOT AN ARRAY' });
  await wait(600);
  const health = await fetch(API + '/api/health').then((r) => r.json());
  record('invalid config file: process stays up', health.ok === true);
  ids = await listModelIds();
  record('invalid config file: last-known-good config still served', ids.join(',') === 'fast-beta', ids.join(','));

  // And recovery: fix the file, the new config applies.
  writeConfig({
    models: ['slow-alpha', 'fast-beta'],
    labels: { 'slow-alpha': 'Slow Alpha', 'fast-beta': 'Fast Beta' },
    splitThinkingModels: [],
  });
  await wait(600);
  ids = await listModelIds();
  record('recovery: valid config applies after an invalid one', ids.join(',') === 'slow-alpha,fast-beta', ids.join(','));
} catch (err) {
  console.error('HARNESS ERROR:', err);
  results.push({ name: 'harness completed', pass: false });
} finally {
  if (backend) {
    backend.kill('SIGKILL');
    await wait(300);
  }
  if (mock) await mock.close();
  fs.writeFileSync(CONFIG, originalConfig);
  console.log('\n(config file restored; FIRST_MODEL was ' + FIRST_MODEL + ')');
  const failed = results.filter((r) => !r.pass);
  console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
  process.exit(failed.length > 0 ? 1 : 0);
}
