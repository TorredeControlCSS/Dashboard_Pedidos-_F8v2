/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER — Incidencias CEDIS Panamá
   Versión: 1.0.0
   Estrategia: Cache-first para app shell, network-first para API
════════════════════════════════════════════════════════════ */

const CACHE_NAME   = 'cedis-incidencias-v2';
const QUEUE_STORE  = 'cedis_incidencias_q';

/* Archivos que se cachean en la instalación.
   Los HTML NO se precachean aquí: se sirven network-first (ver fetch),
   así la tablet siempre recibe la última versión tras cada despliegue. */
const APP_SHELL = [
  './manifest-incidencias.json'
];

/* ── INSTALL ────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL).catch(() => {
        /* Si falla algún recurso (ej. icons), continúa igual */
      });
    })
  );
  self.skipWaiting();
});

/* ── ACTIVATE ───────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── FETCH ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const url = event.request.url;

  /* API calls al GAS → siempre network; si falla, devuelve error JSON */
  if (url.includes('script.google.com')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ result: 'offline', msg: 'Sin conexión' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  /* ¿Es una navegación / documento HTML? → NETWORK-FIRST
     Siempre busca la versión fresca en la red; si no hay conexión,
     cae al caché. Evita que la tablet quede pegada en una versión vieja. */
  const esHTML = event.request.mode === 'navigate' ||
                 (event.request.headers.get('accept') || '').includes('text/html');

  if (esHTML) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(cached =>
          cached || caches.match('./incidencias.html')
        )
      )
    );
    return;
  }

  /* Estáticos (íconos, manifest, etc.) → cache-first */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        /* Cachea solo respuestas válidas de mismo origen */
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

/* ── BACKGROUND SYNC ────────────────────────────────────── */
/* Cuando el navegador recupera conexión, intenta reenviar la cola */
self.addEventListener('sync', event => {
  if (event.tag === 'cedis-flush-queue') {
    event.waitUntil(flushQueueFromSW());
  }
});

async function flushQueueFromSW() {
  /* La cola vive en localStorage del cliente, no en SW.
     Notificamos a todos los clientes para que hagan el flush. */
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'FLUSH_QUEUE' }));
}

/* ── PUSH NOTIFICATIONS (placeholder) ──────────────────── */
self.addEventListener('push', event => {
  /* Reservado para notificaciones futuras desde Paola → colaboradores */
});
