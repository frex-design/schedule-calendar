// FRe:x Schedule — Service Worker
// キャッシュ戦略:
//   静的アセット（同一オリジン・CDN）→ Cache First + バックグラウンド更新
//   API・動的リクエスト          → Network First（従来通り）

const CACHE_NAME = 'frex-schedule-v36';
const STATIC_ASSETS = [
  '/schedule-calendar/',
  '/schedule-calendar/index.html',
  '/schedule-calendar/style.css',
  '/schedule-calendar/app.js',
  '/schedule-calendar/manifest.json',
  '/schedule-calendar/icons/icon-192.png',
  '/schedule-calendar/icons/icon-512.png',
];

/** 静的ファイルパス判定 */
const isStaticPath = (url) =>
  STATIC_ASSETS.some(p => url.pathname === p) ||
  url.pathname.startsWith('/schedule-calendar/icons/');

/** キャッシュ対象の外部CDN判定（バージョン固定済みのため安全） */
const isCdnAsset = (url) =>
  url.hostname === 'cdn.jsdelivr.net' ||
  url.hostname === 'fonts.googleapis.com' ||
  url.hostname === 'fonts.gstatic.com';

/** キャッシュしてはいけないホスト（API・動的コンテンツ） */
const isSkipped = (url) =>
  url.hostname.includes('supabase.co') ||
  url.hostname.includes('qrserver.com') ||
  url.hostname.includes('jma.go.jp') ||
  url.hostname.includes('openweathermap') ||
  url.hostname.includes('weather.yahoo');

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

// フェッチ処理
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API・動的リクエストはSWを素通り
  if (isSkipped(url)) return;

  // GET以外はスキップ
  if (event.request.method !== 'GET') return;

  // ── Cache First + Stale While Revalidate（静的ファイル・固定バージョンCDN）──
  // キャッシュから即返しつつ、バックグラウンドで最新版を取得してキャッシュ更新
  if (isStaticPath(url) || isCdnAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);

        // バックグラウンドで最新版をフェッチしてキャッシュ更新
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // キャッシュがあれば即返す（Stale While Revalidate）
        return cached || await fetchPromise;
      })
    );
    return;
  }

  // ── Network First → キャッシュフォールバック（その他リクエスト）──
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/schedule-calendar/index.html');
          }
        });
      })
  );
});
