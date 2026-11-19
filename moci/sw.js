/* Haven service worker — installable PWA shell.
 * Security: NEVER cache /ubus RPC, /cgi-bin/, or any non-GET request (session
 * tokens and live router state must not hit disk). Only the static app shell is
 * cached, for offline launch. Assets carry ?v= cache-busters, so a new firmware
 * version fetches fresh URLs; navigation is network-first when online.
 */
const CACHE = 'haven-shell-v1';
const SHELL = ['./', './index.html', './app.css', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
	event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', event => {
	const req = event.request;
	const url = new URL(req.url);
	// Never cache RPC, CGI, or non-GET — network only.
	if (req.method !== 'GET' || url.pathname.startsWith('/ubus') || url.pathname.startsWith('/cgi-bin')) {
		return; // let the browser handle it normally (network)
	}
	if (url.origin !== self.location.origin) return;
	// Navigation: network-first, fall back to cached shell when offline.
	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req).then(res => {
				const copy = res.clone();
				caches.open(CACHE).then(c => c.put('./index.html', copy));
				return res;
			}).catch(() => caches.match('./index.html'))
		);
		return;
	}
	// Static assets: stale-while-revalidate.
	event.respondWith(
		caches.match(req).then(cached => {
			const network = fetch(req).then(res => {
				if (res && res.status === 200) {
					const copy = res.clone();
					caches.open(CACHE).then(c => c.put(req, copy));
				}
				return res;
			}).catch(() => cached);
			return cached || network;
		})
	);
});