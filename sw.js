/* Blue Demon Cricket service worker.
   Bump VERSION whenever index.html / styles.css / app.js change so phones pick up the update. */
const VERSION = "bd-v5";
const IMG_CACHE = "bd-img";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/logo-160.png",
  "icons/favicon-64.png",
  "icons/icon-192.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== IMG_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Google Sheets CSVs: the app keeps its own cache, so just go to the network.
  if (url.hostname.endsWith("google.com") || url.hostname.endsWith("googleusercontent.com")) return;

  // Same-origin app shell: serve from cache, refresh in the background.
  if (url.origin === location.origin) {
    event.respondWith(staleWhileRevalidate(request, request.mode === "navigate" ? "index.html" : null));
    return;
  }

  // Player photos and other cross-origin images: cache first.
  if (request.destination === "image") {
    event.respondWith(cacheFirst(request));
  }
});

async function staleWhileRevalidate(request, fallbackPath) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request, { ignoreSearch: true }) ||
    (fallbackPath && await cache.match(fallbackPath));
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

async function cacheFirst(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}
