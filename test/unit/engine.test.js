// Engine behaviour: every frame type, transitions, rule operators at their boundaries,
// numeric grids, flags, progress, back navigation, resume replay, and exhaustive path
// enumeration over every bundled protocol.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../public/js/engine.js');
const registry = require('../../public/generated/registry.js');

const T0 = 1_800_000_000_000;

// A small synthetic protocol covering every frame type and transition kind.
const P = {
  id: 'synthetic', label: 'Synthetic', start: 'q_yes', status: 'structural-test', version: '1.0.0',
  provenance: { authoredBy: 'test', sources: [], review: { state: 'unreviewed' } },
  steps: [
    { id: 'q_yes', prompt: 'Y?', type: 'yesno', onYes: 'q_choice', onNo: 'flag', content_source: 'UNSOURCED' },
    { id: 'flag', prompt: 'Flag shown', type: 'info', danger: true, referral: 'Refer.', next: 'q_choice', content_source: 'UNSOURCED' },
    { id: 'q_choice', prompt: 'C?', type: 'choice', options: [
      { label: 'A', value: 'a', next: 'q_count' },
      { label: 'B', value: 'b', next: 'q_range' },
      { label: 'End', value: 'end', next: null },
      { label: 'Fallthrough', value: 'ft' }
    ], next: 'note', content_source: 'UNSOURCED' },
    { id: 'q_count', prompt: 'N?', type: 'count', min: 1, max: 2, step: 0.1, default: 1.5, unit: 'kg', next: 'note', content_source: 'UNSOURCED' },
    { id: 'q_range', prompt: 'R?', type: 'range', min: 35, max: 42, step: 0.5, default: 36.5, unit: '°C', next: 'note',
      rule: { condition: { op: 'gt', value: 38.5 }, target: 'flag2' }, content_source: 'UNSOURCED' },
    { id: 'flag2', prompt: 'High', type: 'info', danger: true, referral: 'Refer now.', next: null, content_source: 'UNSOURCED' },
    { id: 'note', prompt: 'Done', type: 'info', next: null, content_source: 'UNSOURCED' }
  ]
};

function run(protocol, answers) {
  let v = E.createVisit(protocol, 'H-1', T0);
  for (const a of answers) {
    const r = E.applyAnswer(protocol, v, a, T0 + 1000);
    assert.equal(r.error, undefined, 'unexpected error: ' + r.error);
    v = r.visit;
  }
  return v;
}

test('numeric grid: decimals, values, membership', () => {
  assert.equal(E.decimalsOf(0.1), 1);
  assert.equal(E.decimalsOf(5), 0);
  assert.equal(E.decimalsOf(1e-7), 7);
  const s = P.steps[3];
  const values = E.gridValues(s);
  assert.equal(values.length, 11);
  assert.deepEqual([values[0], values[5], values[10]], [1, 1.5, 2]);
  assert.ok(values.every(v => String(v).length <= 3), 'no floating-point noise such as 1.2000000000000002');
  assert.ok(E.isOnGrid(s, 1.3));
  assert.ok(!E.isOnGrid(s, 1.35), 'off-grid value');
  assert.ok(!E.isOnGrid(s, 0.9), 'below min');
  assert.ok(!E.isOnGrid(s, 2.1), 'above max');
  assert.ok(!E.isOnGrid(s, NaN));
  assert.ok(!E.isOnGrid(s, '1.5'), 'strings are not numbers');
  assert.equal(E.gridIndexOf(s, 1.5), 5);
  assert.equal(E.formatNumber(s, 2), '2.0');
});

