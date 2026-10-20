// ============================================================
// DASTAK — Local storage layer (device only; never sent anywhere)
// Every read is validated, every access is wrapped: if storage is blocked or full,
// the visit still runs and the UI is told that progress is NOT being saved.
//
// What is kept on the device, and for how long:
//   interrupted visits  - one per household+protocol, expire after RETENTION.visitMs (24 h)
//   carry-forward flags - latest visit's referral flags per household+protocol, expire after
//                         RETENTION.carryMs (30 days); a later visit without flags clears them
//   last visit record   - only the most recent completed visit
//   voice preference    - the chosen speech voice name
// clearAll() deletes all of it, including pre-upgrade keys.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.DastakStore = factory(root.DastakEngine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  var KEYS = {
    visits: 'dastak.visits.v2',
    carry: 'dastak.carry.v2',
    record: 'dastak.record.v2',
    voice: 'dastak.voice.v2'
  };
  var LEGACY_KEYS = ['dastak_visit', 'dastak_carry', 'dastak_last_record', 'dastak_voice'];
  var RETENTION = { visitMs: 24 * 60 * 60 * 1000, carryMs: 30 * 24 * 60 * 60 * 1000 };
  var MAX_TEXT = 200;

  function isStr(s, max) { return typeof s === 'string' && s.length > 0 && s.length <= (max || MAX_TEXT); }
  function isTime(n) { return typeof n === 'number' && isFinite(n) && n > 0; }
  function key(householdId, protocolId) { return householdId + '|' + protocolId; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------------- record validation (also used by record.html) ----------------
  // Returns a clean copy containing only known fields, or null if anything is off.
  function validateRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    if (r.kind !== 'dastak.visit-record' || r.recordVersion !== 1 || r.status !== 'complete') return null;
    var strings = ['protocolId', 'protocolVersion', 'protocolLabel', 'protocolStatus', 'householdId', 'startedAt', 'completedAt'];
    for (var i = 0; i < strings.length; i++) if (!isStr(r[strings[i]], 64)) return null;
    if (!(r.area === null || isStr(r.area, 64))) return null;
    if (isNaN(Date.parse(r.startedAt)) || isNaN(Date.parse(r.completedAt))) return null;
    if (typeof r.durationMs !== 'number' || !isFinite(r.durationMs) || r.durationMs < 0) return null;
    if (!Array.isArray(r.answers) || r.answers.length > 200 || !Array.isArray(r.flags) || r.flags.length > 200) return null;
    var answers = [];
    for (var a = 0; a < r.answers.length; a++) {
      var x = r.answers[a];
      if (!x || !isStr(x.stepId, 64) || !isStr(x.prompt) || !isStr(x.answer)) return null;
      answers.push({ stepId: x.stepId, prompt: x.prompt, answer: x.answer });
    }
    var flags = [];
    for (var f = 0; f < r.flags.length; f++) {
      var y = r.flags[f];
      if (!y || !isStr(y.stepId, 64) || !isStr(y.description) || !isStr(y.referral)) return null;
      flags.push({ stepId: y.stepId, description: y.description, referral: y.referral });
    }
    return {
      kind: r.kind, recordVersion: 1, status: 'complete',
      protocolId: r.protocolId, protocolVersion: r.protocolVersion, protocolLabel: r.protocolLabel,
      protocolStatus: r.protocolStatus, householdId: r.householdId, area: r.area,
      startedAt: r.startedAt, completedAt: r.completedAt, durationMs: r.durationMs,
      answers: answers, flags: flags
    };
  }

  function validCarryEntry(e) {
    if (!e || typeof e !== 'object') return false;
    if (!isStr(e.householdId, 64) || !isStr(e.protocolId, 64) || !isStr(e.visitLabel, 64) || !isTime(e.savedAt)) return false;
    if (!Array.isArray(e.flags) || !e.flags.length || e.flags.length > 50) return false;
    for (var i = 0; i < e.flags.length; i++) {
      if (!e.flags[i] || !isStr(e.flags[i].stepId, 64) || !isStr(e.flags[i].description)) return false;
    }
    return true;
  }

  // ---------------- store ----------------
  // getStorage: function returning a Storage-like object; may throw (blocked storage).
  function createStore(getStorage) {
    var storage = null;
    var state = 'ok'; // ok | unavailable | write-failed

    try {
      storage = getStorage();
      if (!storage) throw new Error('no storage');
      storage.setItem('dastak.probe', '1');
      storage.removeItem('dastak.probe');
    } catch (e) {
      storage = null;
      state = 'unavailable';
    }

    function readJson(k) {
      if (!storage) return undefined;
      try {
        var raw = storage.getItem(k);
        if (raw === null || raw === undefined) return undefined;
        return JSON.parse(raw);
      } catch (e) {
        return undefined; // unreadable or malformed: treated as absent
      }
    }
    function writeJson(k, v) {
      if (!storage) return false;
      try { storage.setItem(k, JSON.stringify(v)); if (state === 'write-failed') state = 'ok'; return true; }
      catch (e) { state = 'write-failed'; return false; }
    }
    function remove(k) {
      if (!storage) return false;
      try { storage.removeItem(k); return true; } catch (e) { return false; }
    }
    function readMap(k) {
      var m = readJson(k);
      return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    }

    // ---- interrupted visits ----
    function saveVisit(visit, now) {
      var m = readMap(KEYS.visits);
      var copy = JSON.parse(JSON.stringify(visit));
      copy.savedAt = now;
      m[key(visit.householdId, visit.protocolId)] = copy;
      return writeJson(KEYS.visits, m);
    }
    function clearVisit(householdId, protocolId) {
      var m = readMap(KEYS.visits);
      var k = key(householdId, protocolId);
      if (!hasOwn(m, k)) return true;
      delete m[k];
      return writeJson(KEYS.visits, m);
    }
    // Returns { visit, savedAt } | { discarded: reason } | null (nothing saved).
    function loadVisit(protocol, householdId, now) {
      var m = readMap(KEYS.visits);
      var k = key(householdId, protocol.id);
      if (!hasOwn(m, k)) return null;
      var saved = m[k];
      var reason = null;
      if (!saved || !isTime(saved.savedAt)) reason = 'Saved visit was unreadable';
      else if (now - saved.savedAt > RETENTION.visitMs) reason = 'Saved visit was older than 24 hours';
      else if (saved.householdId !== householdId) reason = 'Saved visit belongs to another household';
      var restored = reason ? null : Engine.restoreVisit(protocol, saved);
      if (restored && !restored.ok) reason = restored.reason;
      if (reason) { clearVisit(householdId, protocol.id); return { discarded: reason }; }
      return { visit: restored.visit, savedAt: saved.savedAt };
    }

    // ---- carry-forward ----
    function readCarry(now) {
      var m = readMap(KEYS.carry);
      var changed = false;
      for (var k in m) {
        if (!hasOwn(m, k)) continue;
        if (!validCarryEntry(m[k]) || k !== key(m[k].householdId, m[k].protocolId) || now - m[k].savedAt > RETENTION.carryMs) {
          delete m[k];
          changed = true;
        }
      }
      if (changed) writeJson(KEYS.carry, m);
      return m;
    }
    function saveCarry(householdId, protocolId, visitLabel, flags, now) {
      var m = readCarry(now);
      var k = key(householdId, protocolId);
      if (!flags.length) delete m[k];
      else {
        m[k] = {
          householdId: householdId, protocolId: protocolId, visitLabel: visitLabel, savedAt: now,
          flags: flags.map(function (f) { return { stepId: f.stepId, description: f.description }; })
        };
      }
      return writeJson(KEYS.carry, m);
    }
    function carryFor(householdId, protocolId, now) {
      var m = readCarry(now);
      return m[key(householdId, protocolId)] || null;
    }
    // Most recent flagged entry for a household across protocols (idle screen).
    function latestCarryForHousehold(householdId, now) {
      var m = readCarry(now);
      var best = null;
      for (var k in m) {
        if (hasOwn(m, k) && m[k].householdId === householdId && (!best || m[k].savedAt > best.savedAt)) best = m[k];
      }
      return best;
    }

    // ---- last record ----
    function saveRecord(record) { return writeJson(KEYS.record, record); }
    function loadRecord() {
      var r = readJson(KEYS.record);
      if (r === undefined) return null;
      var clean = validateRecord(r);
      if (!clean) remove(KEYS.record);
      return clean;
    }

    // ---- voice ----
    function saveVoice(name) { return isStr(name, 120) ? writeJson(KEYS.voice, name) : false; }
    function loadVoice() { var v = readJson(KEYS.voice); return isStr(v, 120) ? v : null; }

    // ---- pre-upgrade data ----
    // Converts glasses.html v1 data that names its protocol (including legacy IDs such as the
    // former HBNC ID). Entries without a protocol ID cannot be attributed and are discarded,
    // as is the v1 last record (it was never validated and may hold injected markup).
    function migrateLegacy(registry, now) {
      if (!storage) return { migrated: 0, discarded: 0 };
      var migrated = 0, discarded = 0;
      var oldCarry = readJson('dastak_carry');
      if (oldCarry && typeof oldCarry === 'object') {
        for (var k in oldCarry) {
          if (!hasOwn(oldCarry, k)) continue;
          var parts = k.split(':');
          var p = parts.length === 2 ? Engine.findProtocol(registry, parts[1]) : null;
          var e = oldCarry[k];
          var flags = e && Array.isArray(e.flags) ? e.flags.filter(function (f) { return f && isStr(f.stepId, 64) && isStr(f.description); }) : [];
          if (p && isStr(parts[0], 64) && flags.length && !carryFor(parts[0], p.id, now)) {
            saveCarry(parts[0], p.id, p.label, flags, now);
            migrated++;
          } else discarded++;
        }
      }
      var oldVisit = readJson('dastak_visit');
      if (oldVisit && typeof oldVisit === 'object') {
        var proto = isStr(oldVisit.protocolId, 64) ? Engine.findProtocol(registry, oldVisit.protocolId) : null;
        var ok = false;
        if (proto && Array.isArray(oldVisit.history) && oldVisit.answers && typeof oldVisit.answers === 'object') {
          var steps = Engine.stepMap(proto);
          var candidate = {
            protocolId: proto.id, protocolVersion: proto.version, householdId: oldVisit.householdId,
            startedAt: oldVisit.savedAt, status: 'in_progress', current: oldVisit.stepId,
            path: oldVisit.history.map(function (id) {
              var a = oldVisit.answers[id];
              if (steps[id] && steps[id].type === 'info') a = 'ack';
              return { stepId: id, answer: a };
            })
          };
          var r = Engine.restoreVisit(proto, candidate);
          if (r.ok && isTime(oldVisit.savedAt) && now - oldVisit.savedAt <= RETENTION.visitMs) {
            saveVisit(r.visit, oldVisit.savedAt);
            ok = true;
          }
        }
        if (ok) migrated++; else discarded++;
      }
      var oldVoice = readJson('dastak_voice');
      if (oldVoice === undefined) { try { oldVoice = storage.getItem('dastak_voice'); } catch (e) { oldVoice = null; } }
      if (isStr(oldVoice, 120) && !loadVoice()) saveVoice(oldVoice);
      if (readJson('dastak_last_record') !== undefined) discarded++;
      for (var i = 0; i < LEGACY_KEYS.length; i++) remove(LEGACY_KEYS[i]);
      return { migrated: migrated, discarded: discarded };
    }

    // ---- deletion ----
    function clearAll() {
      if (!storage) return false;
      var all = [KEYS.visits, KEYS.carry, KEYS.record, KEYS.voice].concat(LEGACY_KEYS);
      var ok = true;
      for (var i = 0; i < all.length; i++) if (!remove(all[i])) ok = false;
      return ok;
    }

    function hasAnyData() {
      if (!storage) return false;
      var all = [KEYS.visits, KEYS.carry, KEYS.record, KEYS.voice].concat(LEGACY_KEYS);
      for (var i = 0; i < all.length; i++) {
        try { if (storage.getItem(all[i]) !== null) return true; } catch (e) { return false; }
      }
      return false;
    }

    return {
      status: function () { return state; },
      saveVisit: saveVisit, loadVisit: loadVisit, clearVisit: clearVisit,
      saveCarry: saveCarry, carryFor: carryFor, latestCarryForHousehold: latestCarryForHousehold,
      saveRecord: saveRecord, loadRecord: loadRecord,
      saveVoice: saveVoice, loadVoice: loadVoice,
      migrateLegacy: migrateLegacy, clearAll: clearAll, hasAnyData: hasAnyData
    };
  }

  return { createStore: createStore, validateRecord: validateRecord, KEYS: KEYS, LEGACY_KEYS: LEGACY_KEYS, RETENTION: RETENTION };
});
