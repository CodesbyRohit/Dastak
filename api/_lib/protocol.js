// GET /api/protocol/:id — serves a bundled protocol from the generated registry.
// Legacy IDs (for example the former HBNC ID) resolve to their current protocol and are
// marked deprecated. The wearable app never calls this endpoint; it uses the bundled registry.
'use strict';

const registry = require('../../public/generated/registry.js');
const Engine = require('../../public/js/engine.js');
const { send, fail, safe } = require('./http.js');

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed. Use GET.', { Allow: 'GET, HEAD' });
  const id = req.query && req.query.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(id)) return fail(res, 400, 'Protocol ID must be lowercase letters, digits and underscores.');
  const p = Engine.findProtocol(registry, id);
  if (!p) return fail(res, 404, 'Protocol not found');
  const headers = {};
  if (p.id !== id) {
    headers.Deprecation = 'true';
    headers.Link = '</api/protocol/' + p.id + '>; rel="successor-version"';
  }
  return send(res, 200, p, headers);
}

module.exports = { handler: safe(handler) };
