// Requests a plan from /api/plan; falls back to the same deterministic rule locally.
(function () {
  'use strict';
  var content = document.getElementById('content');
  var R = window.DASTAK_REGISTRY;
  var P = window.DastakPlanner;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function protocolLabel(id) {
    for (var i = 0; i < R.protocols.length; i++) if (R.protocols[i].id === id) return R.protocols[i].label;
    return id;
  }

  var roster = R.roster;
  var request = roster.map(function (h) {
    return { id: h.id, area: h.area, protocol: protocolLabel(h.protocolId), dueIn: h.dueIn, lastFlag: h.lastFlag };
  });

  function render(order, source, why) {
    content.textContent = '';
    var banner = el('p', 'banner' + (source === 'ai' ? ' ai' : ''));
    banner.textContent = source === 'ai'
      ? 'Order suggested by AI (order only). Reasons are computed by a fixed rule.'
      : 'Ordered by a fixed rule: overdue first, then flagged last visit, then due today.' + (why ? ' (' + why + ')' : '');
    content.appendChild(banner);
    content.appendChild(el('p', 'banner', P.summaryNote(roster)));
    var byId = {};
    roster.forEach(function (h) { byId[h.id] = h; });
    order.forEach(function (o, i) {
      var h = byId[o.id];
      if (!h) return;
      var item = el('div', 'item');
      item.appendChild(el('div', 'title', (i + 1) + '. ' + h.id + ' · ' + h.area));
      item.appendChild(el('div', 'meta', protocolLabel(h.protocolId)));
      item.appendChild(el('div', 'reason', P.reason(h)));
      content.appendChild(item);
    });
    var start = el('a', 'btn', 'Open the glasses app');
    start.href = '/glasses.html';
    content.appendChild(start);
  }

  function local(why) { render(P.deterministicOrder(roster), 'deterministic', why); }

  if (!window.fetch || !window.AbortController) { local('offline planner'); return; }
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, 10000);
  fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roster: request }),
    signal: ctl.signal
  }).then(function (res) {
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function (data) {
    var ids = data && Array.isArray(data.order) ? data.order.map(function (o) { return o && o.id; }) : null;
    // Never trust a plan that drops, duplicates or invents households.
    if (!P.isPermutation(ids, roster)) { local('server response rejected'); return; }
    render(data.order, data.source === 'ai' ? 'ai' : 'deterministic', data.source === 'ai' ? null : data.fallbackReason);
  }).catch(function () {
    clearTimeout(timer);
    local('server unreachable; planned on this device');
  });
})();