test('rule operators at their boundaries', () => {
  const r = (op, value) => ({ condition: { op, value }, target: 'x' });
  assert.equal(E.evaluateRule(r('gt', 38.5), 38.5), false);
  assert.equal(E.evaluateRule(r('gt', 38.5), 39), true);
  assert.equal(E.evaluateRule(r('gte', 38.5), 38.5), true);
  assert.equal(E.evaluateRule(r('gte', 38.5), 38), false);
  assert.equal(E.evaluateRule(r('lt', 2), 2), false);
  assert.equal(E.evaluateRule(r('lt', 2), 1.9), true);
  assert.equal(E.evaluateRule(r('lte', 2), 2), true);
  assert.equal(E.evaluateRule(r('lte', 2), 2.1), false);
  assert.equal(E.evaluateRule(r('eq', 0.3), 0.1 + 0.2), true, 'float equality is tolerance-based');
  assert.equal(E.evaluateRule(r('eq', 'a'), 'a'), true);
  assert.equal(E.evaluateRule(r('eq', '1'), 1), false, 'no string/number coercion');
  assert.equal(E.evaluateRule(r('neq', 'a'), 'b'), true);
  assert.equal(E.evaluateRule(r('neq', 'a'), 'a'), false);
  assert.equal(E.evaluateRule(r('in', ['a', 'b']), 'b'), true);
  assert.equal(E.evaluateRule(r('in', ['a', 'b']), 'c'), false);
  assert.equal(E.evaluateRule(r('in', 'a'), 'a'), false, 'in requires an array');
  assert.equal(E.evaluateRule(r('gt', 1), '2'), false, 'numeric ops never coerce strings');
  assert.equal(E.evaluateRule(r('bogus', 1), 1), false);
  assert.equal(E.evaluateRule(null, 1), false);
});

test('yesno: both branches', () => {
  assert.deepEqual(E.resolveNext(P.steps[0], 'yes'), { ok: true, next: 'q_choice' });
  assert.deepEqual(E.resolveNext(P.steps[0], 'no'), { ok: true, next: 'flag' });
  assert.equal(E.resolveNext(P.steps[0], 'maybe').ok, false);
  assert.equal(E.resolveNext(P.steps[0], true).ok, false);
});

test('choice: per-option next, null terminal, and fall-through to step.next', () => {
  const s = P.steps[2];
  assert.equal(E.resolveNext(s, 'a').next, 'q_count');
  assert.equal(E.resolveNext(s, 'b').next, 'q_range');
  assert.equal(E.resolveNext(s, 'end').next, null);
  assert.equal(E.resolveNext(s, 'ft').next, 'note');
  assert.equal(E.resolveNext(s, 'zzz').ok, false);
  const plain = { id: 'p', type: 'choice', options: ['X', 'Y'], next: 'n' };
  assert.equal(E.resolveNext(plain, 'Y').next, 'n');
  assert.equal(E.resolveNext({ id: 'q', type: 'choice', options: [{ label: 'a', value: 'a' }] }, 'a').ok, false,
    'no transition defined is an error, not a silent end');
});

test('count and range: grid answers only; rule overrides next', () => {
  assert.equal(E.resolveNext(P.steps[3], 1.7).next, 'note');
  assert.equal(E.resolveNext(P.steps[3], 1.75).ok, false);
  assert.equal(E.resolveNext(P.steps[4], 38.5).next, 'note', 'boundary: gt 38.5 does not fire at 38.5');
  assert.equal(E.resolveNext(P.steps[4], 39).next, 'flag2');
  assert.equal(E.resolveNext(P.steps[4], 42).next, 'flag2');
  assert.equal(E.resolveNext(P.steps[4], 42.5).ok, false);
});

test('info: only acknowledgement is accepted', () => {
  assert.equal(E.resolveNext(P.steps[6], 'ack').next, null);
  assert.equal(E.resolveNext(P.steps[6], 'yes').ok, false);
  assert.equal(E.resolveNext({ id: 'z', type: 'video' }, 'ack').ok, false, 'unknown frame type');
});

test('visit lifecycle: complete only at a null transition; invalid answers leave state unchanged', () => {
  let v = E.createVisit(P, 'H-1', T0);
  assert.equal(v.status, 'in_progress');
  const bad = E.applyAnswer(P, v, 'maybe', T0);
  assert.ok(bad.error);
  assert.equal(bad.visit, v);
  v = run(P, ['yes', 'end']);
  assert.equal(v.status, 'complete');
  assert.equal(v.current, null);
  assert.equal(E.applyAnswer(P, v, 'yes', T0).error, 'Visit is not in progress');
});

