// Service worker: lets No Brakes install as an app and play offline.
// Game files are network-first (so updates show up as soon as you're online),
// falling back to the cached copy. Three.js and the font come from CDNs and are
// cache-first, since those URLs never change.

const CACHE = 'no-brakes-v13';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'src/main.js', 'src/terrain.js', 'src/vehicles.js', 'src/traffic.js', 'src/physics.js', 'src/car.js',
  'src/ui.js', 'src/scenery.js', 'src/save.js', 'src/rng.js', 'src/input.js', 'src/effects.js', 'src/audio.js',
  'src/environment.js', 'src/nightlights.js',
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([...SHELL, ...CDN.map((u) => new Request(u, { mode: 'cors' }))])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
    );
  } else {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
