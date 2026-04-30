// FRe:x Schedule — Service Worker
// キャッシュ戦略: Network First（常に最新データを優先）

const CACHE_NAME = 'frex-schedule-v1';
const STATIC_ASSETS = [
  '/schedule-calendar/',
  '/schedule-calendar/index.html',
  '/schedule-calendar/style.css',
  '/schedule-calendar/app.js',
  '/schedule-calendar/manifest.json',
  '/schedule-calendar/icons/icon-192.png',
  '/schedule-calendar/icons/icon-512.png',
];

// インストール: 静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ: Network First → キャッシュフォールバック
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase API・外部リクエストはキャッシュしない
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('qrserver.com') ||
    url.hostname.includes('openweathermap') ||
    url.hostname.includes('weather.yahoo') ||
    url.hostname.includes('jma.go.jp') ||
    url.hostname.includes('unpkg.com')
  ) {
    return;
  }

  // GET以外はスキップ
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 正常レスポンスをキャッシュに保存
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // HTMLのフォールバック
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/schedule-calendar/index.html');
          }
        });
      })
  );
});
