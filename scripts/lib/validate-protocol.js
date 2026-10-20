// Protocol, manifest and roster validation.
// Layer 1: JSON Schema (schema/protocol.schema.json) via Ajv.
// Layer 2: semantic checks JSON Schema cannot express. Each failure carries a stable code
// so tests can assert exactly which rule rejected a fixture.
// Passing validation proves structural integrity only. It says nothing about clinical correctness.
'use strict';

const path = require('path');
const fs = require('fs');
const Ajv = require('ajv');
const Engine = require('../../public/js/engine.js');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema', 'protocol.schema.json');
const MAX_GRID_VALUES = 201;

const FIELDS_BY_TYPE = {
  yesno: ['onYes', 'onNo'],
  choice: ['options', 'next', 'rule'],
  count: ['min', 'max', 'step', 'default', 'unit', 'next', 'rule'],
  range: ['min', 'max', 'step', 'default', 'unit', 'next', 'rule'],
  info: ['next', 'danger', 'referral']
};
const COMMON_FIELDS = ['id', 'prompt', 'type', 'content_source'];

let compiledSchema = null;
function schemaValidator() {
  if (!compiledSchema) {
    // strictRequired is off because conditional `then: { required: [...] }` blocks reference
    // properties declared on the parent schema, which is valid JSON Schema.
    const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
    compiledSchema = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')));
  }
  return compiledSchema;
}

function err(code, where, message) {
  return { code, where, message };
}

