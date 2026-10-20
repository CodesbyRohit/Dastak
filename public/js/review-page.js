// Sends aggregate-only sample data to /api/review and renders the response with textContent.
(function () {
  'use strict';
  var content = document.getElementById('content');

  // Sample data for the demo. Not real visits.
  var SAMPLE_VISITS = [
    { area: 'Sector 3', flags: [{ type: 'flag_temp' }] },
    { area: 'Sector 3', flags: [] },
    { area: 'Sector 7', flags: [{ type: 'flag_feeding' }] },
    { area: 'Sector 5', flags: [] },
    { area: 'Sector 3', flags: [{ type: 'flag_cord' }] },
    { area: 'Sector 7', flags: [] }
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function table(title, obj) {
    var s = el('section', 'section');
    s.appendChild(el('h2', null, title));
    Object.keys(obj).sort().forEach(function (k) {
      var row = el('div', 'field');
      row.appendChild(el('span', 'label', k));
      row.appendChild(el('span', 'value', String(obj[k])));
      s.appendChild(row);
    });
    return s;
  }
  function fail(msg) {
    content.textContent = '';
    content.appendChild(el('p', 'empty', msg));
  }

  function render(data) {
    content.textContent = '';
    var box = el('div', 'summary');
    box.appendChild(el('span', 'label', 'Counted summary (fixed rule)'));
    box.appendChild(document.createTextNode(data.summary));
    content.appendChild(box);
    if (data.aiSummary) {
      var ai = el('div', 'summary');
      ai.appendChild(el('span', 'label', data.aiSummary.label));
      ai.appendChild(document.createTextNode(data.aiSummary.text));
      content.appendChild(ai);
    } else {
      content.appendChild(el('p', 'banner', 'No AI description' + (data.fallbackReason ? ': ' + data.fallbackReason : '') + '.'));
    }
    var stats = el('div', 'stats');
    [[data.data.totalVisits, 'Visits'], [data.data.totalFlags, 'Referral flags']].forEach(function (s) {
      var b = el('div', 'stat');
      b.appendChild(el('div', 'num', String(s[0])));
      b.appendChild(el('div', 'lbl', s[1]));
      stats.appendChild(b);
    });
    content.appendChild(stats);
    content.appendChild(table('Flags by type', data.data.flagsByType));
    content.appendChild(table('Visits by area', data.data.visitsByArea));
  }

  if (!window.fetch || !window.AbortController) { fail('This browser cannot load the review.'); return; }
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, 12000);
  fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visits: SAMPLE_VISITS }),
    signal: ctl.signal
  }).then(function (res) {
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function (data) {
    if (!data || typeof data.summary !== 'string' || !data.data) throw new Error('bad response');
    render(data);
  }).catch(function () {
    clearTimeout(timer);
    fail('Review needs a connection to the server, and it is unreachable right now. The visit workflow is unaffected.');
  });
})();
