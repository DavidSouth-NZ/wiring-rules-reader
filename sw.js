// Offline support for the app files. Your PDF is stored separately in the browser's IndexedDB, not here.
// Network first: when online you always get the latest version from the site; the cache is only used offline.
const CACHE = 'wrr-v7';
const SHELL = ['./', 'index.html', 'app.js', 'changes.js', 'guides.js', 'manifest.webmanifest', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon-64.png',
  ...['FoxitDingbats.pfb','FoxitFixed.pfb','FoxitFixedBold.pfb','FoxitFixedBoldItalic.pfb','FoxitFixedItalic.pfb','FoxitSerif.pfb','FoxitSerifBold.pfb','FoxitSerifBoldItalic.pfb','FoxitSerifItalic.pfb','FoxitSymbol.pfb','LiberationSans-Bold.ttf','LiberationSans-BoldItalic.ttf','LiberationSans-Italic.ttf','LiberationSans-Regular.ttf'].map(f => 'vendor/standard_fonts/' + f)];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache so a new version never stores stale files
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    fetch(new Request(u, { cache: 'reload' })).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {})
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (isFont) {   // fonts never change: cache first
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(c =>
    fetch(req, { cache: 'no-cache' })
      .then(r => { if (r.ok) c.put(req, r.clone()); return r; })
      .catch(async () => (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('index.html') : Response.error()))
  ));
});
