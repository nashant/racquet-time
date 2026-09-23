// Offline support: precache the build and serve it cache-first (sports-hall wifi is unreliable).
// A new deploy ships a new sw.js; it installs in the background and takes over on the next load.
const CACHE = 'racquet-time-__VERSION__';
const PRECACHE = __PRECACHE__;

// Every file comes straight from the server (not the HTTP cache) so the page and its assets are
// from the same deploy. If index.html points at anything outside this deploy's list, the install
// fails and the previous, consistent copy stays in charge.
async function precache() {
  const responses = await Promise.all(
    PRECACHE.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`Precache ${url} failed: ${res.status}`);
      return [url, res];
    }),
  );
  const html = await responses[0][1].clone().text();
  for (const [, path] of html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)) {
    if (!PRECACHE.includes(`./${path}`)) throw new Error('index.html is from a different deploy');
  }
  const cache = await caches.open(CACHE);
  await Promise.all(responses.map(([url, res]) => cache.put(url, res)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      .catch(async (err) => {
        await caches.delete(CACHE);
        throw err;
      })
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
  // ignoreVary: servers send `Vary: Origin`, and the page's crossorigin script requests carry an
  // Origin header the precache requests didn't, so a strict match would miss (asset names are
  // content-hashed, so ignoring Vary is safe).
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreVary: true });
      return hit ?? fetch(req);
    }),
  );
});
