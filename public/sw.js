/**
 * @fileoverview Service Worker for Uniden BCT15X Web Remote PWA
 * @description Provides offline caching for static assets (HTML, CSS, JS, locales, icons),
 * while explicitly bypassing real-time streams and API endpoints.
 */

const CACHE_NAME = 'bct15x-remote-v10';

/**
 * Static asset URLs to pre-cache on installation
 */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/index.css',
  '/js/app.js',
  '/js/i18n.js',
  '/js/audioPlayer.js',
  '/js/scannerDisplay.js',
  '/js/controlPanel.js',
  '/js/recordingPanel.js',
  '/js/activityLog.js',
  '/js/memoryEditor.js',
  '/locales/en.json',
  '/locales/ja.json',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

/**
 * URLs that must NEVER be cached (stream, API, control commands)
 */
const BYPASS_URL_PATTERNS = [
  /\/stream/,
  /\/recordings/,
  /\/status/,
  /\/command/,
  /\/memory/,
  /\/api\//,
];

// Install event: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate event: clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch event: stale-while-revalidate for static assets, network-only for real-time traffic
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Check if request matches any bypass patterns
  const shouldBypass = BYPASS_URL_PATTERNS.some((pattern) => pattern.test(url.pathname));
  if (shouldBypass) {
    // Network-only without caching
    return;
  }

  // For static assets: Stale-While-Revalidate strategy
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);

      // Fetch from network in parallel to update cache
      const networkFetch = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        // Network failure, silently return null
        return null;
      });

      // Return cached version immediately if available, otherwise wait for network
      return cachedResponse || networkFetch;
    })
  );
});
