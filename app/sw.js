/**
 * sw.js — Service Worker，cache-first（SPEC §7）
 * 缓存版本号与 main.js 的 APP_VERSION 同步，发版一并修改。
 */

const APP_VERSION = 'v2.0.0';
const CACHE_NAME = `wordmaster-${APP_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/db.js',
  './js/importer.js',
  './js/scheduler.js',
  './js/gamification.js',
  './js/morph.js',
  './js/speech.js',
  './js/pages.js',
  './data/roots.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// cache-first：命中缓存直接返回，未命中走网络并写入缓存
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp && resp.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      });
    }),
  );
});
