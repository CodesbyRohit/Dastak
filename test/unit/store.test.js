// Device storage: save/resume, isolation by household and protocol, expiry, malformed and
// duplicate data, storage failures, record validation, legacy migration, and deletion.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../public/js/engine.js');
const S = require('../../public/js/store.js');
const registry = require('../../public/generated/registry.js');

const T0 = 1_800_000_000_000;
const HOUR = 3600 * 1000;
const [P0, P1] = registry.protocols;

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}
const storeWith = mem => S.createStore(() => mem);

function visitAt(protocol, household, answers) {
  let v = E.createVisit(protocol, household, T0);
  for (const a of answers) {
    const r = E.applyAnswer(protocol, v, a, T0);
    assert.equal(r.error, undefined, r.error);
    v = r.visit;
  }
  return v;
}
// home_visit: weight 2.8 -> feeding "no" -> referral frame
const P0_TO_REFERRAL = [2.8, 'no'];

test('save and resume restores answers and flags exactly', () => {
  const st = storeWith(new MemoryStorage());
  const v = visitAt(P0, 'H-104', P0_TO_REFERRAL.concat(['ack']));
  assert.ok(st.saveVisit(v, T0 + 1000));
  const loaded = st.loadVisit(P0, 'H-104', T0 + 2000);
  assert.deepEqual(loaded.visit.path, v.path);
  assert.equal(loaded.visit.current, v.current);
  assert.equal(loaded.savedAt, T0 + 1000);
  assert.equal(E.visitFlags(P0, loaded.visit).length, 1, 'the referral raised before the interruption survives');
});

test('interrupted visits are isolated by household and by protocol', () => {
  const st = storeWith(new MemoryStorage());
  st.saveVisit(visitAt(P0, 'H-104', P0_TO_REFERRAL), T0);
  assert.equal(st.loadVisit(P0, 'H-112', T0), null, 'other household sees nothing');
  assert.equal(st.loadVisit(P1, 'H-104', T0), null, 'other protocol sees nothing');
  st.saveVisit(visitAt(P1, 'H-104', ['no']), T0);
  assert.equal(st.loadVisit(P0, 'H-104', T0).visit.protocolId, P0.id, 'second protocol did not overwrite the first');
  assert.ok(st.clearVisit('H-104', P0.id));
  assert.equal(st.loadVisit(P0, 'H-104', T0), null);
  assert.ok(st.loadVisit(P1, 'H-104', T0).visit);
});

test('interrupted visits expire after 24 hours and are deleted', () => {
  const mem = new MemoryStorage();
  const st = storeWith(mem);
  st.saveVisit(visitAt(P0, 'H-104', P0_TO_REFERRAL), T0);
  assert.ok(st.loadVisit(P0, 'H-104', T0 + 24 * HOUR).visit);
  assert.match(st.loadVisit(P0, 'H-104', T0 + 24 * HOUR + 1).discarded, /older than 24 hours/);
  assert.equal(st.loadVisit(P0, 'H-104', T0), null, 'expired visit was removed');
});

test('tampered, malformed, or version-mismatched saved visits are discarded with a reason', () => {
  const mem = new MemoryStorage();
  const st = storeWith(mem);
  const good = visitAt(P0, 'H-104', P0_TO_REFERRAL);
  const key = S.KEYS.visits;
  const put = v => mem.setItem(key, JSON.stringify({ ['H-104|' + P0.id]: Object.assign({ savedAt: T0 }, v) }));

  put(Object.assign({}, good, { path: good.path.concat(good.path) }));
  assert.ok(st.loadVisit(P0, 'H-104', T0).discarded, 'duplicated path entries');
  put(Object.assign({}, good, { protocolVersion: '0.9.0' }));
  assert.match(st.loadVisit(P0, 'H-104', T0).discarded, /version/);
  put(Object.assign({}, good, { householdId: 'H-999' }));
  assert.match(st.loadVisit(P0, 'H-104', T0).discarded, /another household/);
  mem.setItem(key, JSON.stringify({ ['H-104|' + P0.id]: { savedAt: 'x' } }));
  assert.match(st.loadVisit(P0, 'H-104', T0).discarded, /unreadable/);
  mem.setItem(key, '{not json');
  assert.equal(st.loadVisit(P0, 'H-104', T0), null, 'unparseable storage is treated as empty');
  mem.setItem(key, '[1,2,3]');
  assert.equal(st.loadVisit(P0, 'H-104', T0), null);
});

