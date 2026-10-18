/* Wedding Welcome — service worker
   Face aplicația să meargă fără internet:
   - fișierele aplicației (html, js, json): întâi rețeaua, ca să vină mereu împreună în aceeași versiune; fără internet, copia salvată.
   - imagini, iconițe și fonturi: din copia salvată, actualizate în fundal.
   La fiecare modificare a aplicației, crește CACHE ca laptopul să ia versiunea nouă. */
const CACHE = 'ww-v5';
const CORE = ['./', 'index.html', 'data.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'sablon-invitati.xlsx',
  'config.js', 'pricing.js', 'crm.js', 'oferta.html', 'img/totem.jpg'];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Great+Vibes&family=Josefin+Sans:wght@300..600&family=Jost:wght@300..600&family=Marcellus&family=Montserrat:wght@300..600&family=Playfair+Display:ital,wght@0,400..700;1,400..700&family=Raleway:wght@300..600&display=swap';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    try { await c.add(new Request(FONT_CSS, { mode: 'no-cors' })); } catch (_) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req, { cache: 'no-cache' });
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (_) {
    return (await c.match(req, { ignoreSearch: true })) ||
           (req.mode === 'navigate' ? c.match('index.html') : Response.error());
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate' || /\.(html|js|json|gs)$/.test(url.pathname) || url.pathname.endsWith('/'))
      return e.respondWith(networkFirst(req));
    return e.respondWith(cacheFirst(req));
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com')
    return e.respondWith(cacheFirst(req));
});