test('missing step yields an error state, never completion', () => {
  const broken = JSON.parse(JSON.stringify(P));
  broken.steps[0].onYes = 'does_not_exist';
  const v = run(broken, ['yes']);
  assert.equal(v.status, 'error');
  assert.match(v.error, /missing step "does_not_exist"/);
  assert.throws(() => E.buildRecord(broken, v, null), /Only completed visits/);
  const noStart = Object.assign({}, P, { start: 'nope' });
  assert.equal(E.createVisit(noStart, 'H-1', T0).status, 'error');
});

test('flags are derived from the path: counted once, removed by back', () => {
  let v = run(P, ['no']);                      // now on the referral frame
  assert.equal(E.visitFlags(P, v).length, 1, 'a referral on screen counts once');
  v = run(P, ['no', 'ack']);                   // past it
  assert.equal(E.visitFlags(P, v).length, 1, 'leaving the frame does not add a second flag');
  v = E.goBack(E.goBack(v));                   // back to the yes/no
  assert.equal(v.current, 'q_yes');
  assert.equal(E.visitFlags(P, v).length, 0, 'going back removes the flag');
  v = run(P, ['no', 'ack', 'b', 40]);          // rule fires -> second referral frame
  assert.deepEqual(E.visitFlags(P, v).map(f => f.stepId), ['flag', 'flag2']);
});

test('back navigation: one frame at a time; complete visits are final', () => {
  const v = run(P, ['yes', 'a']);
  const b1 = E.goBack(v);
  assert.equal(b1.current, 'q_choice');
  assert.equal(b1.path.length, 1);
  assert.equal(E.goBack(E.goBack(b1)), null, 'cannot go back before the first question');
  assert.equal(E.goBack(run(P, ['yes', 'end'])), null);
  assert.equal(v.path.length, 2, 'input visit not mutated');
});

test('progress is path-based and never claims more than the longest remaining path', () => {
  let v = E.createVisit(P, 'H-1', T0);
  let p = E.progress(P, v);
  assert.equal(p.question, 1);
  assert.equal(p.upToMore, E.remainingFrames(P, 'q_yes') - 1);
  assert.equal(E.remainingFrames(P, 'q_yes'), 5); // q_yes flag q_choice q_range flag2 (or ... note)
  v = run(P, ['no', 'ack', 'b']);
  p = E.progress(P, v);
  assert.equal(p.question, 4);
  assert.equal(p.upToMore, 1);
  assert.ok(p.fraction > 0 && p.fraction < 1);
  assert.equal(E.progress(P, run(P, ['yes', 'end'])).fraction, 1);
});

test('restoreVisit replays the path and rejects anything inconsistent', () => {
  const v = run(P, ['no', 'ack', 'a']);
  assert.equal(E.restoreVisit(P, JSON.parse(JSON.stringify(v))).ok, true);
  const cases = {
    'other protocol': Object.assign({}, v, { protocolId: 'x' }),
    'version changed': Object.assign({}, v, { protocolVersion: '2.0.0' }),
    'not in progress': Object.assign({}, v, { status: 'complete' }),
    'no household': Object.assign({}, v, { householdId: '' }),
    'no start time': Object.assign({}, v, { startedAt: 'yesterday' }),
    'path not array': Object.assign({}, v, { path: {} }),
    'duplicated entry': Object.assign({}, v, { path: v.path.concat(v.path) }),
    'answer tampered': Object.assign({}, v, { path: [{ stepId: 'q_yes', answer: 'yes' }].concat(v.path.slice(1)) }),
    'invalid answer': Object.assign({}, v, { path: [{ stepId: 'q_yes', answer: 'perhaps' }] }),
    'wrong current': Object.assign({}, v, { current: 'note' })
  };
  for (const [name, saved] of Object.entries(cases)) {
    assert.equal(E.restoreVisit(P, saved).ok, false, name);
  }
  assert.equal(E.restoreVisit(P, null).ok, false);
});