test('carry-forward is isolated by household and protocol, replaced by later visits, and expires', () => {
  const st = storeWith(new MemoryStorage());
  const flags = [{ stepId: 'flag_temp', description: 'Low temperature recorded', referral: 'Refer.' }];
  st.saveCarry('H-104', P0.id, P0.label, flags, T0);
  assert.equal(st.carryFor('H-104', P0.id, T0).flags[0].stepId, 'flag_temp');
  assert.equal(st.carryFor('H-104', P1.id, T0), null, 'P1 does not inherit P0 flags for the same household');
  assert.equal(st.carryFor('H-112', P0.id, T0), null, 'another household does not inherit them');
  assert.equal(st.latestCarryForHousehold('H-104', T0).protocolId, P0.id);
  assert.equal(st.carryFor('H-104', P0.id, T0).flags[0].referral, undefined, 'only stepId and description are retained');
  st.saveCarry('H-104', P0.id, P0.label, [], T0 + 1);
  assert.equal(st.carryFor('H-104', P0.id, T0 + 1), null, 'a later visit with no flags clears carry-forward');
  st.saveCarry('H-104', P0.id, P0.label, flags, T0);
  assert.ok(st.carryFor('H-104', P0.id, T0 + 30 * 24 * HOUR));
  assert.equal(st.carryFor('H-104', P0.id, T0 + 30 * 24 * HOUR + 1), null, 'expires after 30 days');
});

test('malformed carry-forward entries are dropped', () => {
  const mem = new MemoryStorage();
  const st = storeWith(mem);
  mem.setItem(S.KEYS.carry, JSON.stringify({
    'H-1|x': { householdId: 'H-1', protocolId: 'x', visitLabel: 'X', savedAt: T0, flags: [{ stepId: 's' }] },
    'H-2|x': { householdId: 'H-9', protocolId: 'x', visitLabel: 'X', savedAt: T0, flags: [{ stepId: 's', description: 'd' }] },
    'H-3|x': { householdId: 'H-3', protocolId: 'x', visitLabel: 'X', savedAt: T0, flags: [{ stepId: 's', description: 'd' }] }
  }));
  assert.equal(st.carryFor('H-1', 'x', T0), null, 'flag without description');
  assert.equal(st.carryFor('H-9', 'x', T0), null, 'key does not match contents');
  assert.ok(st.carryFor('H-3', 'x', T0));
  assert.deepEqual(Object.keys(JSON.parse(mem.getItem(S.KEYS.carry))), ['H-3|x'], 'invalid entries removed from storage');
});

test('records: only the latest is kept, and only valid records are returned', () => {
  const mem = new MemoryStorage();
  const st = storeWith(mem);
  const v = visitAt(P0, 'H-104', P0_TO_REFERRAL.concat(['ack', 'no', 'yes', 'yes', 'Feeding']));
  assert.equal(v.status, 'complete');
  const record = E.buildRecord(P0, v, { area: 'Sector 3' });
  st.saveRecord(record);
  st.saveRecord(record);
  assert.deepEqual(st.loadRecord(), record);
  assert.equal(mem.keys().filter(k => k === S.KEYS.record).length, 1);

  const xss = JSON.parse(JSON.stringify(record));
  xss.answers[0].answer = '<img src=x onerror=alert(1)>';
  assert.equal(S.validateRecord(xss).answers[0].answer, '<img src=x onerror=alert(1)>',
    'markup is kept as inert text; record.html renders it with textContent');
  const extra = Object.assign({}, record, { injected: 'x' });
  assert.equal(S.validateRecord(extra).injected, undefined, 'unknown fields are stripped');

  const bad = [
    null, [], 'str', Object.assign({}, record, { kind: 'other' }), Object.assign({}, record, { status: 'in_progress' }),
    Object.assign({}, record, { householdId: 7 }), Object.assign({}, record, { startedAt: 'not a date' }),
    Object.assign({}, record, { durationMs: -1 }), Object.assign({}, record, { answers: 'x' }),
    Object.assign({}, record, { flags: [{ stepId: 's' }] }), Object.assign({}, record, { answers: [{ stepId: 's', prompt: 'p', answer: 5 }] })
  ];
  for (const b of bad) assert.equal(S.validateRecord(b), null, JSON.stringify(b).slice(0, 60));

  mem.setItem(S.KEYS.record, JSON.stringify(bad[3]));
  assert.equal(st.loadRecord(), null);
  assert.equal(mem.getItem(S.KEYS.record), null, 'invalid stored record is deleted');
});

