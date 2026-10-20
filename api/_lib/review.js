// POST /api/review — nonclinical supervisor pattern summary.
// Always returns a deterministic counted summary. When AI is configured, a short description of
// the aggregate counts is added only if it passes every output check; it is labelled as AI text.
'use strict';

const { send, fail, readJsonBody, safe } = require('./http.js');
const { validateVisits } = require('./validate.js');
const ai = require('./ai.js');

const AI_LABEL = 'AI-generated description · not clinical advice';
const MAX_WORDS = 60;
const MAX_CHARS = 420;

const SYSTEM_PROMPT = [
  'You describe patterns in aggregate counts from community health visits: total visits, total flags, flags by type, visits by area.',
  'In two or three short plain sentences, say which areas or flag types have the most counts, or say the data is too sparse to show a pattern.',
  'Do not diagnose, name conditions, recommend or suggest any action, speculate about causes, or mention individuals.',
  'Plain text only, under 60 words.'
].join('\n');

// Output filter: rejects text that drifts into clinical judgement, advice, identification,
// markup or links. It is a coarse safety net, not a guarantee; see docs/ARCHITECTURE.md.
const DENYLIST = [
  /diagnos/i, /prescri/i, /medic(ine|ation)/i, /\btreat/i, /\bdos(e|age)/i, /\bdisease/i, /infect/i,
  /sepsis/i, /pneumonia/i, /hypotherm/i, /jaundice/i, /malaria/i, /tubercul/i, /\bsymptom/i,
  /\bshould\b/i, /\bmust\b/i, /recommend/i, /\badvis/i, /\bsuggest/i, /\brefer(ral)?\b/i, /urgent/i, /emergenc/i,
  /\bpatient/i, /\bH-\d+/i, /https?:/i, /[<>`]/, /\bcaused?\b/i, /\bbecause\b/i
];

function aggregate(visits) {
  const flagsByType = {};
  const visitsByArea = {};
  let totalFlags = 0;
  for (const v of visits) {
    if (v.area) visitsByArea[v.area] = (visitsByArea[v.area] || 0) + 1;
    for (const t of v.flagTypes) { flagsByType[t] = (flagsByType[t] || 0) + 1; totalFlags++; }
  }
  return { totalVisits: visits.length, totalFlags, flagsByType, visitsByArea };
}

function deterministicSummary(d) {
  if (!d.totalVisits) return 'No visits to summarise.';
  const areas = Object.keys(d.visitsByArea).sort((a, b) => d.visitsByArea[b] - d.visitsByArea[a] || (a < b ? -1 : 1));
  const types = Object.keys(d.flagsByType).sort((a, b) => d.flagsByType[b] - d.flagsByType[a] || (a < b ? -1 : 1));
  let s = d.totalVisits + ' visit' + (d.totalVisits === 1 ? '' : 's') + ' across ' + areas.length + ' area' + (areas.length === 1 ? '' : 's') + '. ';
  s += d.totalFlags + ' referral flag' + (d.totalFlags === 1 ? '' : 's') + ' recorded';
  s += types.length ? ' (' + types.map(t => t + ' ×' + d.flagsByType[t]).join(', ') + ').' : '.';
  if (areas.length) s += ' Most visits: ' + areas[0] + ' (' + d.visitsByArea[areas[0]] + ').';
  return s;
}

function checkAiText(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length > MAX_CHARS) return { ok: false, reason: 'too long' };
  if (clean.split(' ').length > MAX_WORDS) return { ok: false, reason: 'too many words' };
  for (const re of DENYLIST) if (re.test(clean)) return { ok: false, reason: 'contained disallowed wording' };
  return { ok: true, text: clean };
}

async function handler(req, res, env) {
  env = env || process.env;
  const body = readJsonBody(req, res);
  if (!body) return;
  const v = validateVisits(body.visits === undefined ? [] : body.visits);
  if (!v.ok) return fail(res, 400, v.error);

  const data = aggregate(v.value);
  const result = { summary: deterministicSummary(data), data, aiSummary: null, source: 'deterministic', offline: true };

  if (data.totalVisits < 3) {
    result.fallbackReason = 'too few visits for a pattern description';
    return send(res, 200, result);
  }
  const reply = await ai.chat(env, SYSTEM_PROMPT, JSON.stringify(data), 0.3);
  if (!reply.ok) { result.fallbackReason = reply.reason; return send(res, 200, result); }
  const checked = checkAiText(reply.content);
  if (!checked.ok) { result.fallbackReason = 'AI description rejected: ' + checked.reason; return send(res, 200, result); }

  result.aiSummary = { text: checked.text, label: AI_LABEL };
  result.source = 'deterministic+ai';
  result.offline = false;
  return send(res, 200, result);
}

module.exports = { handler: safe((req, res) => handler(req, res)), rawHandler: handler, aggregate, deterministicSummary, checkAiText, DENYLIST };
