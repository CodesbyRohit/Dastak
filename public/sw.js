// ============================================================
// DASTAK — Service worker (offline app shell)
//
// What this worker sends over the network: GET requests for the app's own static files
// (HTML, JS, icons), when installing a new version and when revalidating them online.
// Those requests carry no visit data: no query strings, no bodies. Visit data lives only
// in this device's localStorage and is never read by this worker.
//
// Strategy:
//   - install: precache APP_SHELL (bypassing the HTTP cache) under a cache named by BUILD_ID,
//     which changes whenever any shell file changes (stamped by scripts/build-registry.js)
//   - HTML navigations: network first, fall back to the cached shell when offline
//   - other shell files: cache first, revalidated in the background when online
//   - /api/*: never cached, never intercepted
// ============================================================

// <generated: scripts/build-registry.js>
var BUILD_ID = '1d5beccc8c5b';
var APP_SHELL = [
  "/",
  "/glasses.html",
  "/js/engine.js",
  "/js/store.js",
  "/js/glasses-app.js",
  "/generated/registry.js",
  "/record.html",
  "/js/record-page.js",
  "/plan.html",
  "/js/planner.js",
  "/js/plan-page.js",
  "/review.html",
  "/js/review-page.js",
  "/css/phone.css",
  "/icon.png",
  "/icon-96.png"
];
// </generated>

var CACHE = 'dastak-' + BUILD_ID;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function shellKey(url) {
  return url.pathname;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res.ok && APP_SHELL.indexOf(shellKey(url)) !== -1) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(shellKey(url), copy); });
        }
        return res;
      }).catch(function () {
        return caches.open(CACHE).then(function (c) {
          return c.match(shellKey(url)).then(function (hit) { return hit || c.match('/glasses.html'); });
        });
      })
    );
    return;
  }

  if (APP_SHELL.indexOf(shellKey(url)) === -1) return;
  event.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(shellKey(url)).then(function (hit) {
        var refresh = fetch(req).then(function (res) {
          if (res.ok) c.put(shellKey(url), res.clone());
          return res;
        });
        if (hit) { refresh.catch(function () { /* offline: cached copy already served */ }); return hit; }
        return refresh;
      });
    })
  );
});
