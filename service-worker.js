// ── Version Control — Service Worker Template ────────────────────────────────
//
// "2.5.0" and "mymusic" are replaced at build time by the
// viteVersionControl() plugin (packages/version-control/vite-plugin/index.js).
//
// This file must live in src/ (not public/) so Vite processes it.
// The plugin reads it, substitutes the placeholders, and writes it to dist/.

const VERSION    = typeof "2.5.0" !== "undefined" ? "2.5.0" : "dev";
const SLUG       = typeof "mymusic"    !== "undefined" ? "mymusic"    : "app";
const BASE_PATH  = typeof "/mymusic-public/"    !== "undefined" ? "/mymusic-public/"    : "/";

const CACHE_NAME = `${SLUG}-v${VERSION}`;

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener("install", event => {
    // Pre-cache just enough to survive offline. Vite-hashed bundles are handled
    // by the network-first strategy below and cached lazily on first fetch.
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(() => self.skipWaiting()) // activate immediately, don't wait for tab close
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
                        console.log(`[SW ${SLUG}] Deleting old cache: ${key}`);
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

    // Blob URLs and any path segment named "samples" — never cache
    if (url.protocol === "blob:" || url.pathname.includes("/samples/")) return;

    // manifest.json — network-only so the browser always sees updates
    if (url.pathname.endsWith("manifest.json")) {
        event.respondWith(
            fetch(request, { cache: "no-store" }).catch(() => caches.match(request))
        );
        return;
    }

    // ── HTML, JS, CSS → NETWORK-FIRST ────────────────────────────────────────
    // Always try the network first; cache is only a fallback for offline use.
    const isDocument = request.destination === "document" || url.pathname.endsWith(".html");
    const isScript   = request.destination === "script"   || url.pathname.endsWith(".js");
    const isStyle    = request.destination === "style"    || url.pathname.endsWith(".css");

    if (isDocument || isScript || isStyle) {
        event.respondWith(
            fetch(request, { cache: "no-cache" })
                .then(response => {
                    if (response && response.status === 200 && response.type === "basic") {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() =>
                    caches.match(request).then(cached => {
                        if (cached) return cached;
                        // Last resort for documents: return the app shell
                        if (isDocument) return caches.match(`${BASE_PATH}index.html`);
                    })
                )
        );
        return;
    }

    // ── Static hashed assets (icons, images, fonts) → CACHE-FIRST ────────────
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
