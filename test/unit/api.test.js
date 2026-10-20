// API handlers (shared by Vercel and Express): method/content-type/size/shape validation,
// deterministic fallbacks, and every AI failure mode, using a mocked fetch.
// Also exercises the real Express app (server.js) on an ephemeral port.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const plan = require('../../api/_lib/plan.js');
const review = require('../../api/_lib/review.js');
const protocol = require('../../api/_lib/protocol.js');
const http = require('../../api/_lib/http.js');
const registry = require('../../public/generated/registry.js');
const { createApp } = require('../../server.js');

const AI_ENV = { AI_API_KEY: 'test-key', AI_API_URL: 'https://ai.example.test/v1/chat/completions', AI_TIMEOUT_MS: '150' };
const ROSTER = [
  { id: 'H-1', area: 'A', protocol: 'P', dueIn: 2, lastFlag: null },
  { id: 'H-2', area: 'B', protocol: 'P', dueIn: -1, lastFlag: null },
  { id: 'H-3', area: 'A', protocol: 'P', dueIn: 0, lastFlag: 'x' }
];
const VISITS = [
  { area: 'Sector 3', flags: [{ type: 'flag_temp' }] }, { area: 'Sector 3', flags: [] },
  { area: 'Sector 7', flags: [{ type: 'flag_feeding', referral: 'Refer to the health facility.' }] }
];

function req(opts) {
  opts = opts || {};
  return {
    method: opts.method || 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, opts.headers || {}),
    body: opts.body,
    query: opts.query || {}
  };
}
function res() {
  return {
    statusCode: 200, headers: {}, headersSent: false, raw: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.raw = s; this.headersSent = true; },
    get json() { return JSON.parse(this.raw); }
  };
}
async function call(h, opts, env) {
  const r = res();
  await h(req(opts), r, env || {});
  return r;
}

let fetchCalls = 0;
function mockFetch(impl) {
  const orig = global.fetch;
  fetchCalls = 0;
  global.fetch = async (url, init) => { fetchCalls++; return impl(url, init); };
  return () => { global.fetch = orig; };
}
const aiReply = content => async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

