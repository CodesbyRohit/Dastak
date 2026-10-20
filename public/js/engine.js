// ============================================================
// DASTAK — Protocol interpreter (pure; no DOM, no storage, no network)
// Loaded by glasses.html in the browser and by Node (validator, tests).
// The engine follows IDs and compares values. It does not know what any
// question means clinically: all clinical content lives in protocols/*.json.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DastakEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FRAME_TYPES = ['yesno', 'choice', 'count', 'range', 'info'];
  var NUMERIC_OPS = ['gt', 'gte', 'lt', 'lte'];
  var EPSILON = 1e-9;

  // ---------------- numbers ----------------
  function decimalsOf(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    var s = String(n);
    var e = s.indexOf('e-');
    if (e !== -1) return parseInt(s.slice(e + 2), 10);
    var dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }

  function roundTo(x, d) { return Number(x.toFixed(d)); }

  function gridDecimals(step) {
    return Math.max(decimalsOf(step.step), decimalsOf(step.min));
  }

  // All selectable values of a count/range step, ascending.
  function gridValues(step) {
    var d = gridDecimals(step);
    var n = Math.round((step.max - step.min) / step.step);
    var out = [];
    for (var k = 0; k <= n; k++) out.push(roundTo(step.min + k * step.step, d));
    return out;
  }

  function isOnGrid(step, v) {
    if (typeof v !== 'number' || !isFinite(v)) return false;
    if (v < step.min - EPSILON || v > step.max + EPSILON) return false;
    var k = (v - step.min) / step.step;
    return Math.abs(k - Math.round(k)) < 1e-6;
  }

  function gridIndexOf(step, v) {
    return Math.round((v - step.min) / step.step);
  }

  function formatNumber(step, v) {
    return v.toFixed(gridDecimals(step));
  }

  // ---------------- options ----------------
  // Normalises plain-string options to { label, value } objects.
  function normalizeOptions(step) {
    var opts = step.options || [];
    return opts.map(function (o) {
      if (typeof o === 'string') return { label: o, value: o };
      var copy = { label: o.label, value: o.value };
      if (Object.prototype.hasOwnProperty.call(o, 'next')) copy.next = o.next;
      return copy;
    });
  }

  // ---------------- rules ----------------
  function valuesEqual(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < EPSILON;
    return a === b;
  }

  function evaluateRule(rule, answer) {
    if (!rule || !rule.condition) return false;
    var op = rule.condition.op;
    var v = rule.condition.value;
    if (NUMERIC_OPS.indexOf(op) !== -1) {
      if (typeof answer !== 'number' || typeof v !== 'number') return false;
      switch (op) {
        case 'gt': return answer > v + EPSILON;
        case 'gte': return answer > v - EPSILON;
        case 'lt': return answer < v - EPSILON;
        case 'lte': return answer < v + EPSILON;
      }
    }
    if (op === 'eq') return valuesEqual(answer, v);
    if (op === 'neq') return !valuesEqual(answer, v);
    if (op === 'in') {
      if (!Array.isArray(v)) return false;
      for (var i = 0; i < v.length; i++) if (valuesEqual(answer, v[i])) return true;
      return false;
    }
    return false;
  }

  // ---------------- step graph ----------------
  function stepMap(protocol) {
    var map = {};
    var steps = (protocol && protocol.steps) || [];
    for (var i = 0; i < steps.length; i++) map[steps[i].id] = steps[i];
    return map;
  }

  // Every outgoing edge of a step: { via, target } where target may be null (end of visit).
  function transitions(step) {
    var out = [];
    if (step.rule) out.push({ via: 'rule', target: step.rule.target });
    if (step.type === 'yesno') {
      out.push({ via: 'yes', target: step.onYes });
      out.push({ via: 'no', target: step.onNo });
    } else if (step.type === 'choice') {
      normalizeOptions(step).forEach(function (o, i) {
        out.push({ via: 'option ' + i, target: o.next !== undefined ? o.next : step.next });
      });
    } else {
      out.push({ via: 'next', target: step.next });
    }
    return out;
  }

  // Valid answers for a step, used by the validator and tests to enumerate behaviour.
  function answerDomain(step) {
    switch (step.type) {
      case 'yesno': return ['yes', 'no'];
      case 'choice': return normalizeOptions(step).map(function (o) { return o.value; });
      case 'count':
      case 'range': return gridValues(step);
      case 'info': return ['ack'];
    }
    return [];
  }

  function isValidAnswer(step, answer) {
    switch (step.type) {
      case 'yesno': return answer === 'yes' || answer === 'no';
      case 'choice':
        return normalizeOptions(step).some(function (o) { return o.value === answer; });
      case 'count':
      case 'range': return isOnGrid(step, answer);
      case 'info': return answer === 'ack';
    }
    return false;
  }

  // Returns { ok: true, next: stepId|null } or { ok: false, reason }.
  // next === null means the visit ends after this step.
  function resolveNext(step, answer) {
    if (!step || FRAME_TYPES.indexOf(step.type) === -1) {
      return { ok: false, reason: 'Unknown frame type' };
    }
    if (!isValidAnswer(step, answer)) {
      return { ok: false, reason: 'Answer ' + JSON.stringify(answer) + ' is not valid for step "' + step.id + '"' };
    }
    if (step.rule && evaluateRule(step.rule, answer)) return { ok: true, next: step.rule.target };
    var target;
    if (step.type === 'yesno') target = answer === 'yes' ? step.onYes : step.onNo;
    else if (step.type === 'choice') {
      var opts = normalizeOptions(step);
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === answer) { target = opts[i].next !== undefined ? opts[i].next : step.next; break; }
      }
    } else target = step.next;
    if (target === undefined) return { ok: false, reason: 'Step "' + step.id + '" defines no transition for this answer' };
    return { ok: true, next: target };
  }

  // Longest number of frames from stepId to the end, including stepId itself.
  function remainingFrames(protocol, stepId) {
    var steps = stepMap(protocol);
    var memo = {};
    var visiting = {};
    function walk(id) {
      if (id === null || id === undefined || !steps[id]) return 0;
      if (memo[id] !== undefined) return memo[id];
      if (visiting[id]) return 0; // cycles are rejected by the validator; never loop here
      visiting[id] = true;
      var best = 0;
      transitions(steps[id]).forEach(function (t) { best = Math.max(best, walk(t.target)); });
      visiting[id] = false;
      memo[id] = best + 1;
      return memo[id];
    }
    return walk(stepId);
  }

  // ---------------- visits ----------------
  // A visit is a plain JSON-serialisable object. Functions below never mutate their input.
  function createVisit(protocol, householdId, now) {
    return {
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      householdId: householdId,
      startedAt: now,
      path: [],
      current: protocol.start,
      status: stepMap(protocol)[protocol.start] ? 'in_progress' : 'error',
      error: stepMap(protocol)[protocol.start] ? undefined : 'Start step "' + protocol.start + '" does not exist'
    };
  }

  function cloneVisit(v) {
    var c = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && v[k] !== undefined) c[k] = v[k];
    c.path = (v.path || []).slice();
    return c;
  }

  // Applies an answer to the current step. Returns { visit } or { visit, error } (input unchanged on error).
  function applyAnswer(protocol, visit, answer, now) {
    if (visit.status !== 'in_progress') return { visit: visit, error: 'Visit is not in progress' };
    var steps = stepMap(protocol);
    var step = steps[visit.current];
    if (!step) return { visit: visit, error: 'Current step "' + visit.current + '" does not exist' };
    var res = resolveNext(step, answer);
    if (!res.ok) return { visit: visit, error: res.reason };
    var nv = cloneVisit(visit);
    nv.path.push({ stepId: step.id, answer: answer });
    if (res.next === null) {
      nv.current = null;
      nv.status = 'complete';
      nv.completedAt = now;
    } else if (!steps[res.next]) {
      nv.current = null;
      nv.status = 'error';
      nv.error = 'Step "' + step.id + '" leads to missing step "' + res.next + '"';
    } else {
      nv.current = res.next;
    }
    return { visit: nv };
  }

  // Steps back one frame. Completed visits are final and cannot be reopened.
  function goBack(visit) {
    if (visit.status === 'complete' || visit.path.length === 0) return null;
    var nv = cloneVisit(visit);
    var last = nv.path.pop();
    nv.current = last.stepId;
    nv.status = 'in_progress';
    delete nv.error;
    delete nv.completedAt;
    return nv;
  }

  // Referral flags are derived from the path, never accumulated separately,
  // so they cannot be double-counted and disappear when the worker goes back.
  // A referral frame that is currently on screen counts: the worker has seen it.
  function visitFlags(protocol, visit) {
    var steps = stepMap(protocol);
    var ids = visit.path.map(function (p) { return p.stepId; });
    if (visit.current && steps[visit.current] && steps[visit.current].danger) ids.push(visit.current);
    var flags = [];
    ids.forEach(function (id) {
      var s = steps[id];
      if (s && s.danger) flags.push({ stepId: s.id, description: s.prompt, referral: s.referral });
    });
    return flags;
  }

  function progress(protocol, visit) {
    var answered = visit.path.length;
    if (visit.status !== 'in_progress') return { question: answered, answered: answered, upToMore: 0, fraction: 1 };
    var remaining = remainingFrames(protocol, visit.current); // includes current
    return {
      question: answered + 1,
      answered: answered,
      upToMore: Math.max(0, remaining - 1),
      fraction: answered / (answered + remaining)
    };
  }

  // Re-validates a saved in-progress visit by replaying its answers from the start.
  // Returns { ok: true, visit } or { ok: false, reason }.
  function restoreVisit(protocol, saved) {
    if (!saved || typeof saved !== 'object') return { ok: false, reason: 'No saved visit' };
    if (saved.protocolId !== protocol.id) return { ok: false, reason: 'Saved visit is for a different protocol' };
    if (saved.protocolVersion !== protocol.version) return { ok: false, reason: 'Protocol version changed since the visit was saved' };
    if (saved.status !== 'in_progress') return { ok: false, reason: 'Saved visit is not in progress' };
    if (typeof saved.householdId !== 'string' || !saved.householdId) return { ok: false, reason: 'Saved visit has no household' };
    if (typeof saved.startedAt !== 'number' || !isFinite(saved.startedAt)) return { ok: false, reason: 'Saved visit has no start time' };
    if (!Array.isArray(saved.path) || saved.path.length > protocol.steps.length) return { ok: false, reason: 'Saved path is malformed' };
    var steps = stepMap(protocol);
    var cur = protocol.start;
    var path = [];
    for (var i = 0; i < saved.path.length; i++) {
      var entry = saved.path[i];
      if (!entry || entry.stepId !== cur || !steps[cur]) return { ok: false, reason: 'Saved path does not match the protocol' };
      var res = resolveNext(steps[cur], entry.answer);
      if (!res.ok || res.next === null || !steps[res.next]) return { ok: false, reason: 'Saved path does not match the protocol' };
      path.push({ stepId: cur, answer: entry.answer });
      cur = res.next;
    }
    if (saved.current !== cur) return { ok: false, reason: 'Saved position does not match the protocol' };
    return {
      ok: true,
      visit: {
        protocolId: protocol.id,
        protocolVersion: protocol.version,
        householdId: saved.householdId,
        startedAt: saved.startedAt,
        path: path,
        current: cur,
        status: 'in_progress'
      }
    };
  }

  // ---------------- presentation helpers (text only) ----------------
  function formatAnswer(step, answer) {
    if (!step) return String(answer);
    switch (step.type) {
      case 'yesno': return answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : String(answer);
      case 'choice':
        var opts = normalizeOptions(step);
        for (var i = 0; i < opts.length; i++) if (opts[i].value === answer) return opts[i].label;
        return String(answer);
      case 'count':
      case 'range':
        return typeof answer === 'number' ? formatNumber(step, answer) + (step.unit ? ' ' + step.unit : '') : String(answer);
      case 'info': return step.danger ? 'Referral shown' : 'Acknowledged';
    }
    return String(answer);
  }

  // The record of a completed visit. Contains no names; household is an opaque ID.
  function buildRecord(protocol, visit, household) {
    if (visit.status !== 'complete') throw new Error('Only completed visits produce a record');
    var steps = stepMap(protocol);
    return {
      kind: 'dastak.visit-record',
      recordVersion: 1,
      status: 'complete',
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      protocolLabel: protocol.label,
      protocolStatus: protocol.status,
      householdId: visit.householdId,
      area: household && household.area ? household.area : null,
      startedAt: new Date(visit.startedAt).toISOString(),
      completedAt: new Date(visit.completedAt).toISOString(),
      durationMs: visit.completedAt - visit.startedAt,
      answers: visit.path.map(function (p) {
        var s = steps[p.stepId];
        return { stepId: p.stepId, prompt: s ? s.prompt : p.stepId, answer: formatAnswer(s, p.answer) };
      }),
      flags: visitFlags(protocol, visit)
    };
  }

  // Resolves a current or legacy protocol ID against a registry.
  function findProtocol(registry, id) {
    var list = (registry && registry.protocols) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    for (var j = 0; j < list.length; j++) {
      if ((list[j].legacyIds || []).indexOf(id) !== -1) return list[j];
    }
    return null;
  }

  // Deterministic, roster-derived one-line triage note for the idle screen.
  function triageNote(roster) {
    var overdue = roster.filter(function (h) { return h.dueIn < 0; })
      .sort(function (a, b) { return a.dueIn - b.dueIn; });
    var flagged = roster.filter(function (h) { return h.dueIn >= 0 && h.lastFlag; });
    if (overdue.length) {
      return overdue.length + ' overdue · start with ' + overdue[0].id + ' (' + overdue[0].area + ')';
    }
    if (flagged.length) {
      return flagged.length + ' flagged last visit · start with ' + flagged[0].id;
    }
    return 'No overdue or flagged visits';
  }

  return {
    FRAME_TYPES: FRAME_TYPES,
    decimalsOf: decimalsOf,
    gridDecimals: gridDecimals,
    gridValues: gridValues,
    gridIndexOf: gridIndexOf,
    isOnGrid: isOnGrid,
    formatNumber: formatNumber,
    normalizeOptions: normalizeOptions,
    evaluateRule: evaluateRule,
    stepMap: stepMap,
    transitions: transitions,
    answerDomain: answerDomain,
    isValidAnswer: isValidAnswer,
    resolveNext: resolveNext,
    remainingFrames: remainingFrames,
    createVisit: createVisit,
    applyAnswer: applyAnswer,
    goBack: goBack,
    visitFlags: visitFlags,
    progress: progress,
    restoreVisit: restoreVisit,
    formatAnswer: formatAnswer,
    buildRecord: buildRecord,
    findProtocol: findProtocol,
    triageNote: triageNote
  };
});
