// ═══ Portal-zakazov — Service Worker ═══
// Версия кэша синхронизирована с APP_VERSION в index.html.
// При каждом обновлении index.html — бампать CACHE_NAME здесь тоже,
// иначе у пользователей останется закэшированная старая версия страницы.
var CACHE_NAME = 'portal-zakazov-v1.73';

var PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(PRECACHE_URLS).catch(function(){
        // Если один из ресурсов недоступен офлайн при первой установке — не блокируем install
        return Promise.resolve();
      });
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
            .map(function(key){ return caches.delete(key); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// Стратегия: network-first для index.html (чтобы обновления версии подхватывались сразу),
// cache-first с фоновым обновлением для остальных статических ресурсов.
self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;

  var url = new URL(req.url);
  var isNavigation = req.mode === 'navigate' || (url.pathname.endsWith('/') || url.pathname.endsWith('index.html'));

  if(isNavigation && url.origin === self.location.origin){
    event.respondWith(
      fetch(req).then(function(res){
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, resClone); });
        return res;
      }).catch(function(){
        return caches.match(req).then(function(cached){ return cached || caches.match('./index.html'); });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function(cached){
      var networkFetch = fetch(req).then(function(res){
        if(res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')){
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, resClone); });
        }
        return res;
      }).catch(function(){ return cached; });
      return cached || networkFetch;
    })
  );
});
