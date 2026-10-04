const CACHE = 'spx-tracker-v520';
const CORE = [
  './',
  './index.html',
  './guide.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/utils.js',
  './js/state.js',
  './js/calc.js',
  './js/theme.js',
  './js/ocr.js',
  './js/ui.js',
  './js/render.js',
  './js/entry.js',
  './js/backup.js',
  './js/cloud.js',
  './js/undo.js',
  './js/dialog.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE))
    // KHÔNG skipWaiting ngay — chờ user bấm "Cập nhật"
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Thông báo tất cả client → reload để dùng bản mới
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({
            type: 'SW_UPDATED',
            version: CACHE
          }));
        });
      })
  );
});

// Nhận lệnh skipWaiting từ client
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // KHÔNG cache version.json — luôn fetch mới từ network
  if (url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});