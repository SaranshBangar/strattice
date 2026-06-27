// Minimal offline shell cache.
// Network-first for navigations/API (always get fresh deploy), cache-first for hashed static assets.
// ponytail: hand-rolled ~30 lines beats a finicky PWA plugin across Next versions.
const CACHE = "bot-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  )
);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live

  // Navigations / HTML: network-first so new deployments load. Fall back to cache offline.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Hashed static assets (/_next/static/...): cache-first is safe, filenames change per build.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() => hit)
    )
  );
});
