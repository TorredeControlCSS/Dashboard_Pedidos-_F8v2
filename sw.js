/**
 * SERVICE WORKER — Torre de Control CEDIS PANAMÁ
 * Estrategia: Network First con fallback a caché
 * Las páginas HTML siempre intentan red primero (datos frescos)
 * Los assets estáticos se sirven desde caché
 */

const CACHE_NAME   = 'torre-control-v4';
const STATIC_CACHE = 'torre-control-static-v4';

// Páginas y assets que se pre-cachean al instalar
const PRECACHE_URLS = [
  './index.html',
  './almacenista.html',
  './rutas.html',
  './tracker.html',
  './asistencia.html',
  './manifest.json',
  './favicon.ico'
];

// CDN externos (solo caché, sin red-first para no bloquear)
const CDN_ORIGINS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com'
];

// ── INSTALL: pre-cachear páginas ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err => console.warn('Pre-cache parcial:', err)))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejos ──────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de recurso ─────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejar GET
  if (req.method !== 'GET') return;

  // Google Apps Script → siempre red, nunca cachear
  if (url.hostname.includes('script.google.com')) return;

  // CDN externos → caché first (son estáticos y versionados)
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Páginas HTML y assets locales → Network First con fallback
  event.respondWith(networkFirstWithFallback(req));
});

// ── Network First: intenta red, si falla usa caché ────────
async function networkFirstWithFallback(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(req);
    if (response && response.status === 200) {
      cache.put(req, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Fallback a la caché estática
    const staticCached = await caches.match(req);
    if (staticCached) return staticCached;
    // Fallback final: index.html para navegación
    if (req.mode === 'navigate') {
      return caches.match('./index.html');
    }
    return new Response('Sin conexión', { status: 503 });
  }
}

// ── Cache First: sirve desde caché, actualiza en background ──
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    // Actualizar en background (stale-while-revalidate)
    fetch(req).then(r => {
      if (r && r.status === 200) {
        caches.open(STATIC_CACHE).then(c => c.put(req, r));
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(req);
    if (response && response.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, response.clone());
    }
    return response;
  } catch {
    return new Response('Sin conexión', { status: 503 });
  }
}

// ── Mensaje para forzar actualización desde el cliente ────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
