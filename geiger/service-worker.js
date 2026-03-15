// Service Worker for Offline Support
const CACHE_VERSION = 'v3';
const CACHE_NAME = `geiger-counter-${CACHE_VERSION}`;

// Files to cache on installation
const URLS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// Installation event - cache files
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching app files');
                // Try to cache all files, but don't fail if some are missing
                return Promise.all(
                    URLS_TO_CACHE.map((url) => {
                        return cache.add(url).catch((err) => {
                            console.warn(`Failed to cache ${url}:`, err);
                        });
                    })
                );
            })
            .then(() => {
                console.log('All cacheable files have been processed');
                return self.skipWaiting();
            })
    );
});

// Activation event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName !== CACHE_NAME)
                    .map((cacheName) => {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    })
            );
        }).then(() => {
            console.log('Service Worker ready');
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const { method } = request;

    // Only handle GET requests
    if (method !== 'GET') {
        return;
    }

    // For navigation requests, try network first, then cache
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache successful responses
                    if (response && response.status === 200 && response.type !== 'error') {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fall back to cached version if network fails
                    return caches.match(request)
                        .then((response) => {
                            return response || caches.match('/index.html');
                        });
                })
        );
        return;
    }

    // For other requests, use cache-first strategy
    event.respondWith(
        caches.match(request)
            .then((response) => {
                if (response) {
                    return response;
                }

                return fetch(request)
                    .then((response) => {
                        // Don't cache non-successful or non-OK responses
                        if (!response || response.status !== 200 || response.type === 'error') {
                            return response;
                        }

                        // Clone and cache the response
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });

                        return response;
                    })
                    .catch(() => {
                        // Return offline page or error response
                        console.warn('Fetch failed and no cache available for:', request.url);
                    });
            })
    );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
    console.log('Service Worker received message:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
