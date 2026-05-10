// MyMusic Service Worker
// "2.2.5" is replaced at build time by Vite's `define` (see vite.config.js).
// This file lives in src/ so Vite processes it — unlike public/ files which are
// copied verbatim and never have defines substituted.

const VERSION    = typeof "2.2.5" !== "undefined" ? "2.2.5" : "dev";
const CACHE_NAME = `mymusic-v${VERSION}`;

// Static assets that are safe to cache permanently.
// Vite-hashed JS/CSS bundles are NOT listed here — they're handled by the
// network-first strategy below and cached only as a fallback.
const STATIC_ASSETS = [
    "/mymusic-public/favicon.ico",
    "/mymusic-public/icon-192.png",
    "/mymusic-public/icon-512.png",
    "/mymusic-public/screenshots/wide.png",
    "/mymusic-public/screenshots/portrait.png",
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Pre-cache only the truly static, un-hashed assets.
            return Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url).catch(() => null))
            );
        }).then(() => self.skipWaiting()) // activate immediately, don't wait for tab close
    );
});

// ── Activate — delete every cache that isn't this version ────────────────────
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log(`[SW] Deleting old cache: ${key}`);
                        return caches.delete(key);
                    })
            ))
            .then(() => clients.claim()) // take control of all open tabs immediately
            .then(() => {
                // Tell every open tab that a new version is now live
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
    if (event.data?.type === "GET_VERSION") {
        event.source?.postMessage({ type: "SW_VERSION", version: VERSION });
    }
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
    const { request } = event;
    const url = new URL(request.url);

    // Only intercept same-origin GETs
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    // Audio blobs / sample files: always go to the network, never cache
    if (url.protocol === "blob:" || url.pathname.includes("/samples/")) return;

    // manifest.json — network-only, no caching, so the browser always sees updates
    if (url.pathname.endsWith("manifest.json")) {
        event.respondWith(
            fetch(request, { cache: "no-store" }).catch(() => caches.match(request))
        );
        return;
    }

    // ── HTML documents and JS/CSS bundles → NETWORK-FIRST ────────────────────
    // This is the critical change: we always try the network first for anything
    // that could change between releases. Cache is only a fallback for offline use.
    const isDocument = request.destination === "document" || url.pathname.endsWith(".html");
    const isScript   = request.destination === "script"   || url.pathname.endsWith(".js");
    const isStyle    = request.destination === "style"    || url.pathname.endsWith(".css");

    if (isDocument || isScript || isStyle) {
        event.respondWith(
            fetch(request, { cache: "no-cache" })
                .then(response => {
                    // Got a fresh response — update the cache and return it
                    if (response && response.status === 200 && response.type === "basic") {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    // Network failed (offline) — fall back to cache
                    return caches.match(request).then(cached => {
                        if (cached) return cached;
                        // Last resort for documents: return the app shell
                        if (isDocument) return caches.match("/mymusic-public/index.html");
                    });
                })
        );
        return;
    }

    // ── Static hashed assets (icons, images, fonts) → CACHE-FIRST ────────────
    // These have content-hashes in their filenames (Vite output), so stale
    // cache is not a concern — a changed file will have a different URL.
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
            });
        })
    );
});