// Validates one protocol object. `where` labels errors (usually the file name).
function validateProtocol(protocol, where) {
  const errors = [];
  const validate = schemaValidator();
  if (!validate(protocol)) {
    for (const e of validate.errors) {
      errors.push(err('SCHEMA', where, (e.instancePath || '/') + ' ' + e.message +
        (e.params && e.params.additionalProperty ? ' (' + e.params.additionalProperty + ')' : '')));
    }
    // Semantic checks assume a structurally sound document.
    return errors;
  }

  const steps = protocol.steps;
  const map = {};
  for (const s of steps) {
    if (map[s.id]) errors.push(err('DUPLICATE_STEP_ID', where, 'Step id "' + s.id + '" is used more than once'));
    map[s.id] = s;
  }
  if (!map[protocol.start]) errors.push(err('START_MISSING', where, 'Start step "' + protocol.start + '" does not exist'));

  for (const s of steps) {
    const at = where + ' › ' + s.id;
    const allowed = COMMON_FIELDS.concat(FIELDS_BY_TYPE[s.type]);
    for (const k of Object.keys(s)) {
      if (allowed.indexOf(k) === -1) errors.push(err('FIELD_NOT_ALLOWED', at, '"' + k + '" is not used by ' + s.type + ' frames'));
    }
    if (s.danger === false) errors.push(err('FIELD_NOT_ALLOWED', at, 'Omit "danger" instead of setting it to false'));

    if (s.type === 'choice') {
      // Mixed string/object options are rejected by the schema (anyOf) before this point.
      const values = Engine.normalizeOptions(s).map(o => o.value);
      if (new Set(values).size !== values.length) errors.push(err('DUPLICATE_OPTION_VALUE', at, 'Option values must be unique'));
      Engine.normalizeOptions(s).forEach((o, i) => {
        if (o.next === undefined && s.next === undefined) {
          errors.push(err('CHOICE_NO_TRANSITION', at, 'Option ' + i + ' ("' + o.label + '") has no next and the step has no next'));
        }
      });
    }

    if (s.type === 'count' || s.type === 'range') {
      if (!(s.min < s.max)) {
        errors.push(err('RANGE_BOUNDS', at, 'min (' + s.min + ') must be less than max (' + s.max + ')'));
      } else {
        const n = (s.max - s.min) / s.step;
        if (Math.abs(n - Math.round(n)) > 1e-6) {
          errors.push(err('RANGE_GRID', at, 'max is not reachable from min in increments of ' + s.step));
        } else if (Math.round(n) + 1 > MAX_GRID_VALUES) {
          errors.push(err('RANGE_TOO_LARGE', at, (Math.round(n) + 1) + ' values; at most ' + MAX_GRID_VALUES + ' are allowed'));
        }
        if (!Engine.isOnGrid(s, s.default)) {
          errors.push(err('DEFAULT_OFF_GRID', at, 'default ' + s.default + ' is outside [' + s.min + ', ' + s.max + '] or not on the ' + s.step + ' grid'));
        }
      }
    }

    if (s.rule) {
      const op = s.rule.condition.op;
      const numeric = ['gt', 'gte', 'lt', 'lte'].indexOf(op) !== -1;
      if (numeric && s.type === 'choice') {
        errors.push(err('RULE_TYPE_MISMATCH', at, 'Numeric comparison "' + op + '" on a choice step'));
      } else if (errors.every(e => e.where !== at || ['RANGE_BOUNDS', 'RANGE_GRID', 'RANGE_TOO_LARGE'].indexOf(e.code) === -1)) {
        const domain = Engine.answerDomain(s);
        const fires = domain.filter(v => Engine.evaluateRule(s.rule, v)).length;
        if (fires === 0) errors.push(err('RULE_NEVER_FIRES', at, 'Rule ' + op + ' ' + JSON.stringify(s.rule.condition.value) + ' matches no selectable answer'));
        else if (fires === domain.length) errors.push(err('RULE_ALWAYS_FIRES', at, 'Rule ' + op + ' ' + JSON.stringify(s.rule.condition.value) + ' matches every selectable answer'));
      }
    }

    for (const t of Engine.transitions(s)) {
      if (t.target !== null && t.target !== undefined && !map[t.target]) {
        errors.push(err('TARGET_MISSING', at, 'Transition via ' + t.via + ' points to missing step "' + t.target + '"'));
      }
    }
  }

  // Graph checks: reachability, cycles, termination.
  if (map[protocol.start]) {
    const reachable = new Set();
    const queue = [protocol.start];
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id) || !map[id]) continue;
      reachable.add(id);
      for (const t of Engine.transitions(map[id])) if (t.target && map[t.target]) queue.push(t.target);
    }
    for (const s of steps) {
      if (!reachable.has(s.id)) errors.push(err('UNREACHABLE_STEP', where + ' › ' + s.id, 'Not reachable from start step "' + protocol.start + '"'));
    }

    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = {};
    const canEnd = {};
    const reported = new Set();
    function dfs(id, trail) {
      colour[id] = GREY;
      let ends = false;
      for (const t of Engine.transitions(map[id])) {
        if (t.target === null) { ends = true; continue; }
        if (!map[t.target]) continue;
        const c = colour[t.target] || WHITE;
        if (c === GREY) {
          const loop = trail.slice(trail.indexOf(t.target)).concat(t.target).join(' → ');
          if (!reported.has(loop)) { reported.add(loop); errors.push(err('CYCLE', where, 'Cycle: ' + loop)); }
        } else if (c === WHITE) {
          dfs(t.target, trail.concat(t.target));
        }
        if (canEnd[t.target]) ends = true;
      }
      colour[id] = BLACK;
      canEnd[id] = ends;
    }
    dfs(protocol.start, [protocol.start]);
    for (const id of reachable) {
      if (!canEnd[id]) errors.push(err('NO_TERMINAL', where + ' › ' + id, 'No path from this step reaches the end of the visit'));
    }
  }

  // Content lifecycle and provenance.
  const unsourced = steps.filter(s => s.content_source.trim().toUpperCase() === 'UNSOURCED').map(s => s.id);
  const review = protocol.provenance.review;
  const needsReview = protocol.status === 'reviewed-demo' || protocol.status === 'clinically-approved';
  if (needsReview) {
    if (unsourced.length) errors.push(err('UNSOURCED_NOT_ALLOWED', where, protocol.status + ' protocol has UNSOURCED steps: ' + unsourced.join(', ')));
    if (!protocol.provenance.sources.length) errors.push(err('SOURCES_REQUIRED', where, protocol.status + ' requires at least one cited source'));
    const missing = ['reviewer', 'role', 'date', 'scope'].filter(k => !review[k]);
    if (review.state === 'unreviewed' || missing.length) {
      errors.push(err('REVIEW_METADATA_MISSING', where, protocol.status + ' requires a completed review (state, reviewer, role, date, scope)' +
        (missing.length ? '; missing: ' + missing.join(', ') : '')));
    }
  }
  if (protocol.status === 'clinically-approved' && (review.state !== 'approved' || !review.approvalReference)) {
    errors.push(err('APPROVAL_REFERENCE_MISSING', where, 'clinically-approved requires review.state "approved" and an approvalReference'));
  }
  if (!needsReview && review.state !== 'unreviewed' && (!review.reviewer || !review.date)) {
    errors.push(err('REVIEW_METADATA_MISSING', where, 'review.state "' + review.state + '" must name a reviewer and date'));
  }

  return errors;
}

