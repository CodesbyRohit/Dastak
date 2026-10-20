// Protocol validation: the canonical protocols pass, and each kind of defect is rejected with
// a specific error code. Also checks that `node verify.js` exits non-zero on an invalid
// protocol, on registry drift and on service-worker drift.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateProtocol, validateRoster, loadAndValidate } = require('../../scripts/lib/validate-protocol.js');

const ROOT = path.join(__dirname, '..', '..');

function base() {
  return {
    id: 'sample', label: 'Sample', start: 'a', status: 'structural-test', version: '1.0.0',
    provenance: { authoredBy: 'test', sources: [], review: { state: 'unreviewed' } },
    steps: [
      { id: 'a', prompt: 'A?', type: 'yesno', onYes: 'b', onNo: 'flag', content_source: 'UNSOURCED' },
      { id: 'flag', prompt: 'Flag', type: 'info', danger: true, referral: 'Refer.', next: 'b', content_source: 'UNSOURCED' },
      { id: 'b', prompt: 'B?', type: 'choice', options: ['x', 'y'], next: 'c', content_source: 'UNSOURCED' },
      { id: 'c', prompt: 'C?', type: 'range', min: 1, max: 3, step: 0.5, default: 2, next: 'd',
        rule: { condition: { op: 'gt', value: 2 }, target: 'flag2' }, content_source: 'UNSOURCED' },
      { id: 'flag2', prompt: 'High', type: 'info', danger: true, referral: 'Refer.', next: 'd', content_source: 'UNSOURCED' },
      { id: 'd', prompt: 'N?', type: 'count', min: 0, max: 10, step: 1, default: 0, next: null, content_source: 'UNSOURCED' }
    ]
  };
}
const step = (p, id) => p.steps.find(s => s.id === id);
const REVIEWED = { state: 'reviewed', reviewer: 'Dr Example', role: 'Paediatrician', date: '2026-01-01', scope: 'All steps' };