test('buildRecord produces readable answers and exact flags', () => {
  const v = run(P, ['no', 'ack', 'a', 1.2, 'ack']);
  const r = E.buildRecord(P, v, { area: 'Sector 1' });
  assert.equal(r.status, 'complete');
  assert.equal(r.area, 'Sector 1');
  assert.deepEqual(r.answers.map(a => a.answer), ['No', 'Referral shown', 'A', '1.2 kg', 'Acknowledged']);
  assert.equal(r.flags.length, 1);
  assert.equal(r.durationMs, 1000);
});

test('findProtocol resolves current and legacy IDs', () => {
  const legacy = registry.protocols.find(p => (p.legacyIds || []).length);
  assert.ok(legacy, 'a bundled protocol declares a legacy ID');
  assert.equal(E.findProtocol(registry, legacy.legacyIds[0]).id, legacy.id);
  assert.equal(E.findProtocol(registry, legacy.id).id, legacy.id);
  assert.equal(E.findProtocol(registry, 'nope'), null);
});

test('triage note is computed from the roster', () => {
  assert.equal(E.triageNote([{ id: 'H-1', area: 'A', dueIn: -1, lastFlag: null }, { id: 'H-2', area: 'B', dueIn: -3, lastFlag: null }]),
    '2 overdue · start with H-2 (B)');
  assert.equal(E.triageNote([{ id: 'H-1', area: 'A', dueIn: 0, lastFlag: 'x' }]), '1 flagged last visit · start with H-1');
  assert.equal(E.triageNote([{ id: 'H-1', area: 'A', dueIn: 2, lastFlag: null }]), 'No overdue or flagged visits');
  assert.equal(E.triageNote(registry.roster), '2 overdue · start with H-087 (Sector 7)');
});

// Walks every answer of every reachable frame in every bundled protocol.
test('exhaustive paths: every bundled protocol always terminates, every edge is exercised', () => {
  for (const p of registry.protocols) {
    const steps = E.stepMap(p);
    const usedEdges = new Set();
    const seen = new Set();
    let completed = 0;
    // Range/count domains are large; their branches depend only on the rule, so one value per
    // rule outcome plus the bounds is enough to cover every edge.
    function domain(step) {
      const all = E.answerDomain(step);
      if (step.type !== 'range' && step.type !== 'count') return all;
      const pick = [all[0], all[all.length - 1], step.default];
      if (step.rule) pick.push(...all.filter(x => E.evaluateRule(step.rule, x)).slice(0, 1), ...all.filter(x => !E.evaluateRule(step.rule, x)).slice(-1));
      return [...new Set(pick)];
    }
    function walk(visit, depth) {
      assert.ok(depth <= p.steps.length, p.id + ': path longer than the number of steps (cycle?)');
      const step = steps[visit.current];
      seen.add(step.id);
      for (const a of domain(step)) {
        const r = E.applyAnswer(p, visit, a, T0 + depth);
        assert.equal(r.error, undefined, p.id + '/' + step.id + ': ' + r.error);
        const next = r.visit;
        usedEdges.add(step.id + '->' + (next.status === 'complete' ? 'END' : next.current));
        assert.notEqual(next.status, 'error', p.id + ': ' + next.error);
        if (next.status === 'complete') {
          completed++;
          const flags = E.visitFlags(p, next);
          const dangerOnPath = next.path.filter(e => steps[e.stepId].danger).length;
          assert.equal(flags.length, dangerOnPath, p.id + ': flags equal referral frames on the path');
          E.buildRecord(p, next, null);
        } else walk(next, depth + 1);
      }
    }
    walk(E.createVisit(p, 'H-1', T0), 0);
    assert.equal(seen.size, p.steps.length, p.id + ': every step reached');
    for (const s of p.steps) {
      for (const t of E.transitions(s)) {
        assert.ok(usedEdges.has(s.id + '->' + (t.target === null ? 'END' : t.target)), p.id + ': edge ' + s.id + ' via ' + t.via + ' exercised');
      }
    }
    assert.ok(completed > 0);
  }
});