function validateRoster(roster, protocols, where) {
  const errors = [];
  if (!Array.isArray(roster)) return [err('ROSTER_SCHEMA', where, 'Roster must be an array')];
  const ids = new Set();
  roster.forEach((h, i) => {
    const at = where + ' › [' + i + ']';
    if (!h || typeof h !== 'object') { errors.push(err('ROSTER_SCHEMA', at, 'Entry must be an object')); return; }
    const keys = Object.keys(h).sort().join(',');
    if (keys !== 'area,dueIn,id,lastFlag,protocolId') errors.push(err('ROSTER_SCHEMA', at, 'Entry must have exactly id, area, protocolId, dueIn, lastFlag'));
    if (typeof h.id !== 'string' || !/^H-\d{1,6}$/.test(h.id)) errors.push(err('ROSTER_SCHEMA', at, 'id must look like H-123 (opaque household ID, never a name)'));
    if (typeof h.area !== 'string' || !h.area || h.area.length > 40) errors.push(err('ROSTER_SCHEMA', at, 'area must be a short string'));
    if (!Number.isInteger(h.dueIn)) errors.push(err('ROSTER_SCHEMA', at, 'dueIn must be an integer number of days'));
    if (!(h.lastFlag === null || (typeof h.lastFlag === 'string' && h.lastFlag.length <= 64))) errors.push(err('ROSTER_SCHEMA', at, 'lastFlag must be null or a short string'));
    if (ids.has(h.id)) errors.push(err('ROSTER_DUPLICATE_ID', at, 'Household "' + h.id + '" appears twice'));
    ids.add(h.id);
    if (!protocols.some(p => p.id === h.protocolId)) errors.push(err('ROSTER_UNKNOWN_PROTOCOL', at, 'protocolId "' + h.protocolId + '" is not a bundled protocol'));
  });
  if (!roster.length) errors.push(err('ROSTER_SCHEMA', where, 'Roster is empty'));
  return errors;
}

// Loads and validates everything under rootDir. Returns { errors, protocols (manifest order), roster, manifest }.
function loadAndValidate(rootDir) {
  const errors = [];
  const protoDir = path.join(rootDir, 'protocols');
  const readJson = (file, label) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { errors.push(err('FILE_PARSE', label, e.code === 'ENOENT' ? 'File not found' : e.message)); return undefined; }
  };

  const manifest = readJson(path.join(protoDir, 'manifest.json'), 'protocols/manifest.json');
  let files = [];
  try { files = fs.readdirSync(protoDir).filter(f => f.endsWith('.json') && f !== 'manifest.json').sort(); }
  catch (e) { errors.push(err('FILE_PARSE', 'protocols/', e.message)); }
  if (!files.length) errors.push(err('NO_PROTOCOLS', 'protocols/', 'No protocol files found'));

  const byId = {};
  const seenIds = {};
  for (const f of files) {
    const label = 'protocols/' + f;
    const p = readJson(path.join(protoDir, f), label);
    if (p === undefined) continue;
    errors.push(...validateProtocol(p, label));
    if (!p || typeof p.id !== 'string') continue;
    const expected = p.id.replace(/_/g, '-') + '.json';
    if (f !== expected) errors.push(err('FILENAME_MISMATCH', label, 'Protocol "' + p.id + '" must live in protocols/' + expected));
    for (const id of [p.id].concat(Array.isArray(p.legacyIds) ? p.legacyIds : [])) {
      if (seenIds[id]) errors.push(err('DUPLICATE_PROTOCOL_ID', label, 'ID "' + id + '" is also used by ' + seenIds[id]));
      else seenIds[id] = label;
    }
    byId[p.id] = p;
  }

  let ordered = [];
  if (manifest && Array.isArray(manifest.order)) {
    const order = manifest.order;
    if (new Set(order).size !== order.length) errors.push(err('MANIFEST_MISMATCH', 'protocols/manifest.json', 'order lists a protocol twice'));
    for (const id of order) {
      if (!byId[id]) errors.push(err('MANIFEST_MISMATCH', 'protocols/manifest.json', 'order lists "' + id + '" but no protocol file defines it'));
    }
    for (const id of Object.keys(byId)) {
      if (order.indexOf(id) === -1) errors.push(err('MANIFEST_MISMATCH', 'protocols/manifest.json', 'Protocol "' + id + '" is not listed in order'));
    }
    ordered = order.filter(id => byId[id]).map(id => byId[id]);
  } else if (manifest !== undefined) {
    errors.push(err('MANIFEST_MISMATCH', 'protocols/manifest.json', 'manifest must contain an "order" array'));
  }

  const roster = readJson(path.join(rootDir, 'data', 'roster.json'), 'data/roster.json');
  if (roster !== undefined) errors.push(...validateRoster(roster, ordered, 'data/roster.json'));

  return { errors, protocols: ordered, roster, manifest };
}

module.exports = { validateProtocol, validateRoster, loadAndValidate };
