// Service worker for the installable web version (generated into sw.js at build time).
// Keeps a full copy of the app on the device so it opens and works offline.
const CACHE = "bracket-builder-87683322f6ec";
const FILES = ["assets/arm-wrestling-challenge-illustration-removebg-preview_1773901359407-CVK69yYQ.png","assets/backend-AKdivVGW.js","assets/html2canvas.esm-DXEQVQnt.js","assets/index-BdjxP-YJ.js","assets/index-CDMxFu23.js","assets/index-ChwlFMx5.js","assets/index-DLf0UmHm.css","assets/index-NQZxJBh8.js","assets/index.es-rlfyzmPe.js","assets/jspdf.es.min-Cve9ouSn.js","assets/jspdf.plugin.autotable-CwUr-dqL.js","assets/open-sans-cyrillic-400-normal-DvjyhnTk.woff2","assets/open-sans-cyrillic-500-normal-C0pJK5UH.woff2","assets/open-sans-cyrillic-600-normal-BuMhxFId.woff2","assets/open-sans-cyrillic-700-normal-Db4W_Rwa.woff2","assets/open-sans-cyrillic-800-normal-CLEA-VCR.woff2","assets/open-sans-cyrillic-ext-400-normal-B28g4zcY.woff2","assets/open-sans-cyrillic-ext-500-normal-DLgW8Edg.woff2","assets/open-sans-cyrillic-ext-600-normal-CivhzOCV.woff2","assets/open-sans-cyrillic-ext-700-normal-BWp9aGB1.woff2","assets/open-sans-cyrillic-ext-800-normal-DF2CpYlt.woff2","assets/open-sans-greek-400-normal-BKm6CSmU.woff2","assets/open-sans-greek-500-normal-BvKlOb5R.woff2","assets/open-sans-greek-600-normal-CkCBI2Km.woff2","assets/open-sans-greek-700-normal-YcFp24oM.woff2","assets/open-sans-greek-800-normal-BHLhgrHJ.woff2","assets/open-sans-hebrew-400-normal-C3uFZKNA.woff2","assets/open-sans-hebrew-500-normal-CDpmdBH0.woff2","assets/open-sans-hebrew-600-normal-CQztwT7q.woff2","assets/open-sans-hebrew-700-normal-DnAL3HC_.woff2","assets/open-sans-hebrew-800-normal-Cp7AGT1L.woff2","assets/open-sans-latin-400-normal-Bk63H6sG.woff2","assets/open-sans-latin-500-normal-C0rntwkW.woff2","assets/open-sans-latin-600-normal-Cp4N6AwT.woff2","assets/open-sans-latin-700-normal-CceUhp2e.woff2","assets/open-sans-latin-800-normal-C0t39IfQ.woff2","assets/open-sans-latin-ext-400-normal-URAvo6nN.woff2","assets/open-sans-latin-ext-500-normal-BFKxrfUf.woff2","assets/open-sans-latin-ext-600-normal-CXDaa6Q7.woff2","assets/open-sans-latin-ext-700-normal-DatbY7Hl.woff2","assets/open-sans-latin-ext-800-normal-4iR0Hipn.woff2","assets/open-sans-math-400-normal-C76BUjK0.woff2","assets/open-sans-math-500-normal-CIx22CNi.woff2","assets/open-sans-math-600-normal-DQ8cZjrd.woff2","assets/open-sans-math-700-normal-EYnC2qGX.woff2","assets/open-sans-math-800-normal-D0lj8p21.woff2","assets/open-sans-symbols-400-normal-OZvd8qMe.woff2","assets/open-sans-symbols-500-normal-CiruYkOL.woff2","assets/open-sans-symbols-600-normal-DgwZOEXg.woff2","assets/open-sans-symbols-700-normal-DfXrtqu8.woff2","assets/open-sans-symbols-800-normal-CnQN0pe9.woff2","assets/open-sans-vietnamese-400-normal-Dqpvjuft.woff2","assets/open-sans-vietnamese-500-normal-C2c3EQ5t.woff2","assets/open-sans-vietnamese-600-normal-cWHhjaNO.woff2","assets/open-sans-vietnamese-700-normal-C0rmKuKj.woff2","assets/open-sans-vietnamese-800-normal-oIjSD_Ak.woff2","assets/purify.es-18JuyMri.js","assets/web-DZXKaItl.js","assets/web-DmtXKV46.js","favicon.png","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest"];

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
