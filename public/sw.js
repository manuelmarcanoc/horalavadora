const CACHE = "horalavadora-v3";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Datos de precios: siempre red primero, caché solo si no hay red
  if (url.pathname.endsWith("/data.json") || url.pathname.endsWith("/api/prices")) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || Response.error()))
    );
    return;
  }

  // Cache-first para assets estáticos
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
