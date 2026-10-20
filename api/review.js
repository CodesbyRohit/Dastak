// Vercel function: POST /api/review. Logic lives in api/_lib/review.js (shared with server.js).
module.exports = require('./_lib/review.js').handler;
