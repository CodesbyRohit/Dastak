// Showcase page: scales the embedded 600×600 app to its container and renders recorded test
// results from /test-results.json (written by `npm run report`). Shows nothing it cannot load.
(function () {
  'use strict';

  var device = document.getElementById('device');
  var frame = document.getElementById('device-frame');
  function fit() { frame.style.transform = 'scale(' + device.clientWidth / 600 + ')'; }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(device);
  else window.addEventListener('resize', fit);
  fit();

  var box = document.getElementById('results');
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function metric(n, label, failed) {
    var m = el('div', 'metric');
    m.appendChild(el('div', 'n' + (failed ? ' fail' : ''), String(n)));
    m.appendChild(el('div', 'l', label));
    return m;
  }
  function unavailable(why) {
    box.textContent = '';
    box.appendChild(el('p', 'small', 'No recorded results are published with this deployment (' + why + '). Run the commands below to produce them.'));
  }

  fetch('/test-results.json', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (d) {
    if (!d || !Array.isArray(d.suites)) throw new Error('unexpected format');
    box.textContent = '';
    d.suites.forEach(function (s) {
      var failed = s.failed > 0;
      box.appendChild(metric(s.passed + ' / ' + s.total, s.name + (failed ? ' · ' + s.failed + ' failed' : ' passed') + (s.skipped ? ' · ' + s.skipped + ' skipped (not run)' : ''), failed));
    });
    var meta = el('p', 'meta');
    meta.textContent = 'Recorded ' + d.recordedAt + ' at commit ' + d.commit + ' · Node ' + d.node + (d.browser ? ' · ' + d.browser : '') +
      (d.coverage ? ' · line coverage ' + d.coverage + '%' : '') + '.';
    box.appendChild(meta);
    if (Array.isArray(d.notCovered) && d.notCovered.length) {
      var scope = el('div', 'scope');
      scope.appendChild(el('p', 'small', 'Not covered by these tests:'));
      var ul = el('ul', 'ticks warn');
      d.notCovered.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      scope.appendChild(ul);
      box.appendChild(scope);
    }
  }).catch(function (e) { unavailable(e.message); });
})();
