/**
 * main.js — 入口、hash 路由、页面切换
 * 导出 APP_VERSION 常量（sw.js 缓存版本号与之同步，发版一并修改）
 */
import { renderRoute } from './pages.js';

export const APP_VERSION = 'v2.0.0';

function currentRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  return hash.startsWith('/') ? hash : '/' + hash;
}

function highlightTab(route) {
  // 词书详情 #/books/:id 归入 #/books
  const base = '/' + (route.split('/')[1] || '');
  document.querySelectorAll('.tabbar-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.route === base);
  });
}

function router() {
  const route = currentRoute();
  const page = document.getElementById('page');
  if (!page) return;
  renderRoute(route, page);
  highlightTab(route);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', router);
  window.addEventListener('DOMContentLoaded', () => {
    router();
    // PWA：注册 Service Worker（不支持时静默降级）
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });
}
