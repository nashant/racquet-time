// Offline support: precache the build and serve it cache-first (sports-hall wifi is unreliable).
// A new deploy ships a new sw.js; it installs in the background and takes over on the next load.
const CACHE = 'racquet-time-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('racquet-time-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? './' : req;
  event.respondWith(caches.match(key, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit ?? fetch(req)));
});
