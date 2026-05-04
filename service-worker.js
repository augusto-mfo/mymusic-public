// MyMusic Service Worker
// Strategy: Cache-first for static assets, network-first for everything else.
// On install, pre-cache all known static assets so the app works fully offline.

const CACHE_NAME = "mymusic-v1";

// All static assets to pre-cache on install.
// Paths must include the base: /mymusic-public/
const PRECACHE_URLS = [
    "/mymusic-public/",
    "/mymusic-public/index.html",
    "/mymusic-public/manifest.json",
    "/mymusic-public/favicon.ico",
    "/mymusic-public/icon-192.png",
    "/mymusic-public/icon-512.png",
    "/mymusic-public/screenshots/wide.png",
    "/mymusic-public/screenshots/portrait.png",
];

// ── Install — pre-cache static shell ─────────────────────────────────────────
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Cache what we can; ignore missing optional assets (e.g. screenshots)
            return Promise.allSettled(
                PRECACHE_URLS.map(url => cache.add(url).catch(() => null))
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Activate — delete old caches ─────────────────────────────────────────────
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => clients.claim())
    );
});

// ── Fetch — cache-first for same-origin static assets ────────────────────────
self.addEventListener("fetch", event => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle GET requests from our own origin
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    // Audio files (samples or local blobs): network-only, never cache
    if (url.pathname.includes("/samples/") || url.protocol === "blob:") return;

    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            // Not in cache — fetch from network and cache the response
            return fetch(request).then(response => {
                // Only cache valid, same-origin, non-opaque responses
                if (
                    !response ||
                    response.status !== 200 ||
                    response.type !== "basic"
                ) {
                    return response;
                }

                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(request, responseToCache);
                });

                return response;
            }).catch(() => {
                // Network failed — return cached index.html as fallback for navigation
                if (request.destination === "document") {
                    return caches.match("/mymusic-public/index.html");
                }
            });
        })
    );
});
