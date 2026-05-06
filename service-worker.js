// MyMusic Service Worker
// __APP_VERSION__ is replaced at build time by Vite (see vite.config.js).
// Bumping APP_VERSION in src/version.js is all you need to do to:
//   - invalidate the old cache
//   - trigger a new SW install → activate cycle
//   - notify the user that an update is available

const VERSION    = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const CACHE_NAME = `mymusic-v${VERSION}`;

// All static assets to pre-cache on install.
// manifest.json is intentionally NOT pre-cached — always fetched from network.
const PRECACHE_URLS = [
    "/mymusic-public/",
    "/mymusic-public/index.html",
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
            return Promise.allSettled(
                PRECACHE_URLS.map(url => cache.add(url).catch(() => null))
            );
        }).then(() => self.skipWaiting()) // take control immediately
    );
});

// ── Activate — delete all old caches ─────────────────────────────────────────
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => clients.claim()) // take control of open tabs
            .then(() => {
                // Notify all open tabs that a new version is now active
                return self.clients.matchAll({ includeUncontrolled: true }).then(list => {
                    list.forEach(client => client.postMessage({
                        type: "SW_UPDATED",
                        version: VERSION,
                    }));
                });
            })
    );
});

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener("message", event => {
    // App can ask: "what version is the active SW?"
    if (event.data?.type === "GET_VERSION") {
        event.source?.postMessage({ type: "SW_VERSION", version: VERSION });
    }
    // App can tell a waiting SW to activate immediately
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle GET from our own origin
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    // Audio files / blobs: always network-only
    if (url.pathname.includes("/samples/") || url.protocol === "blob:") return;

    // manifest.json — network-first, no caching, so updates are instant
    if (url.pathname.endsWith("manifest.json")) {
        event.respondWith(
            fetch(request, { cache: "no-store" }).catch(() => caches.match(request))
        );
        return;
    }

    // Everything else — cache-first, fall back to network
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            return fetch(request).then(response => {
                if (!response || response.status !== 200 || response.type !== "basic") {
                    return response;
                }
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                return response;
            }).catch(() => {
                if (request.destination === "document") {
                    return caches.match("/mymusic-public/index.html");
                }
            });
        })
    );
});
