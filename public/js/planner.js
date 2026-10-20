// ============================================================
// DASTAK — Deterministic day planner (no AI)
// Shared by plan.html (offline fallback) and api/_lib/plan.js (server fallback and
// the source of every reason string). Ordering rule:
//   1. overdue, most overdue first
//   2. households flagged at their last visit
//   3. due today
//   4. everything else, soonest first
// Ties keep roster order (Array.prototype.sort is stable).
// This orders visits. It does not assess anyone's health.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DastakPlanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function rank(h) {
    if (h.dueIn < 0) return 0;
    if (h.lastFlag) return 1;
    if (h.dueIn === 0) return 2;
    return 3;
  }

  function reason(h) {
    var days = Math.abs(h.dueIn);
    if (h.dueIn < 0) return 'overdue by ' + days + ' day' + (days === 1 ? '' : 's');
    if (h.lastFlag) return 'flagged last visit';
    if (h.dueIn === 0) return 'due today';
    return 'due in ' + days + ' day' + (days === 1 ? '' : 's');
  }

  function deterministicOrder(roster) {
    return roster.slice().sort(function (a, b) {
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.dueIn - b.dueIn;
    }).map(function (h) { return { id: h.id, reason: reason(h) }; });
  }

  // True when ids is exactly the set of roster IDs, each once.
  function isPermutation(ids, roster) {
    if (!Array.isArray(ids) || ids.length !== roster.length) return false;
    var want = {};
    roster.forEach(function (h) { want[h.id] = true; });
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      if (typeof ids[i] !== 'string' || !want[ids[i]] || seen[ids[i]]) return false;
      seen[ids[i]] = true;
    }
    return true;
  }

  // Builds the final plan from an ordering of IDs; reasons are always computed here.
  function planFromOrder(ids, roster) {
    var byId = {};
    roster.forEach(function (h) { byId[h.id] = h; });
    return ids.map(function (id) { return { id: id, reason: reason(byId[id]) }; });
  }

  function summaryNote(roster) {
    var overdue = roster.filter(function (h) { return h.dueIn < 0; }).length;
    var today = roster.filter(function (h) { return h.dueIn === 0; }).length;
    return roster.length + ' households: ' + overdue + ' overdue, ' + today + ' due today.';
  }

  return { deterministicOrder: deterministicOrder, isPermutation: isPermutation, planFromOrder: planFromOrder, reason: reason, summaryNote: summaryNote };
});
