// Request guards shared by every API handler (Vercel functions and the local Express server).
'use strict';

const MAX_BODY_BYTES = 16 * 1024;

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function fail(res, status, error, headers) {
  send(res, status, { error }, headers);
}

// Checks method, content type, size, and that the body is a JSON object.
// Returns the parsed body object, or null after sending an error response.
function readJsonBody(req, res) {
  if (req.method !== 'POST') {
    fail(res, 405, 'Method not allowed. Use POST.', { Allow: 'POST' });
    return null;
  }
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    fail(res, 415, 'Content-Type must be application/json.');
    return null;
  }
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_BODY_BYTES) {
    fail(res, 413, 'Request body is larger than ' + MAX_BODY_BYTES + ' bytes.');
    return null;
  }
  let body;
  try {
    body = req.body; // Vercel parses lazily and throws on invalid JSON
  } catch (e) {
    fail(res, 400, 'Request body is not valid JSON.');
    return null;
  }
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { fail(res, 400, 'Request body is not valid JSON.'); return null; }
  }
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    fail(res, 400, 'Request body must be a JSON object.');
    return null;
  }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
    fail(res, 413, 'Request body is larger than ' + MAX_BODY_BYTES + ' bytes.');
    return null;
  }
  return body;
}

// Wraps a handler so an unexpected exception never leaks a stack trace or crashes the function.
function safe(handler) {
  return async function (req, res) {
    try {
      await handler(req, res);
    } catch (e) {
      if (!res.headersSent) fail(res, 500, 'Internal error.');
      else res.end();
    }
  };
}

module.exports = { send, fail, readJsonBody, safe, MAX_BODY_BYTES };
