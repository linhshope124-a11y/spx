const CACHE = 'spx-tracker-v526';
const SHARE_CACHE = 'spx-shared-files';

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

// ==================== INSTALL ====================
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE))
    // KHÔNG skipWaiting ngay — chờ user bấm "Cập nhật"
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          // Giữ cache chính + cache share target
          .filter(k => k !== CACHE && k !== SHARE_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({
            type: 'SW_UPDATED',
            version: CACHE
          }));
        });
      })
  );
});

// ==================== MESSAGE ====================
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ==================== v50.11.0: SHARE TARGET (SPX-F) ====================
/**
 * Xử lý POST từ Share Target:
 *   1. Đọc formData → lấy File[] từ field "images"
 *   2. Lưu từng File + metadata vào Cache API 'spx-shared-files'
 *   3. Redirect 303 về ./index.html?shared=1
 *
 * main.js sẽ đọc cache này sau khi load.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const rawFiles = formData.getAll('images');

    // Lọc chỉ giữ những mục là File/Blob hợp lệ
    const files = rawFiles.filter(f =>
      f && typeof f === 'object' && typeof f.size === 'number' && f.size > 0
    );

    const cache = await caches.open(SHARE_CACHE);

    // Dọn cache cũ trước khi lưu mới (tránh lẫn lộn giữa các lần share)
    const oldKeys = await cache.keys();
    await Promise.all(oldKeys.map(k => cache.delete(k)));

    if (files.length > 0) {
      // 1) Metadata
      const meta = {
        count: files.length,
        names: files.map(f => f.name || `shared_${Date.now()}.jpg`),
        types: files.map(f => f.type || 'image/jpeg'),
        savedAt: Date.now()
      };

      await cache.put(
        new Request('./spx-shared-meta'),
        new Response(JSON.stringify(meta), {
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // 2) Từng file theo thứ tự
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await cache.put(
          new Request(`./spx-shared-file-${i}`),
          new Response(file, {
            headers: { 'Content-Type': file.type || 'image/jpeg' }
          })
        );
      }

      console.log(`[SW] Share target: đã lưu ${files.length} file vào cache`);
    } else {
      console.warn('[SW] Share target: không có file hợp lệ');
    }
  } catch (e) {
    // Vẫn redirect — app sẽ show fallback alert
    console.warn('[SW] Share target error:', e);
  }

  // 3) Redirect về index.html với cờ ?shared=1
  const redirectUrl = new URL('index.html?shared=1', self.registration.scope).href;
  return Response.redirect(redirectUrl, 303);
}
// ==================== /SHARE TARGET ====================

// ==================== FETCH ====================
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // ---------- v50.11.0: POST /share-target ----------
  if (req.method === 'POST') {
    if (url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
      e.respondWith(handleShareTarget(req));
      return;
    }
    // POST khác (API Github, analytics, ...) → không can thiệp
    return;
  }

  // ---------- Các method khác (PUT/DELETE/...) → bỏ qua ----------
  if (req.method !== 'GET') return;

  // ---------- Chỉ xử lý request same-origin ----------
  if (url.origin !== self.location.origin) return;

  // ---------- version.json → luôn fetch network (không cache) ----------
  if (url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  // ---------- Network-first + fallback cache ----------
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