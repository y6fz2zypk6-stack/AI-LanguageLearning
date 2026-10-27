/* このファイルはテンプレート。ビルド時に scripts/build.mjs が差し込み位置を埋めて dist/sw.js を作る。
   会話データ（/api）はキャッシュしない — サーバーが唯一の正 */

const VERSION = '__VERSION__';
const CACHE = `langpartner-${VERSION}`;

/** install の時点で取りに行くもの（アプリの起動に要る一式） */
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // ナビゲーションはネットワーク優先（新しいビルドの index.html を掴むため）
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // 静的アセットはキャッシュ優先。ファイル名にハッシュが入っているので中身は変わらない
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && url.pathname.startsWith('/assets/')) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    }),
  );
});
