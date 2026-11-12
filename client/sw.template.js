// Service worker for the installable web version (generated into sw.js at build time).
// Keeps a full copy of the app on the device so it opens and works offline.
const CACHE = "bracket-builder-__VERSION__";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  // "reload" bypasses the browser's HTTP cache so a new version never stores stale files.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("bracket-builder-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Lets the page ask a freshly downloaded version to take over right away.
self.addEventListener("message", (event) => {
  if (event.data === "activate-now") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Opening the app: always the stored copy, so it starts instantly and offline.
    event.respondWith(caches.match("index.html", { cacheName: CACHE }).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)));
});
