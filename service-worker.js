const CACHE_NAME = "foto-seo-shopee-pages-v8";
const APP_BASE = new URL("./", self.registration.scope);
const APP_SHELL = ["", "manifest.json", "app.js", "auth.js", "supabase-config.js", "firebase-config.js", "icons/ceo-shopee-192.png", "icons/ceo-shopee-512.png"].map((path) => new URL(path, APP_BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("foto-seo-shopee-pages-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(APP_BASE.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
        if (request.mode === "navigate") await cache.put(APP_BASE.href, response.clone());
      }
      return response;
    } catch {
      const cached = await cache.match(request) || (request.mode === "navigate" ? await cache.match(APP_BASE.href) : null);
      if (cached) return cached;
      return new Response("Anda sedang offline. Buka kembali aplikasi saat terhubung ke internet.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
