/* ============================================================
   Lámpara · service worker
   - La app (index.html, config.js, íconos) se guarda en el teléfono.
   - Con internet: siempre se baja la versión más nueva.
   - Sin internet (o con señal muy lenta): se abre la versión guardada.
   - Nunca toca las llamadas a Supabase ni nada de otros sitios,
     salvo las tipografías de Google, que se guardan para verse bien sin internet.
   Si algún día cambias ESTE archivo, cambia también el número de VERSION.
   ============================================================ */
const VERSION = 'lampara-v1';
const SHELL = ['index.html', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_WAIT = 4000; // si la red tarda más y hay copia guardada, se usa la copia

const scopeUrl = () => (self.registration && self.registration.scope) || self.location.href.replace(/[^/]*$/, '');
const INDEX_URL = () => new URL('index.html', scopeUrl()).href;
const wait = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(async u => {
      try {
        const abs = new URL(u, scopeUrl()).href;
        const res = await fetch(new Request(abs, { cache: 'reload' }));
        if (res && res.ok) await cache.put(abs, res);
      } catch (e) { /* si un archivo falla, los demás se guardan igual */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('lampara-') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Red primero; si no hay internet o tarda mucho, la copia guardada */
async function networkFirst(req, key) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const go = fetch(req).then(res => {
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  });
  go.catch(() => {});
  if (!cached) return go;
  try {
    const res = await Promise.race([go, wait(NET_WAIT)]);
    return (res && res.ok) ? res : cached;
  } catch (e) {
    return cached;
  }
}

/* Copia guardada al instante y se renueva en segundo plano */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.origin === self.location.origin) {
    const p = url.pathname;
    if (req.mode === 'navigate' || p.endsWith('/') || p.endsWith('/index.html')) {
      ev.respondWith(networkFirst(req, INDEX_URL()));
      return;
    }
    if (/\/(config\.js|manifest\.webmanifest)$/.test(p)) {
      ev.respondWith(networkFirst(req, url.origin + p));
      return;
    }
    if (/\.(png|svg|ico|webp|jpe?g|woff2?)$/i.test(p)) {
      ev.respondWith(staleWhileRevalidate(req));
      return;
    }
    return;
  }
  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    ev.respondWith(staleWhileRevalidate(req));
  }
  // Todo lo demás (Supabase, WhatsApp, etc.) pasa directo, sin tocar.
});
