/**
 * pages.js — 各页面渲染函数（今日/学习/复习/词书/词书详情/统计/设置）
 * M1 仅提供路由占位渲染，具体页面随里程碑实现（SPEC §5）。
 */

const PAGE_TITLES = {
  '/': '今日',
  '/study': '学习',
  '/review': '复习',
  '/books': '词书',
  '/stats': '统计',
  '/settings': '我的',
};

/**
 * 路由渲染入口（main.js 调用）。
 * @param {string} route hash 路由路径，如 '/'、'/books/3'
 * @param {HTMLElement} container #page 容器
 */
export function renderRoute(route, container) {
  const path = route.split('?')[0];
  const seg = path.split('/').filter(Boolean);

  let title = PAGE_TITLES[path];
  if (!title && seg[0] === 'books' && seg[1]) title = '词书详情';
  if (!title) title = '今日';

  container.innerHTML = `
    <h1 class="page-title">${title}</h1>
    <div class="empty-state">
      <div class="empty-icon">🚧</div>
      <p class="text-secondary">「${title}」页面将在后续里程碑实现</p>
    </div>
  `;
}
