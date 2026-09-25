// ═══ Мобильный каталог Kari — Service Worker ═══
// Лежит рядом с Mobile_Oborud_Kari_v2.html (папка «Mobile Vers») и управляет только этой папкой.
// При обновлении HTML бампать VERSION, чтобы телефоны гарантированно получили новую страницу.
var VERSION = 'kari-mobile-v3.7';
var STATIC_CACHE = VERSION + '-static';
var PHOTO_CACHE = 'kari-mobile-photos-v1';   // фото переживают обновления приложения
var PHOTO_LIMIT = 2500;                      // ≈ миниатюры 6 КБ + карточки 35 КБ — десятки МБ

var PRECACHE = [
  './Mobile_Oborud_Kari_v2.html',
  './Kari_animated_logo.gif'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(STATIC_CACHE).then(function (c) {
    return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      // трогаем только свои кэши — десктопный портал на том же домене хранит свои («portal-zakazov-*»)
      return k.indexOf('kari-mobile') === 0 && k !== STATIC_CACHE && k !== PHOTO_CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isPhoto(url) {
  return url.hostname === 'raw.githubusercontent.com' &&
         /\.(webp|png|jpe?g|gif)$/i.test(url.pathname);
}

function trimPhotos() {
  return caches.open(PHOTO_CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      var extra = keys.length - PHOTO_LIMIT;
      for (var i = 0; i < extra; i++) c.delete(keys[i]);   // самые старые — первыми
    });
  });
}

// Фото: из кэша, при промахе — из сети с сохранением.
// Картинки приходят как no-cors; перезапрашиваем в режиме CORS (raw.githubusercontent.com разрешает),
// чтобы ответ был «прозрачным» и не раздувал квоту хранилища.
function photoResponse(req, url) {
  return caches.open(PHOTO_CACHE).then(function (c) {
    return c.match(req.url).then(function (hit) {
      if (hit) return hit;
      return fetch(req.url, { mode: 'cors', credentials: 'omit' })
        .catch(function () { return fetch(req); })
        .then(function (resp) {
          // без ?v= (старый способ получения списка) — не кэшируем, файл мог измениться
          if (resp && resp.ok && resp.type !== 'opaque' && url.search.indexOf('v=') >= 0) {
            c.put(req.url, resp.clone()).then(trimPhotos);
          }
          return resp;
        });
    });
  });
}

// Сначала сеть, при ошибке — кэш (страница, xlsx, photos.json)
function networkFirst(req, cacheName) {
  return fetch(req).then(function (resp) {
    if (resp && resp.ok && resp.type !== 'opaque') {
      var copy = resp.clone();
      caches.open(cacheName).then(function (c) { c.put(req, copy); });
    }
    return resp;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./Mobile_Oborud_Kari_v2.html');
      return Response.error();
    });
  });
}

function cacheFirst(req, cacheName) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (resp) {
      if (resp && resp.ok && resp.type !== 'opaque') {
        var copy = resp.clone();
        caches.open(cacheName).then(function (c) { c.put(req, copy); });
      }
      return resp;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname === 'api.github.com') return;               // API — как есть, без кэша
  if (isPhoto(url)) { e.respondWith(photoResponse(req, url)); return; }
  if (url.hostname === 'raw.githubusercontent.com') { e.respondWith(networkFirst(req, STATIC_CACHE)); return; }
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req, STATIC_CACHE)); return; }
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(cacheFirst(req, STATIC_CACHE));
  }
});
