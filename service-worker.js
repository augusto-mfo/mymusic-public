// ── Version Control — Service Worker Template ────────────────────────────────
//
// "3.4.0", "mymusic", "/mymusic-public/" and ["/mymusic-public/","/mymusic-public/assets/index-BBb95gGy.js","/mymusic-public/assets/index-DeLBpSDf.css","/mymusic-public/assets/leaflet-src-Cje13lIy.js","/mymusic-public/assets/leaflet-vh-t_kPv.css","/mymusic-public/favicon.ico","/mymusic-public/icon-192.png","/mymusic-public/icon-512.png","/mymusic-public/index.html","/mymusic-public/manifest.json","/mymusic-public/samples.json"] are replaced
// at build time by the viteVersionControl() plugin
// (packages/version-control/vite-plugin/index.js).
//
// This file must live in src/ (not public/) so Vite processes it.
// The plugin reads it, substitutes the placeholders, and writes it to dist/.
//
// Strategy: OFFLINE-FIRST
//   - install  → downloads every build file into a versioned cache. The new
//                version only activates once ALL files are stored, so a failed
//                or interrupted update never leaves the app half-installed.
//   - fetch    → the app is served from the cache (no network wait). The
//                network is only used for files that are not cached.
//   - updates  → the browser re-checks this file whenever there is a
//                connection; a changed version triggers a new install in the
//                background while the current version keeps working.

const VERSION    = typeof "3.4.0"  !== "undefined" ? "3.4.0"  : "dev";
const SLUG       = typeof "mymusic"     !== "undefined" ? "mymusic"     : "app";
const BASE_PATH  = typeof "/mymusic-public/"     !== "undefined" ? "/mymusic-public/"     : "/";
const PRECACHE   = typeof ["/mymusic-public/","/mymusic-public/assets/index-BBb95gGy.js","/mymusic-public/assets/index-DeLBpSDf.css","/mymusic-public/assets/leaflet-src-Cje13lIy.js","/mymusic-public/assets/leaflet-vh-t_kPv.css","/mymusic-public/favicon.ico","/mymusic-public/icon-192.png","/mymusic-public/icon-512.png","/mymusic-public/index.html","/mymusic-public/manifest.json","/mymusic-public/samples.json"] !== "undefined" ? ["/mymusic-public/","/mymusic-public/assets/index-BBb95gGy.js","/mymusic-public/assets/index-DeLBpSDf.css","/mymusic-public/assets/leaflet-src-Cje13lIy.js","/mymusic-public/assets/leaflet-vh-t_kPv.css","/mymusic-public/favicon.ico","/mymusic-public/icon-192.png","/mymusic-public/icon-512.png","/mymusic-public/index.html","/mymusic-public/manifest.json","/mymusic-public/samples.json"] : [];

const CACHE_NAME = `${SLUG}-v${VERSION}`;
const INDEX_URL  = `${BASE_PATH}index.html`;

// In dev mode the precache list is empty: the service worker stays out of the
// way so Vite's HMR and fresh modules are never served from a stale cache.
const OFFLINE_FIRST = PRECACHE.length > 0;

// ── Install — precache the whole app, then activate ──────────────────────────
self.addEventListener("install", event => {
    event.waitUntil((async () => {
        if (OFFLINE_FIRST) {
            const cache = await caches.open(CACHE_NAME);
            try {
                await Promise.all(PRECACHE.map(async url => {
                    // "reload" bypasses the HTTP cache so we never store a stale copy
                    const response = await fetch(new Request(url, { cache: "reload" }));
                    if (!response.ok) throw new Error(`[SW ${SLUG}] ${url} → ${response.status}`);
                    await cache.put(url, response);
                }));
            } catch (err) {
                // Incomplete precache: drop it and fail the install, so the
                // previous version (if any) keeps running and we retry later.
                await caches.delete(CACHE_NAME);
                throw err;
            }
        }
        await self.skipWaiting(); // activate immediately, don't wait for tab close
    })());
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
    if (!OFFLINE_FIRST) return;

    const { request } = event;
    const url = new URL(request.url);

    // Only intercept same-origin GETs
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    // Range requests (audio/video seeking) and anything under "/samples/" go
    // straight to the network — the Cache API cannot store partial responses.
    if (request.headers.has("range") || url.pathname.includes("/samples/")) return;

    // manifest.json — network first (so the browser sees new versions),
    // cached copy when offline. The "?v=" query is ignored for the fallback.
    if (url.pathname.endsWith("manifest.json")) {
        event.respondWith(
            fetch(request, { cache: "no-store" })
                .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request, { ignoreSearch: true, ignoreVary: true })))
        );
        return;
    }

    // Page navigations → the cached app shell, instantly, with or without network.
    if (request.mode === "navigate") {
        event.respondWith(
            caches.open(CACHE_NAME)
                .then(cache => cache.match(INDEX_URL, { ignoreVary: true }))
                .then(cached => cached || fetch(request))
        );
        return;
    }

    // Everything else (JS, CSS, icons, samples.json…) → CACHE-FIRST.
    // Files missing from the cache are fetched and stored for next time.
    event.respondWith(
        caches.open(CACHE_NAME).then(cache =>
            cache.match(request, { ignoreVary: true }).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (response && response.status === 200 && response.type === "basic") {
                        cache.put(request, response.clone());
                    }
                    return response;
                });
            })
        )
    );
});
