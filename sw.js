// Offline cache for the app shell. Your PDF is stored separately in the browser's IndexedDB, not here.
const CACHE = 'wrr-v4';
const SHELL = ['./', 'index.html', 'app.js', 'changes.js', 'manifest.webmanifest', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon-64.png',
  ...['FoxitDingbats.pfb','FoxitFixed.pfb','FoxitFixedBold.pfb','FoxitFixedBoldItalic.pfb','FoxitFixedItalic.pfb','FoxitSerif.pfb','FoxitSerifBold.pfb','FoxitSerifBoldItalic.pfb','FoxitSerifItalic.pfb','FoxitSymbol.pfb','LiberationSans-Bold.ttf','LiberationSans-BoldItalic.ttf','LiberationSans-Italic.ttf','LiberationSans-Regular.ttf'].map(f => 'vendor/standard_fonts/' + f)];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;
  // app files: cache first, refresh in background; fonts: cache first
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
