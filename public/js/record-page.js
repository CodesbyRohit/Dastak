// Renders the last completed visit from this browser's storage.
// Every value is validated by DastakStore.validateRecord and inserted with textContent.
(function () {
  'use strict';
  var content = document.getElementById('content');
  var store = window.DastakStore.createStore(function () { return window.localStorage; });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function field(label, value, cls) {
    var row = el('div', 'field');
    row.appendChild(el('span', 'label', label));
    row.appendChild(el('span', 'value' + (cls ? ' ' + cls : ''), value));
    return row;
  }
  function section(title) {
    var s = el('section', 'section');
    s.appendChild(el('h2', null, title));
    return s;
  }
  function duration(ms) {
    var s = Math.floor(ms / 1000);
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  content.textContent = '';

  // Records used to be accepted from a base64 URL fragment. That path allowed script
  // injection and put visit data into shareable URLs, so it was removed.
  if (location.hash && location.hash.length > 1) {
    history.replaceState(null, '', location.pathname);
    content.appendChild(el('p', 'banner warn', 'Records are not accepted via links. The link\'s contents were ignored and removed from the address bar.'));
  }

  if (store.status() !== 'ok') {
    content.appendChild(el('p', 'empty', 'Storage is unavailable in this browser, so no record can be shown.'));
    return;
  }

  var r = store.loadRecord();
  if (!r) {
    content.appendChild(el('p', 'empty', 'No completed visit is stored in this browser. Complete a visit in the glasses app on this device first.'));
    return;
  }

  var stats = el('div', 'stats');
  [[String(r.answers.length), 'Answers'], [String(r.flags.length), 'Referral flags'], [duration(r.durationMs), 'Duration']].forEach(function (s) {
    var box = el('div', 'stat');
    box.appendChild(el('div', 'num', s[0]));
    box.appendChild(el('div', 'lbl', s[1]));
    stats.appendChild(box);
  });
  content.appendChild(stats);

  var meta = section('Visit');
  meta.appendChild(field('Status', 'Complete'));
  meta.appendChild(field('Household', r.householdId));
  meta.appendChild(field('Area', r.area || '—'));
  meta.appendChild(field('Protocol', r.protocolLabel + ' (v' + r.protocolVersion + ')'));
  meta.appendChild(field('Content status', r.protocolStatus));
  meta.appendChild(field('Started', new Date(r.startedAt).toLocaleString()));
  meta.appendChild(field('Completed', new Date(r.completedAt).toLocaleString()));
  content.appendChild(meta);

  if (r.flags.length) {
    var fl = section('Referral flags');
    r.flags.forEach(function (f) { fl.appendChild(field(f.description, f.referral, 'flag')); });
    content.appendChild(fl);
  }

  var ans = section('Answers');
  r.answers.forEach(function (a) { ans.appendChild(field(a.prompt, a.answer)); });
  content.appendChild(ans);

  var del = el('button', 'btn danger', 'Delete all Dastak data in this browser');
  del.type = 'button';
  del.addEventListener('click', function () {
    if (!window.confirm('Delete the interrupted visits, carry-forward flags, this record and the voice setting stored in this browser? This cannot be undone.')) return;
    var ok = store.clearAll();
    content.textContent = '';
    content.appendChild(el('p', 'empty', ok ? 'All Dastak data in this browser was deleted.' : 'Could not delete: storage is unavailable.'));
  });
  content.appendChild(del);
})();
