// Local development server. Mirrors the Vercel deployment:
//   - same static files (public/), same "/" rewrite and /index.html redirect
//   - same API handlers (api/_lib/*), mounted at the same paths
//   - same security headers, read from vercel.json so the two cannot drift apart
// Production runs on Vercel and does not use this file.
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const plan = require('./api/_lib/plan.js');
const review = require('./api/_lib/review.js');
const protocol = require('./api/_lib/protocol.js');
const { fail, MAX_BODY_BYTES } = require('./api/_lib/http.js');

const PUBLIC = path.join(__dirname, 'public');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));

// Converts the subset of Vercel source patterns used in vercel.json ("/", "/sw.js", "/(.*)",
// "/(a|b)/(.*)") to regular expressions.
function sourceToRegExp(source) {
  const escaped = source.replace(/[.+?^${}[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped + '$');
}
const headerRules = vercel.headers.map(r => ({ re: sourceToRegExp(r.source), headers: r.headers }));

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Later matching rules override earlier ones for the same header, as on Vercel.
  app.use((req, res, next) => {
    for (const rule of headerRules) {
      if (rule.re.test(req.path)) for (const h of rule.headers) res.setHeader(h.key, h.value);
    }
    next();
  });

  for (const r of vercel.redirects) {
    app.get(r.source, (req, res) => res.redirect(r.permanent ? 308 : 307, r.destination));
  }
  for (const r of vercel.rewrites) {
    app.get(r.source, (req, res) => res.sendFile(path.join(PUBLIC, r.destination)));
  }

  app.use('/api', express.json({ limit: MAX_BODY_BYTES }));
  app.all('/api/plan', plan.handler);
  app.all('/api/review', review.handler);
  app.all('/api/protocol/:id', (req, res) => {
    req.query = Object.assign({}, req.query, { id: req.params.id });
    return protocol.handler(req, res);
  });
  app.all('/api/*', (req, res) => fail(res, 404, 'Not found'));

  app.use(express.static(PUBLIC, { index: false, etag: true }));

  // Body-parser errors (invalid JSON, too large) become JSON responses like the Vercel handlers.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return fail(res, 413, 'Request body is larger than ' + MAX_BODY_BYTES + ' bytes.');
    if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Request body is not valid JSON.');
    return fail(res, 500, 'Internal error.');
  });
  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  createApp().listen(PORT, () => {
    console.log('Dastak running on http://localhost:' + PORT + '  (wearable app at /, showcase at /showcase.html)');
  });
}

module.exports = { createApp };
