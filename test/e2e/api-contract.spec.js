// HTTP contract: routes, security headers and API behaviour. Run against the local server and,
// with BASE_URL set, against a deployment (npm run test:deployed).
'use strict';

const { test, expect } = require('@playwright/test');
const { registry } = require('./helpers.js');

const JSON_HEADERS = { 'content-type': 'application/json' };

test.describe('routes', () => {
  for (const path of ['/', '/glasses.html', '/record.html', '/plan.html', '/review.html', '/showcase.html', '/sw.js', '/generated/registry.js', '/js/engine.js']) {
    test('GET ' + path + ' → 200', async ({ request }) => {
      const r = await request.get(path);
      expect(r.status()).toBe(200);
    });
  }

  test('/ serves the multi-protocol wearable app, not the retired single-protocol engine', async ({ request }) => {
    const body = await (await request.get('/')).text();
    expect(body).toContain('/js/glasses-app.js');
    expect(body).not.toContain('var PROTOCOL =');
  });

  test('/index.html redirects to /glasses.html', async ({ request }) => {
    const r = await request.get('/index.html', { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(r.status());
    expect(r.headers().location).toMatch(/\/glasses\.html$/);
  });

  test('source and data files are not published', async ({ request }) => {
    for (const p of ['/server.js', '/package.json', '/protocols/home-visit.json', '/data/roster.json', '/.env', '/api/_lib/plan.js']) {
      expect((await request.get(p)).status(), p).toBe(404);
    }
  });
});

test.describe('security headers', () => {
  test('wearable app: CSP forbids network connections; device permissions disabled', async ({ request }) => {
    for (const p of ['/', '/glasses.html']) {
      const h = (await request.get(p)).headers();
      expect(h['content-security-policy'], p).toContain("connect-src 'none'");
      expect(h['permissions-policy'], p).toContain('camera=()');
      expect(h['permissions-policy'], p).toContain('microphone=()');
      expect(h['x-content-type-options'], p).toBe('nosniff');
      expect(h['referrer-policy'], p).toBe('no-referrer');
    }
  });

  test('phone pages: CSP allows same-origin API calls only', async ({ request }) => {
    const h = (await request.get('/plan.html')).headers();
    expect(h['content-security-policy']).toContain("connect-src 'self'");
    expect(h['content-security-policy']).toContain("script-src 'self'");
  });
});

test.describe('GET /api/protocol/:id', () => {
  test('every bundled protocol is served exactly as generated', async ({ request }) => {
    for (const p of registry.protocols) {
      const r = await request.get('/api/protocol/' + p.id);
      expect(r.status()).toBe(200);
      expect(await r.json()).toEqual(p);
    }
  });

  test('legacy ID resolves with deprecation headers', async ({ request }) => {
    const p = registry.protocols.find(x => (x.legacyIds || []).length);
    const r = await request.get('/api/protocol/' + p.legacyIds[0]);
    expect(r.status()).toBe(200);
    expect((await r.json()).id).toBe(p.id);
    expect(r.headers().deprecation).toBe('true');
  });

  test('unknown → 404, bad ID → 400, wrong method → 405', async ({ request }) => {
    expect((await request.get('/api/protocol/nope')).status()).toBe(404);
    expect((await request.get('/api/protocol/NOT-valid')).status()).toBe(400);
    const r = await request.post('/api/protocol/home_visit', { data: {} });
    expect(r.status()).toBe(405);
  });
});

test.describe('POST /api/plan', () => {
  test('wrong method, content type, malformed and oversized bodies are rejected', async ({ request }) => {
    expect((await request.get('/api/plan')).status()).toBe(405);
    expect((await request.post('/api/plan', { headers: { 'content-type': 'text/plain' }, data: '{}' })).status()).toBe(415);
    expect((await request.post('/api/plan', { headers: JSON_HEADERS, data: '{not json' })).status()).toBe(400);
    for (const roster of [5, 'ab', [{ id: 'H-1', area: 'A', dueIn: 0, lastFlag: null, name: 'x' }]]) {
      const r = await request.post('/api/plan', { headers: JSON_HEADERS, data: JSON.stringify({ roster }) });
      expect(r.status(), JSON.stringify(roster)).toBe(400);
    }
    const big = await request.post('/api/plan', { headers: JSON_HEADERS, data: JSON.stringify({ pad: 'x'.repeat(20000) }) });
    expect([413]).toContain(big.status());
  });

  test('returns every household exactly once with rule-based reasons (AI or not)', async ({ request }) => {
    const r = await request.post('/api/plan', { headers: JSON_HEADERS, data: '{}' });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.order.map(o => o.id).sort()).toEqual(registry.roster.map(h => h.id).sort());
    expect(['ai', 'deterministic']).toContain(body.source);
    for (const o of body.order) expect(o.reason).toMatch(/^(overdue by \d+ days?|flagged last visit|due today|due in \d+ days?)$/);
  });
});

test.describe('POST /api/review', () => {
  test('malformed visits → 400', async ({ request }) => {
    for (const visits of [7, [{ flags: 7 }], [{ area: 'A', name: 'x' }]]) {
      const r = await request.post('/api/review', { headers: JSON_HEADERS, data: JSON.stringify({ visits }) });
      expect(r.status(), JSON.stringify(visits)).toBe(400);
    }
  });

  test('always returns a counted summary; any AI text is labelled', async ({ request }) => {
    const visits = [{ area: 'A', flags: [{ type: 'flag_temp' }] }, { area: 'A', flags: [] }, { area: 'B', flags: [] }];
    const r = await request.post('/api/review', { headers: JSON_HEADERS, data: JSON.stringify({ visits }) });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.summary).toBe('3 visits across 2 areas. 1 referral flag recorded (flag_temp ×1). Most visits: A (2).');
    if (body.aiSummary) expect(body.aiSummary.label).toBe('AI-generated description · not clinical advice');
  });
});
