/* 한빛은혜교회 - 앱 설치/오프라인용 서비스 워커
 * 항상 인터넷에서 최신 파일을 먼저 받아 오고(그래서 고친 내용이 바로 반영됨),
 * 인터넷이 안 될 때만 저장해 둔 파일로 화면을 보여 줍니다.
 * 구글시트 데이터(다른 주소)는 건드리지 않습니다. */
var CACHE = 'hanbit-v1';
var CORE = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'data-sample.js', 'manifest.json',
  'assets/logo.webp', 'assets/icons/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () { }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin) return;   // 구글 서버 등 다른 주소는 그대로 통과
  e.respondWith(
    fetch(new Request(r, { cache: 'no-cache' })).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(r).then(function (m) { return m || caches.match('./') || caches.match('index.html'); });
    })
  );
});
