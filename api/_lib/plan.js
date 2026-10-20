// POST /api/plan — nonclinical day planner.
// The deterministic rule (public/js/planner.js) always produces the reasons. When AI is
// configured it may only propose an ordering of the same household IDs; anything else is
// rejected and the deterministic order is returned with the reason.
'use strict';

const Planner = require('../../public/js/planner.js');
const registry = require('../../public/generated/registry.js');
const { send, fail, readJsonBody, safe } = require('./http.js');
const { validateRoster } = require('./validate.js');
const ai = require('./ai.js');

const SYSTEM_PROMPT = [
  "You order a community health worker's home visits for one day.",
  'You receive household IDs, area names, protocol names, days until due (negative means overdue) and whether the previous visit raised a flag.',
  'Order the visits: overdue first, then previously flagged, then due today; within those, group households in the same area together.',
  'Return ONLY JSON of the form {"order": ["<id>", ...]} containing every household ID exactly once. No other keys, no text, no markdown.'
].join('\n');

function demoRoster() {
  return registry.roster.map(h => {
    const p = registry.protocols.find(x => x.id === h.protocolId);
    return { id: h.id, area: h.area, protocol: p ? p.label : '', dueIn: h.dueIn, lastFlag: h.lastFlag };
  });
}

function parseOrder(content) {
  let obj;
  try { obj = JSON.parse(content); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.order)) return null;
  if (Object.keys(obj).some(k => k !== 'order')) return null;
  return obj.order;
}

async function handler(req, res, env) {
  env = env || process.env;
  const body = readJsonBody(req, res);
  if (!body) return;

  let roster;
  if (body.roster === undefined) roster = demoRoster();
  else {
    const v = validateRoster(body.roster);
    if (!v.ok) return fail(res, 400, v.error);
    roster = v.value;
  }

  const deterministic = Planner.deterministicOrder(roster);
  const note = Planner.summaryNote(roster);
  const fallback = reason => send(res, 200, {
    order: deterministic, note, source: 'deterministic', fallbackReason: reason, offline: true
  });

  if (roster.length < 2) return fallback('nothing to order');

  const reply = await ai.chat(env, SYSTEM_PROMPT, JSON.stringify(roster), 0.2);
  if (!reply.ok) return fallback(reply.reason);

  const ids = parseOrder(reply.content);
  if (!ids) return fallback('AI response rejected: not the required JSON shape');
  if (!Planner.isPermutation(ids, roster)) return fallback('AI response rejected: did not list each household exactly once');

  return send(res, 200, { order: Planner.planFromOrder(ids, roster), note, source: 'ai', offline: false });
}

module.exports = { handler: safe((req, res) => handler(req, res)), rawHandler: handler, SYSTEM_PROMPT };
