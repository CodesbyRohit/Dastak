// Dastak Service Worker — v1
// Offline mode per MCP build guide: HTTPS required, no user permission needed.
// Three-stage lifecycle: install → activate → fetch.

var CACHE_NAME = 'dastak-v8';
var APP_SHELL = [
  '/glasses.html',
  '/record.html',
  '/plan.html',
  '/review.html',
  '/icon.png',
  '/icon-96.png'
];

// Stage 1: Install — precache app shell
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Stage 2: Activate — clean old versioned caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Stage 3: Fetch — cache-first for app shell, network-first for API
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;

      return fetch(event.request).then(function(response) {
        if (event.request.method === 'GET' && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        if (event.request.mode === 'navigate') {
          return caches.match('/glasses.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