test('blocked storage: the store reports unavailable and every operation fails safely', () => {
  const st = S.createStore(() => { throw new Error('SecurityError'); });
  assert.equal(st.status(), 'unavailable');
  assert.equal(st.saveVisit(visitAt(P0, 'H-1', []), T0), false);
  assert.equal(st.loadVisit(P0, 'H-1', T0), null);
  assert.equal(st.saveCarry('H-1', P0.id, 'x', [{ stepId: 'a', description: 'b' }], T0), false);
  assert.equal(st.carryFor('H-1', P0.id, T0), null);
  assert.equal(st.loadRecord(), null);
  assert.equal(st.clearAll(), false);
  assert.equal(st.hasAnyData(), false);
  assert.deepEqual(st.migrateLegacy(registry, T0), { migrated: 0, discarded: 0 });
  assert.equal(S.createStore(() => null).status(), 'unavailable');
});

test('full storage: writes fail and the store reports write-failed, then recovers', () => {
  const mem = new MemoryStorage();
  let full = false;
  const quota = { getItem: k => mem.getItem(k), removeItem: k => mem.removeItem(k), setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); mem.setItem(k, v); } };
  const st = S.createStore(() => quota);
  assert.equal(st.status(), 'ok');
  full = true;
  assert.equal(st.saveVisit(visitAt(P0, 'H-1', []), T0), false);
  assert.equal(st.status(), 'write-failed');
  full = false;
  assert.equal(st.saveVisit(visitAt(P0, 'H-1', []), T0), true);
  assert.equal(st.status(), 'ok');
});

test('voice preference is validated', () => {
  const st = storeWith(new MemoryStorage());
  assert.equal(st.loadVoice(), null);
  assert.equal(st.saveVoice(''), false);
  assert.ok(st.saveVoice('off'));
  assert.equal(st.loadVoice(), 'off');
});

test('legacy v1 data: attributable entries migrate (including the former HBNC ID), the rest is removed', () => {
  const mem = new MemoryStorage();
  const legacyId = P0.legacyIds[0];
  mem.setItem('dastak_carry', JSON.stringify({
    ['H-104:' + legacyId]: { flags: [{ stepId: 'flag_temp', type: 'flag_temp', description: 'Low temperature recorded', visitLabel: 'HBNC' }] },
    ['H-112:' + P1.id]: { flags: [{ stepId: 'referral', type: 'referral', description: 'Refer.', visitLabel: 'Danger Signs' }] },
    'H-098': { flags: [{ stepId: 'flag_feeding', description: 'Feeding difficulty recorded' }] },
    'H-155:unknown_protocol': { flags: [{ stepId: 'x', description: 'y' }] }
  }));
  mem.setItem('dastak_visit', JSON.stringify({
    protocolId: legacyId, householdId: 'H-104', stepId: 'temp',
    answers: { weight: 2.8, feeding: 'no', flag_feeding: 'flagged' },
    flags: [], history: ['weight', 'feeding', 'flag_feeding'], savedAt: T0 - HOUR
  }));
  mem.setItem('dastak_last_record', JSON.stringify({ protocol: '<img src=x onerror=alert(1)>' }));
  mem.setItem('dastak_voice', 'Samantha');

  const st = storeWith(mem);
  const result = st.migrateLegacy(registry, T0);
  assert.deepEqual(result, { migrated: 3, discarded: 3 });
  assert.equal(st.carryFor('H-104', P0.id, T0).flags[0].stepId, 'flag_temp', 'legacy ID mapped to the current protocol');
  assert.ok(st.carryFor('H-112', P1.id, T0));
  assert.equal(st.latestCarryForHousehold('H-098', T0), null, 'household-only key could not be attributed');
  const resumed = st.loadVisit(P0, 'H-104', T0);
  assert.equal(resumed.visit.current, 'temp');
  assert.equal(E.visitFlags(P0, resumed.visit).length, 1);
  assert.equal(st.loadRecord(), null, 'unvalidated v1 record is not carried over');
  assert.equal(st.loadVoice(), 'Samantha');
  for (const k of S.LEGACY_KEYS) assert.equal(mem.getItem(k), null, k + ' removed');
});

test('clearAll deletes every Dastak key, current and legacy, and nothing else', () => {
  const mem = new MemoryStorage();
  const st = storeWith(mem);
  st.saveVisit(visitAt(P0, 'H-1', P0_TO_REFERRAL), T0);
  st.saveCarry('H-1', P0.id, 'x', [{ stepId: 'a', description: 'b' }], T0);
  st.saveVoice('off');
  mem.setItem('dastak_carry', '{}');
  mem.setItem('unrelated', 'keep');
  assert.ok(st.hasAnyData());
  assert.ok(st.clearAll());
  assert.deepEqual(mem.keys(), ['unrelated']);
  assert.equal(st.hasAnyData(), false);
});