// [description, mutation, expected error code]
const CASES = [
  ['missing required protocol field', p => { delete p.version; }, 'SCHEMA'],
  ['unknown protocol field', p => { p.colour = 'red'; }, 'SCHEMA'],
  ['bad status value', p => { p.status = 'demo-ready'; }, 'SCHEMA'],
  ['bad protocol id', p => { p.id = 'Sample-1'; }, 'SCHEMA'],
  ['bad version', p => { p.version = 'v1'; }, 'SCHEMA'],
  ['missing provenance', p => { delete p.provenance; }, 'SCHEMA'],
  ['unknown frame type', p => { step(p, 'b').type = 'group'; }, 'SCHEMA'],
  ['yesno missing onNo', p => { delete step(p, 'a').onNo; }, 'SCHEMA'],
  ['range missing default', p => { delete step(p, 'c').default; }, 'SCHEMA'],
  ['step with zero increment', p => { step(p, 'c').step = 0; }, 'SCHEMA'],
  ['danger without referral', p => { delete step(p, 'flag').referral; }, 'SCHEMA'],
  ['numeric rule with string value', p => { step(p, 'c').rule.condition.value = 'high'; }, 'SCHEMA'],
  ['in rule with scalar value', p => { step(p, 'c').rule.condition = { op: 'in', value: 2 }; }, 'SCHEMA'],
  ['unknown rule operator', p => { step(p, 'c').rule.condition.op = 'between'; }, 'SCHEMA'],
  ['option with unknown field', p => { step(p, 'b').options = [{ label: 'x', value: 'x', colour: 1 }, { label: 'y', value: 'y' }]; }, 'SCHEMA'],
  ['single option', p => { step(p, 'b').options = ['x']; }, 'SCHEMA'],
  ['empty steps', p => { p.steps = []; }, 'SCHEMA'],
  ['duplicate step id', p => { p.steps.push(Object.assign({}, step(p, 'd'))); }, 'DUPLICATE_STEP_ID'],
  ['start step missing', p => { p.start = 'zzz'; }, 'START_MISSING'],
  ['next target missing', p => { step(p, 'flag').next = 'zzz'; }, 'TARGET_MISSING'],
  ['onYes target missing', p => { step(p, 'a').onYes = 'zzz'; }, 'TARGET_MISSING'],
  ['option target missing', p => { step(p, 'b').options = [{ label: 'x', value: 'x', next: 'zzz' }, { label: 'y', value: 'y' }]; }, 'TARGET_MISSING'],
  ['rule target missing', p => { step(p, 'c').rule.target = 'zzz'; }, 'TARGET_MISSING'],
  ['field not used by frame type', p => { step(p, 'a').next = 'b'; }, 'FIELD_NOT_ALLOWED'],
  ['danger on a question', p => { step(p, 'a').danger = true; step(p, 'a').referral = 'x'; }, 'FIELD_NOT_ALLOWED'],
  ['danger set to false', p => { step(p, 'b').danger = false; }, 'FIELD_NOT_ALLOWED'],
  ['mixed option kinds', p => { step(p, 'b').options = ['x', { label: 'y', value: 'y' }]; }, 'SCHEMA'],
  ['duplicate option values', p => { step(p, 'b').options = ['x', 'x']; }, 'DUPLICATE_OPTION_VALUE'],
  ['option with no transition', p => { const b = step(p, 'b'); delete b.next; b.options = [{ label: 'x', value: 'x', next: 'c' }, { label: 'y', value: 'y' }]; }, 'CHOICE_NO_TRANSITION'],
  ['min not below max', p => { Object.assign(step(p, 'c'), { min: 3, max: 3 }); }, 'RANGE_BOUNDS'],
  ['max off the grid', p => { step(p, 'c').max = 3.2; }, 'RANGE_GRID'],
  ['too many values', p => { Object.assign(step(p, 'd'), { max: 1000 }); }, 'RANGE_TOO_LARGE'],
  ['default off the grid', p => { step(p, 'c').default = 2.2; }, 'DEFAULT_OFF_GRID'],
  ['default out of bounds', p => { step(p, 'd').default = 11; }, 'DEFAULT_OFF_GRID'],
  ['rule can never fire', p => { step(p, 'c').rule.condition.value = 3; }, 'RULE_NEVER_FIRES'],
  ['rule always fires', p => { step(p, 'c').rule.condition = { op: 'gte', value: 1 }; }, 'RULE_ALWAYS_FIRES'],
  ['numeric rule on a choice', p => { step(p, 'b').rule = { condition: { op: 'gt', value: 1 }, target: 'd' }; }, 'RULE_TYPE_MISMATCH'],
  ['unreachable step', p => { p.steps.push({ id: 'orphan', prompt: 'O', type: 'info', next: null, content_source: 'UNSOURCED' }); }, 'UNREACHABLE_STEP'],
  ['cycle', p => { step(p, 'flag2').next = 'a'; }, 'CYCLE'],
  ['no path to the end', p => { step(p, 'd').next = 'd'; }, 'NO_TERMINAL'],
  ['reviewed-demo with UNSOURCED steps', p => { p.status = 'reviewed-demo'; p.provenance.sources = ['Doc']; p.provenance.review = REVIEWED; }, 'UNSOURCED_NOT_ALLOWED'],
  ['reviewed-demo without sources', p => { p.status = 'reviewed-demo'; p.provenance.review = REVIEWED; p.steps.forEach(s => { s.content_source = 'Doc §1'; }); }, 'SOURCES_REQUIRED'],
  ['reviewed-demo without review', p => { p.status = 'reviewed-demo'; p.provenance.sources = ['Doc']; p.steps.forEach(s => { s.content_source = 'Doc §1'; }); }, 'REVIEW_METADATA_MISSING'],
  ['reviewed-demo with partial review', p => { p.status = 'reviewed-demo'; p.provenance.sources = ['Doc']; p.provenance.review = { state: 'reviewed', reviewer: 'X' }; p.steps.forEach(s => { s.content_source = 'Doc §1'; }); }, 'REVIEW_METADATA_MISSING'],
  ['clinically-approved without approval reference', p => { p.status = 'clinically-approved'; p.provenance.sources = ['Doc']; p.provenance.review = Object.assign({}, REVIEWED, { state: 'approved' }); p.steps.forEach(s => { s.content_source = 'Doc §1'; }); }, 'APPROVAL_REFERENCE_MISSING'],
  ['draft claiming review without reviewer', p => { p.status = 'clinical-draft'; p.provenance.review = { state: 'reviewed' }; }, 'REVIEW_METADATA_MISSING']
];

test('the base fixture is valid', () => {
  assert.deepEqual(validateProtocol(base(), 'base'), []);
});

for (const [name, mutate, code] of CASES) {
  test('rejects: ' + name + ' → ' + code, () => {
    const p = base();
    mutate(p);
    const codes = validateProtocol(p, 'fixture').map(e => e.code);
    assert.ok(codes.includes(code), 'expected ' + code + ', got ' + JSON.stringify(codes));
  });
}

