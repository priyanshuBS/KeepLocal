/*
 * Keeplocal service worker — makes the app work offline after the first visit.
 *
 * A service worker is a script the browser keeps between visits. It sits between the page
 * and the network and can answer requests from a local cache. It ONLY handles requests to
 * this site's own files (HTML, JS, CSS, the FFmpeg engine). It never sees your files —
 * they are read directly from disk and never travel through fetch().
 *
 * The PRECACHE list and CACHE version below are filled in at build time by vite.config.ts.
 */
const PRECACHE = __PRECACHE__;
const CACHE = 'keeplocal-' + __VERSION__;

self.addEventListener('install', (event) => {
  // Download the whole app shell up front (except the big FFmpeg engine, which is cached
  // the first time someone actually uses the audio converter).
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Remove caches from older versions of the app.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('keeplocal-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Pages: try the network first (to get updates), fall back to the cached copy offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./'))),
    );
    return;
  }

  // Everything else (hashed JS/CSS, the WASM engine): cache first, then network.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