// ---------------- shared request guards ----------------
test('guards: method, content type, size, JSON shape', async () => {
  for (const h of [plan.rawHandler, review.rawHandler]) {
    let r = await call(h, { method: 'GET' });
    assert.equal(r.statusCode, 405);
    assert.equal(r.headers.allow, 'POST');
    r = await call(h, { headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(r.statusCode, 415);
    r = await call(h, { headers: { 'content-length': String(http.MAX_BODY_BYTES + 1) }, body: {} });
    assert.equal(r.statusCode, 413);
    r = await call(h, { body: { roster: [], visits: [], pad: 'x'.repeat(http.MAX_BODY_BYTES) } });
    assert.equal(r.statusCode, 413, 'measured size is enforced even without content-length');
    r = await call(h, { body: [1, 2] });
    assert.equal(r.statusCode, 400);
    r = await call(h, { body: 'not json' });
    assert.equal(r.statusCode, 400);
    const throwing = req();
    Object.defineProperty(throwing, 'body', { get() { throw new SyntaxError('bad'); } });
    const r2 = res();
    await h(throwing, r2, {});
    assert.equal(r2.statusCode, 400, 'lazy body parser errors (Vercel) become 400');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('safe() turns unexpected exceptions into a 500 without details', async () => {
  const r = res();
  await http.safe(() => { throw new Error('secret detail'); })(req(), r);
  assert.equal(r.statusCode, 500);
  assert.doesNotMatch(r.raw, /secret detail/);
});

// ---------------- /api/plan ----------------
test('plan: malformed rosters are rejected with a reason (previously crashed with 500)', async () => {
  const bad = [
    5, 'ab', {}, [null], [{ id: 'H-1' }],
    [{ id: 'H-1', area: 'A', dueIn: 1.5, lastFlag: null }],
    [{ id: 'H-1', area: 'A', dueIn: 999, lastFlag: null }],
    [{ id: 'H 1 <b>', area: 'A', dueIn: 0, lastFlag: null }],
    [{ id: 'H-1', area: 'A', dueIn: 0, lastFlag: null, name: 'Asha Devi' }],
    [ROSTER[0], ROSTER[0]],
    new Array(51).fill(0).map((_, i) => ({ id: 'H-' + i, area: 'A', dueIn: 0, lastFlag: null }))
  ];
  for (const roster of bad) {
    const r = await call(plan.rawHandler, { body: { roster } });
    assert.equal(r.statusCode, 400, JSON.stringify(roster).slice(0, 60));
    assert.equal(typeof r.json.error, 'string');
  }
});

test('plan: no AI configured → deterministic order with reason; no network call', async () => {
  const restore = mockFetch(() => { throw new Error('must not be called'); });
  try {
    const r = await call(plan.rawHandler, { body: { roster: ROSTER } }, {});
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json.order.map(o => o.id), ['H-2', 'H-3', 'H-1']);
    assert.deepEqual(r.json.order.map(o => o.reason), ['overdue by 1 day', 'flagged last visit', 'due in 2 days']);
    assert.equal(r.json.source, 'deterministic');
    assert.equal(r.json.fallbackReason, 'AI not configured');
    assert.equal(r.json.offline, true);
    assert.equal(fetchCalls, 0);
  } finally { restore(); }
});

test('plan: no roster in the body plans the bundled demo roster', async () => {
  const r = await call(plan.rawHandler, { body: {} }, {});
  assert.equal(r.json.order.length, registry.roster.length);
  assert.equal(r.json.order[0].id, 'H-087');
});

test('plan: AI may only reorder the same IDs; reasons stay deterministic', async () => {
  const restore = mockFetch(aiReply(JSON.stringify({ order: ['H-3', 'H-2', 'H-1'] })));
  try {
    const r = await call(plan.rawHandler, { body: { roster: ROSTER } }, AI_ENV);
    assert.equal(r.json.source, 'ai');
    assert.deepEqual(r.json.order.map(o => o.id), ['H-3', 'H-2', 'H-1']);
    assert.deepEqual(r.json.order.map(o => o.reason), ['flagged last visit', 'overdue by 1 day', 'due in 2 days']);
    assert.equal(fetchCalls, 1);
  } finally { restore(); }
});

test('plan: only whitelisted roster fields are sent to the AI provider', async () => {
  let sent;
  const restore = mockFetch(async (url, init) => { sent = JSON.parse(init.body); return aiReply(JSON.stringify({ order: ['H-1', 'H-2', 'H-3'] }))(); });
  try {
    await call(plan.rawHandler, { body: { roster: ROSTER } }, AI_ENV);
    const userMsg = JSON.parse(sent.messages[1].content);
    assert.deepEqual(Object.keys(userMsg[0]).sort(), ['area', 'dueIn', 'id', 'lastFlag', 'protocol']);
    assert.equal(sent.model, 'gpt-4o-mini');
  } finally { restore(); }
});

test('plan: every bad AI outcome falls back to the deterministic order with a reason', async () => {
  const outcomes = [
    ['provider HTTP 500', async () => new Response('err', { status: 500 }), /HTTP 500/],
    ['network failure', async () => { throw new TypeError('fetch failed'); }, /unreachable/],
    ['timeout', (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), /timed out/],
    ['non-JSON provider body', async () => new Response('<html>', { status: 200 }), /not JSON/],
    ['no content', async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }), /no content/],
    ['oversized response', async () => new Response('x'.repeat(30000), { status: 200 }), /too large/],
    ['content not JSON', aiReply('Here is your plan: H-2, H-3, H-1'), /required JSON shape/],
    ['extra keys (free text)', aiReply(JSON.stringify({ order: ['H-2', 'H-3', 'H-1'], note: 'Check H-2 for fever' })), /required JSON shape/],
    ['missing a household', aiReply(JSON.stringify({ order: ['H-2', 'H-3'] })), /exactly once/],
    ['duplicated household', aiReply(JSON.stringify({ order: ['H-2', 'H-2', 'H-1'] })), /exactly once/],
    ['invented household', aiReply(JSON.stringify({ order: ['H-2', 'H-3', 'H-99'] })), /exactly once/],
    ['objects instead of IDs', aiReply(JSON.stringify({ order: [{ id: 'H-2' }, { id: 'H-3' }, { id: 'H-1' }] })), /exactly once/]
  ];
  for (const [name, impl, reason] of outcomes) {
    const restore = mockFetch(impl);
    try {
      const r = await call(plan.rawHandler, { body: { roster: ROSTER } }, AI_ENV);
      assert.equal(r.statusCode, 200, name);
      assert.equal(r.json.source, 'deterministic', name);
      assert.match(r.json.fallbackReason, reason, name);
      assert.deepEqual(r.json.order.map(o => o.id), ['H-2', 'H-3', 'H-1'], name);
    } finally { restore(); }
  }
});

test('plan: misconfigured AI endpoints are refused before any request', async () => {
  const restore = mockFetch(() => { throw new Error('must not be called'); });
  try {
    let r = await call(plan.rawHandler, { body: { roster: ROSTER } }, Object.assign({}, AI_ENV, { AI_API_URL: 'http://plain.example/v1' }));
    assert.match(r.json.fallbackReason, /HTTPS/);
    r = await call(plan.rawHandler, { body: { roster: ROSTER } }, Object.assign({}, AI_ENV, { AI_API_URL: 'not a url' }));
    assert.match(r.json.fallbackReason, /misconfigured/);
    r = await call(plan.rawHandler, { body: { roster: [ROSTER[0]] } }, AI_ENV);
    assert.equal(r.json.fallbackReason, 'nothing to order');
    assert.equal(fetchCalls, 0);
  } finally { restore(); }
});

// ---------------- /api/review ----------------
test('review: malformed visits are rejected', async () => {
  for (const visits of [7, 'x', [7], [{ flags: 7 }], [{ flags: [{ type: 'Bad Type' }] }], [{ area: 'A', name: 'x' }], [{ flags: [{ type: 'a', note: 'x' }] }]]) {
    const r = await call(review.rawHandler, { body: { visits } });
    assert.equal(r.statusCode, 400, JSON.stringify(visits));
  }
});

test('review: deterministic counted summary without AI', async () => {
  const r = await call(review.rawHandler, { body: { visits: VISITS } }, {});
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json.data, { totalVisits: 3, totalFlags: 2, flagsByType: { flag_temp: 1, flag_feeding: 1 }, visitsByArea: { 'Sector 3': 2, 'Sector 7': 1 } });
  assert.equal(r.json.summary, '3 visits across 2 areas. 2 referral flags recorded (flag_feeding ×1, flag_temp ×1). Most visits: Sector 3 (2).');
  assert.equal(r.json.aiSummary, null);
  assert.equal(r.json.fallbackReason, 'AI not configured');
  const empty = await call(review.rawHandler, { body: {} }, {});
  assert.equal(empty.json.summary, 'No visits to summarise.');
});

test('review: AI text is accepted only if short, plain and non-clinical, and is labelled', async () => {
  let restore = mockFetch(aiReply('Sector 3 had the most visits. Flags were spread across two types.'));
  try {
    const r = await call(review.rawHandler, { body: { visits: VISITS } }, AI_ENV);
    assert.equal(r.json.source, 'deterministic+ai');
    assert.equal(r.json.aiSummary.label, 'AI-generated description · not clinical advice');
    assert.ok(r.json.summary.startsWith('3 visits'), 'deterministic summary is always present');
  } finally { restore(); }

  const rejected = [
    'Sector 3 shows signs of hypothermia in newborns.',
    'You should refer Sector 3 households to the clinic.',
    'We recommend more visits to Sector 7.',
    'Flags may be caused by poor feeding practice.',
    'H-104 had a flag.',
    'See https://example.com for details.',
    '<b>Sector 3</b> leads.',
    ('word ').repeat(61)
  ];
  for (const text of rejected) {
    restore = mockFetch(aiReply(text));
    try {
      const r = await call(review.rawHandler, { body: { visits: VISITS } }, AI_ENV);
      assert.equal(r.json.aiSummary, null, text);
      assert.match(r.json.fallbackReason, /AI description rejected/, text);
    } finally { restore(); }
  }
});

test('review: too few visits never calls AI; provider failure keeps the counted summary', async () => {
  let restore = mockFetch(() => { throw new Error('must not be called'); });
  try {
    const r = await call(review.rawHandler, { body: { visits: VISITS.slice(0, 2) } }, AI_ENV);
    assert.match(r.json.fallbackReason, /too few/);
    assert.equal(fetchCalls, 0);
  } finally { restore(); }
  restore = mockFetch(async () => new Response('down', { status: 503 }));
  try {
    const r = await call(review.rawHandler, { body: { visits: VISITS } }, AI_ENV);
    assert.equal(r.statusCode, 200);
    assert.match(r.json.fallbackReason, /HTTP 503/);
    assert.ok(r.json.summary.length > 0);
  } finally { restore(); }
});

// ---------------- /api/protocol/:id ----------------
test('protocol: serves the generated registry; legacy ID is deprecated; errors are explicit', async () => {
  const P0 = registry.protocols[0];
  let r = await call(protocol.handler, { method: 'GET', query: { id: P0.id } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json, P0);
  r = await call(protocol.handler, { method: 'GET', query: { id: P0.legacyIds[0] } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json.id, P0.id);
  assert.equal(r.headers.deprecation, 'true');
  assert.match(r.headers.link, /successor-version/);
  for (const p of registry.protocols) {
    assert.equal((await call(protocol.handler, { method: 'GET', query: { id: p.id } })).statusCode, 200);
  }
  assert.equal((await call(protocol.handler, { method: 'GET', query: { id: 'nope' } })).statusCode, 404);
  assert.equal((await call(protocol.handler, { method: 'GET', query: { id: '../etc' } })).statusCode, 400);
  r = await call(protocol.handler, { method: 'POST', query: { id: P0.id } });
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers.allow, 'GET, HEAD');
});

// ---------------- Express parity with vercel.json ----------------
test('server.js mirrors the Vercel routing, headers and API behaviour', async () => {
  const server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
    const glasses = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'glasses.html'), 'utf8');

    let r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), glasses, '/ serves the wearable app');
    const strict = vercel.headers.find(h => h.source === '/').headers.find(h => h.key === 'Content-Security-Policy').value;
    assert.equal(r.headers.get('content-security-policy'), strict);
    assert.match(strict, /connect-src 'none'/);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\), microphone=\(\)/);

    r = await fetch(base + '/glasses.html');
    assert.match(r.headers.get('content-security-policy'), /connect-src 'none'/);
    r = await fetch(base + '/plan.html');
    assert.match(r.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');

    r = await fetch(base + '/index.html', { redirect: 'manual' });
    assert.equal(r.status, 307);
    assert.equal(r.headers.get('location'), '/glasses.html');

    r = await fetch(base + '/api/protocol/home_visit');
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'Request body is not valid JSON.');
    r = await fetch(base + '/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(20000) }) });
    assert.equal(r.status, 413);
    r = await fetch(base + '/api/plan');
    assert.equal(r.status, 405);
    r = await fetch(base + '/api/unknown');
    assert.equal(r.status, 404);
    r = await fetch(base + '/server.js');
    assert.equal(r.status, 404, 'source files outside public/ are not served');
  } finally {
    server.close();
  }
});