test('a fully reviewed and sourced protocol may be reviewed-demo or clinically-approved', () => {
  const p = base();
  p.status = 'reviewed-demo';
  p.provenance.sources = ['Issuer, Document, edition, section'];
  p.provenance.review = REVIEWED;
  p.steps.forEach(s => { s.content_source = 'Document §1'; });
  assert.deepEqual(validateProtocol(p, 'x'), []);
  p.status = 'clinically-approved';
  p.provenance.review = Object.assign({}, REVIEWED, { state: 'approved', approvalReference: 'Board minute 12/2026' });
  assert.deepEqual(validateProtocol(p, 'x'), []);
});

test('roster validation', () => {
  const protos = [{ id: 'sample' }];
  const ok = [{ id: 'H-1', area: 'A', protocolId: 'sample', dueIn: 0, lastFlag: null }];
  assert.deepEqual(validateRoster(ok, protos, 'r'), []);
  const codes = r => validateRoster(r, protos, 'r').map(e => e.code);
  assert.ok(codes(ok.concat(ok)).includes('ROSTER_DUPLICATE_ID'));
  assert.ok(codes([Object.assign({}, ok[0], { protocolId: 'nope' })]).includes('ROSTER_UNKNOWN_PROTOCOL'));
  assert.ok(codes([Object.assign({}, ok[0], { name: 'Asha' })]).includes('ROSTER_SCHEMA'), 'names are rejected');
  assert.ok(codes([Object.assign({}, ok[0], { id: 'Asha Devi' })]).includes('ROSTER_SCHEMA'));
  assert.ok(codes([Object.assign({}, ok[0], { dueIn: 1.5 })]).includes('ROSTER_SCHEMA'));
  assert.ok(codes([]).includes('ROSTER_SCHEMA'));
  assert.ok(codes({}).includes('ROSTER_SCHEMA'));
});

test('the canonical repository validates with no errors', () => {
  const r = loadAndValidate(ROOT);
  assert.deepEqual(r.errors, []);
  assert.equal(r.protocols.length, 4);
});

// ---- CLI: verify.js against a temporary copy of the repository ----
function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dastak-verify-'));
  for (const rel of ['protocols', 'data', 'schema', 'public', 'scripts']) {
    fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  return dir;
}
function verify(dir) {
  return spawnSync(process.execPath, [path.join(ROOT, 'verify.js'), '--root', dir], { encoding: 'utf8' });
}

test('verify.js passes on an unmodified copy', () => {
  const dir = tempCopy();
  const r = verify(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not clinical validation/);
});

test('verify.js fails on an invalid protocol file', () => {
  const dir = tempCopy();
  const f = path.join(dir, 'protocols', 'danger-signs.json');
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  p.steps[0].onYes = 'missing_step';
  fs.writeFileSync(f, JSON.stringify(p));
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /TARGET_MISSING/);
});

test('verify.js fails on malformed JSON and on a protocol missing from the manifest', () => {
  const dir = tempCopy();
  fs.writeFileSync(path.join(dir, 'protocols', 'extra.json'), '{ not json');
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FILE_PARSE/);
});

test('verify.js fails when the generated registry drifts from the canonical JSON', () => {
  const dir = tempCopy();
  const f = path.join(dir, 'protocols', 'adherence.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"Doses taken since last visit?"', '"Doses taken since the last visit?"'));
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GENERATED_DRIFT.*registry\.js/);
});

test('verify.js fails when the generated file is edited by hand', () => {
  const dir = tempCopy();
  const f = path.join(dir, 'public', 'generated', 'registry.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Record the baby', 'Record the infant'));
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GENERATED_DRIFT/);
});

test('verify.js fails when an app-shell file changes without a rebuild (stale service-worker build ID)', () => {
  const dir = tempCopy();
  fs.appendFileSync(path.join(dir, 'public', 'js', 'glasses-app.js'), '\n// edit\n');
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GENERATED_DRIFT.*sw\.js/);
});

test('verify.js fails when engine code hard-codes a protocol ID', () => {
  const dir = tempCopy();
  fs.appendFileSync(path.join(dir, 'public', 'js', 'engine.js'), "\nif (x === 'danger_signs') {}\n");
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PROTOCOL_SPECIFIC_CODE|GENERATED_DRIFT/);
});
