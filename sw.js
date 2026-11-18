// EXHIBIT service worker: offline support + automatic updates.
// tools/build.mjs stamps VERSION on every deploy. A changed sw.js makes every installed app
// (including home-screen apps) fetch the new version in the background and switch to it.
const VERSION = '__BUILD_VERSION__';
const SHELL = `gh-shell-${VERSION}`;
const ART = 'gh-art-v1';          // encrypted artwork files: content-hashed names, safe to keep
const CORE = ['./', './index.html', './css/app.css', './css/fonts.css', './js/app.js', './manifest.webmanifest', './brand/hero.jpg', './icons/icon-192.png', './icons/favicon.svg', './icons/favicon-32.png', './icons/favicon-48.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    let list = CORE;
    try { const r = await fetch('./precache.json', { cache: 'reload' }); if (r.ok) list = [...new Set([...CORE, ...(await r.json()).files])]; } catch {}
    // add individually so one missing file can't break the install
    await Promise.all(list.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gh-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first (with a short timeout) for the app's own code, so every update reaches users
// immediately however the site is hosted. Offline → the saved copy.
function networkFirst(req, cacheKey = req) {
  return new Promise(resolve => {
    let done = false;
    const fallback = () => caches.match(cacheKey, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'));
    const timer = setTimeout(() => { if (!done) fallback().then(r => { if (r && !done) { done = true; resolve(r); } }); }, 3500);
    fetch(req, { cache: 'no-cache' }).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(cacheKey, copy)).catch(() => {}); }
      if (!done) { done = true; clearTimeout(timer); resolve(r); }
    }).catch(() => { if (!done) { fallback().then(r => { done = true; clearTimeout(timer); resolve(r || Response.error()); }); } });
  });
}
function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit;
    const r = await fetch(req); if (r.ok) await c.put(req, r.clone()).catch(() => {}); return r;
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // never touch other sites
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  if (path.startsWith('studio/')) return;                      // studio always live from the network
  if (path.startsWith('art/')) return event.respondWith(cacheFirst(req, ART));            // encrypted, content-hashed
  if (path.startsWith('vendor/')) return event.respondWith(cacheFirst(req, SHELL));       // pinned libraries
  if (req.mode === 'navigate') return event.respondWith(networkFirst(req, './index.html'));
  // app code, styles, gallery.json, icons, brand image…
  event.respondWith(networkFirst(req));
});
