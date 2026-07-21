/**
 * pages.js — 各页面渲染函数（SPEC §5）
 * M2 实现：今日（基础版）/ 学习 / 复习 / 词书（基础版 + 临时导入入口）。
 * 词书详情 M5、统计 M3、设置 M4 仍为占位。
 * 学习与复习共用本文件「测验会话」区（§4.1 题型 1/2；题型 3 听音辨词 M6 在此扩展）。
 */

import {
  getAll, getAllByIndex, add, del, bulkAdd, bulkPut, getSetting, setSetting,
  clear, STORE_NAMES,
} from './db.js';
import {
  getTodayTask, markLearned, recordAnswer, bumpCheckin, createProgress,
  getStreak, todayStr, shiftDay, isActiveCheckin, MASTERED_STAGE,
} from './scheduler.js';
import {
  XP_RULES, BADGES, levelForXP, awardXP, awardDailyDone, awardStreakMilestone, checkBadges,
} from './gamification.js';
import { speak } from './speech.js';
import { parseImportText } from './importer.js';
import { APP_VERSION } from './main.js';

/** HTML 转义（词书内容来自用户导入，必须转义后插入 DOM） */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 路由渲染入口（main.js 调用，异步）。
 * @param {string} route hash 路由路径，如 '/'、'/books/3'
 * @param {HTMLElement} container #page 容器
 */
export async function renderRoute(route, container) {
  const path = route.split('?')[0];
  const seg = path.split('/').filter(Boolean);

  if (path === '/') return renderToday(container);
  if (path === '/study') return renderStudy(container);
  if (path === '/review') return renderReview(container);
  if (path === '/books') return renderBooks(container);
  if (seg[0] === 'books' && seg[1]) {
    return renderPlaceholder(container, '词书详情', '词书详情页（分组/搜索/状态标记）将于 M5 实现');
  }
  if (path === '/stats') return renderStats(container);
  if (path === '/settings') return renderSettings(container);
  return renderToday(container);
}

function renderPlaceholder(container, title, note) {
  container.innerHTML = `
    <h1 class="page-title">${title}</h1>
    <div class="empty-state">
      <div class="empty-icon">🚧</div>
      <p class="text-secondary">${note}</p>
    </div>
  `;
}

/** 取当前词书：activeBookId 失效时回退到第一本并写回设置；无词书返回 null */
async function getActiveBook() {
  const activeId = await getSetting('activeBookId');
  const books = await getAll('books');
  let book = activeId != null ? books.find((b) => b.id === activeId) : null;
  if (!book) {
    book = books[0] || null;
    if (book) await setSetting('activeBookId', book.id);
  }
  return book;
}

function renderNoBook(container, title) {
  container.innerHTML = `
    <h1 class="page-title">${title}</h1>
    <div class="empty-state">
      <div class="empty-icon">📚</div>
      <p>还没有词书，先去导入一本吧</p>
      <a class="btn btn-primary" href="#/books">去导入词书</a>
    </div>
  `;
}

/* ==================== 今日页（M2 基础版；M3 打卡、M4 XP/等级/streak 在此增强，§6） ==================== */

async function renderToday(container) {
  const book = await getActiveBook();
  if (!book) {
    renderNoBook(container, '今日');
    return;
  }
  const [task, streak, xp] = await Promise.all([
    getTodayTask(book.id),
    getStreak(),
    getSetting('xp', 0),
  ]);
  const lv = levelForXP(xp);
  const xpPct = Math.round(lv.progress * 100);
  container.innerHTML = `
    <div class="home-header">
      <div class="home-topline">
        <span class="level-title">Lv.${lv.level} ${lv.title}</span>
        <span class="streak-flame" title="连续打卡">🔥 ${streak} 天</span>
      </div>
      <div class="xp-bar"><div class="xp-bar-fill" style="width:${xpPct}%"></div></div>
      <div class="xp-text">${xp} XP${lv.next != null ? ` · 距下一级还需 ${lv.next - xp}` : ' · 已满级'}</div>
      <div class="home-sub">当前词书</div>
      <div class="home-book">${escapeHtml(book.name)}</div>
    </div>
    <div class="card">
      <p class="task-counts">今日任务：<strong>新学 ${task.newWords.length}</strong> 词 · <strong>复习 ${task.reviews.length}</strong> 词</p>
    </div>
    <div class="btn-stack">
      <a class="btn btn-primary btn-block" href="#/study">开始新学（${task.newWords.length}）</a>
      <a class="btn btn-outline btn-block" href="#/review">开始复习（${task.reviews.length}）</a>
    </div>
  `;
}

/* ==================== 激励反馈（M4，§4.3） ==================== */

/** 加 XP；升级时弹出全屏祝贺层 1.5 秒（§4.3-A） */
async function gainXP(amount) {
  const r = await awardXP(amount);
  if (r && r.leveledUp) showLevelUp(r.to);
  return r;
}

/** 徽章检查并弹出新解锁提示（答题结算 / 打卡写入后调用，§4.3-B） */
async function notifyBadges() {
  try {
    const fresh = await checkBadges();
    for (const b of fresh) showBadgeToast(b);
    return fresh;
  } catch {
    return []; // 激励模块失败不影响学习主流程
  }
}

/** 升级全屏祝贺层：称号缩放弹入，1.5 秒自动消失（§4.3-A、§6） */
function showLevelUp(level) {
  const overlay = document.createElement('div');
  overlay.className = 'levelup-overlay';
  overlay.innerHTML = `
    <div class="levelup-card">
      <div class="levelup-emoji">🎊</div>
      <div class="levelup-title">升级啦！</div>
      <div class="levelup-level">Lv.${level.level} ${level.title}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1500);
}

/** 新解锁徽章 toast（§4.3-B） */
function showBadgeToast(badge) {
  const toast = document.createElement('div');
  toast.className = 'badge-toast';
  toast.textContent = `${badge.emoji} 解锁徽章：${badge.name}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

/* ==================== 测验会话（学习/复习共用） ==================== */

/** 顶部细进度条 + 计数（§5：第 N/M 题） */
function progressHtml(index, total) {
  const pct = Math.round(((index - 1) / total) * 100);
  return `
    <div class="quiz-progress"><div class="quiz-progress-fill" style="width:${pct}%"></div></div>
    <div class="quiz-count">第 ${index}/${total} 题</div>
  `;
}

/**
 * 渲染一道测验题：§4.1 题型 1「看词选义」/ 题型 2「看义拼词」随机（M2 仅这两种）。
 * 即时反馈按 §4.3-C：答对绿 + 轻微放大 200ms；答错红抖动 + 展示正确答案 2 秒。
 * @returns {Promise<boolean>} 是否答对
 */
function askQuiz(container, { word, pool, index, total }) {
  const type = Math.random() < 0.5 ? 1 : 2;
  return type === 1
    ? askChoice(container, word, pool, index, total)
    : askSpelling(container, word, index, total);
}

/** 干扰项：同词书其他词的释义，去重且不含正确释义（§4.1-1；不足 3 个时有几条算几条） */
function pickDistractors(word, pool, n) {
  const seen = new Set([word.meaning]);
  const out = [];
  for (const w of shuffle(pool.filter((x) => x.id !== word.id))) {
    if (seen.has(w.meaning)) continue;
    seen.add(w.meaning);
    out.push(w.meaning);
    if (out.length >= n) break;
  }
  return out;
}

/** 题型 1：看词选义（单词可点击发音） */
function askChoice(container, word, pool, index, total) {
  return new Promise((resolve) => {
    const options = shuffle([word.meaning, ...pickDistractors(word, pool, 3)]);
    container.innerHTML = `
      ${progressHtml(index + 1, total)}
      <div class="card study-card">
        <div class="study-word quiz-word" id="quizWord" title="点击发音">${escapeHtml(word.word)}</div>
        <button class="pronounce-btn" id="quizSpeak" type="button" aria-label="发音">🔊</button>
        <p class="text-secondary">选择正确释义</p>
      </div>
      <div>
        ${options.map((m) => `<button class="option-btn" type="button" data-m="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')}
      </div>
    `;
    const say = () => speak(word.word);
    container.querySelector('#quizWord').addEventListener('click', say);
    container.querySelector('#quizSpeak').addEventListener('click', say);
    const buttons = [...container.querySelectorAll('.option-btn')];
    let done = false;
    for (const btn of buttons) {
      btn.addEventListener('click', async () => {
        if (done) return;
        done = true;
        const correct = btn.dataset.m === word.meaning;
        if (correct) {
          btn.classList.add('correct');
          await wait(500);
        } else {
          btn.classList.add('wrong');
          const right = buttons.find((b) => b.dataset.m === word.meaning);
          if (right) right.classList.add('correct');
          await wait(2000); // 答错展示正确答案 2 秒（§5）
        }
        resolve(correct);
      });
    }
  });
}

/** 题型 2：看义拼词（忽略大小写与首尾空格；多词短语整串比较，§4.1-2） */
function askSpelling(container, word, index, total) {
  return new Promise((resolve) => {
    container.innerHTML = `
      ${progressHtml(index + 1, total)}
      <div class="card">
        <div class="quiz-meaning">${escapeHtml(word.meaning)}</div>
        ${word.pos ? `<p class="text-secondary quiz-pos">${escapeHtml(word.pos)}</p>` : ''}
      </div>
      <input class="spell-input" id="spellInput" type="text" placeholder="输入英文拼写"
             autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button class="btn btn-primary btn-block" id="spellSubmit" type="button">确定</button>
      <div id="spellFeedback" class="quiz-feedback"></div>
    `;
    const input = container.querySelector('#spellInput');
    const submitBtn = container.querySelector('#spellSubmit');
    const feedback = container.querySelector('#spellFeedback');
    input.focus();
    let done = false;
    const submit = async () => {
      if (done) return;
      done = true;
      const answer = input.value.trim();
      const correct = answer.toLowerCase() === word.word.trim().toLowerCase();
      input.disabled = true;
      submitBtn.disabled = true;
      if (correct) {
        feedback.innerHTML = `<div class="option-btn correct">✓ 回答正确：${escapeHtml(word.word)}</div>`;
        await wait(500);
      } else {
        feedback.innerHTML = `
          <div class="option-btn wrong">✗ 你的答案：${escapeHtml(answer) || '（空）'}</div>
          <div class="option-btn correct">正确答案：${escapeHtml(word.word)}</div>
        `;
        await wait(2000); // 答错展示正确答案 2 秒（§5）
      }
      resolve(correct);
    };
    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { // Enter 提交（§4.1-2）
      if (e.key === 'Enter') submit();
    });
  });
}

/* ==================== 学习页（§5 #/study） ==================== */

async function renderStudy(container) {
  const book = await getActiveBook();
  if (!book) {
    renderNoBook(container, '学习');
    return;
  }
  const [task, allWords, autoSpeak] = await Promise.all([
    getTodayTask(book.id),
    getAllByIndex('words', 'bookId', book.id),
    getSetting('autoSpeak', true),
  ]);
  const queue = task.newWords;
  if (queue.length === 0) {
    container.innerHTML = `
      <h1 class="page-title">学习</h1>
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <p>今日新学任务已完成</p>
        <a class="btn btn-primary" href="#/">返回今日</a>
      </div>
    `;
    return;
  }
  await runStudySession(container, queue, allWords, autoSpeak);
}

/** 学习卡：单词 34px 居中 + 词性胶囊 + 释义 + 发音按钮；进入自动发音一次（受 autoSpeak 开关控制） */
function showStudyCard(container, word, index, total, autoSpeak) {
  return new Promise((resolve) => {
    container.innerHTML = `
      ${progressHtml(index + 1, total)}
      <div class="card study-card">
        <div class="study-word">${escapeHtml(word.word)}</div>
        ${word.pos ? `<div class="study-pos"><span class="pos-tag">${escapeHtml(word.pos)}</span></div>` : ''}
        <div class="study-meaning">${escapeHtml(word.meaning)}</div>
        <!-- M6：词根词缀拆解展示位（§4.4） -->
        <button class="pronounce-btn" id="cardSpeak" type="button" aria-label="发音">🔊</button>
      </div>
      <button class="btn btn-primary btn-block" id="cardGot" type="button">我记住了</button>
    `;
    container.querySelector('#cardSpeak').addEventListener('click', () => speak(word.word));
    container.querySelector('#cardGot').addEventListener('click', () => resolve(), { once: true });
    if (autoSpeak) speak(word.word); // 失败静默（speech.js 内部已兜底，§5 通用交互）
  });
}

async function runStudySession(container, queue, allWords, autoSpeak) {
  const total = queue.length;
  for (let i = 0; i < queue.length; i++) {
    if (!container.isConnected) return; // 用户中途切换页面，放弃本次会话
    const word = queue[i];
    await showStudyCard(container, word, i, total, autoSpeak);
    // 「我记住了」→ 立即测验一题（§5）
    let ok = await askQuiz(container, { word, pool: allWords, index: i, total });
    if (!ok && container.isConnected) {
      // 首次答错已展示正确答案 2 秒（askQuiz 内），同一词再测一次
      ok = await askQuiz(container, { word, pool: allWords, index: i, total });
    }
    // M2 决策：第二次仍未通过也记为已学——markLearned 后该词即进入 10 分钟复习循环（§3），很快会再见面
    await markLearned(word.id, Date.now());
    // checkins 只记 newLearned；学习测验的对错不计入 correct/wrong（M3 统计正确率以复习答题为准）
    await bumpCheckin('newLearned', 1);
    if (ok) await gainXP(XP_RULES.learnNew); // 新学一词并通过测验 +10（§4.3-A）
    await notifyBadges();
  }
  if (!container.isConnected) return;
  if (await celebrateIfDone(container)) return; // 今日任务全部完成 → 彩带 + 打卡成功
  container.innerHTML = `
    <h1 class="page-title">学习</h1>
    <div class="card study-card">
      <div class="empty-icon">🎉</div>
      <p class="session-done">新学完成，共 ${total} 词。它们将在 10 分钟后进入复习队列。</p>
      <a class="btn btn-primary btn-block" href="#/">返回今日</a>
    </div>
  `;
}

/* ==================== 复习页（§5 #/review） ==================== */

async function renderReview(container) {
  const book = await getActiveBook();
  if (!book) {
    renderNoBook(container, '复习');
    return;
  }
  const [task, allWords] = await Promise.all([
    getTodayTask(book.id),
    getAllByIndex('words', 'bookId', book.id),
  ]);
  const queue = task.reviews;
  if (queue.length === 0) {
    container.innerHTML = `
      <h1 class="page-title">复习</h1>
      <div class="empty-state">
        <div class="empty-icon">✨</div>
        <p>今日暂无到期复习</p>
        <a class="btn btn-primary" href="#/">返回今日</a>
      </div>
    `;
    return;
  }
  await runReviewSession(container, queue, allWords);
}

async function runReviewSession(container, queue, allWords) {
  const total = queue.length;
  for (let i = 0; i < queue.length; i++) {
    if (!container.isConnected) return;
    const word = queue[i];
    const ok = await askQuiz(container, { word, pool: allWords, index: i, total });
    await recordAnswer(word.id, ok, Date.now());
    await bumpCheckin('reviewed', 1);
    await bumpCheckin(ok ? 'correct' : 'wrong', 1);
    await gainXP(ok ? XP_RULES.reviewRight : XP_RULES.reviewWrong); // 复习答对 +5 / 答错鼓励 +1
    await notifyBadges();
  }
  if (!container.isConnected) return;
  // 队列清空 → 若今日任务全部完成则触发打卡庆祝（§4.3-C），否则回今日页（§5）
  if (await celebrateIfDone(container)) return;
  container.innerHTML = `
    <h1 class="page-title">复习</h1>
    <div class="card study-card">
      <div class="empty-icon">✅</div>
      <p class="session-done">本次复习完成，共 ${total} 词</p>
      <a class="btn btn-primary btn-block" href="#/">返回今日</a>
    </div>
  `;
  setTimeout(() => {
    if (container.isConnected) location.hash = '#/';
  }, 1500);
}

/* ==================== 打卡庆祝（M3，§3 / §4.3-C） ==================== */

/**
 * 会话结束后检查今日任务：新学与到期复习均清空 → 完成当日任务奖励（§4.3-A）
 * + 全屏彩带 + 「打卡成功」卡（§4.3-C）。
 * @returns {Promise<boolean>} 是否已展示庆祝层
 */
async function celebrateIfDone(container) {
  const book = await getActiveBook();
  if (!book) return false;
  const task = await getTodayTask(book.id);
  if (task.newWords.length > 0 || task.reviews.length > 0) return false;
  // 完成当日全部任务 +20（每日一次）；连续打卡每满 7 天 +50（每档一次）
  const done = await awardDailyDone().catch(() => null);
  if (done && done.leveledUp) showLevelUp(done.to);
  const streak = await getStreak();
  const milestone = await awardStreakMilestone(streak).catch(() => null);
  if (milestone && milestone.leveledUp) showLevelUp(milestone.to);
  const fresh = await notifyBadges();
  showCheckinCelebration(container, fresh);
  return true;
}

/** 全屏彩带动画（纯 CSS 实现，不引库，§4.3-C）+ 「打卡成功」卡（附新解锁徽章） */
function showCheckinCelebration(container, freshBadges = []) {
  const colors = ['#0d9488', '#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#ec4899'];
  const pieces = Array.from({ length: 60 }, (_, i) => {
    const left = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 0.8).toFixed(2);
    const duration = (2.2 + Math.random() * 1.6).toFixed(2);
    const color = colors[i % colors.length];
    const w = 6 + Math.round(Math.random() * 6);
    const h = w + 4 + Math.round(Math.random() * 6);
    return `<span class="confetti-piece" style="left:${left}%;width:${w}px;height:${h}px;background:${color};animation-delay:${delay}s;animation-duration:${duration}s"></span>`;
  }).join('');
  container.innerHTML = `
    <div class="celebration">
      <div class="confetti" aria-hidden="true">${pieces}</div>
      <div class="card checkin-card">
        <div class="empty-icon">🎉</div>
        <h2 class="checkin-title">打卡成功</h2>
        <p class="text-secondary">今日任务已全部完成，明天也要继续哦</p>
        ${freshBadges.map((b) => `<div class="checkin-badge">${b.emoji} 解锁徽章：${escapeHtml(b.name)}</div>`).join('')}
        <a class="btn btn-primary btn-block" href="#/">返回今日</a>
      </div>
    </div>
  `;
}

/* ==================== 统计页（M3：打卡日历 / 累计学习 / 掌握 / 今日正确率；徽章墙 M4、错词本 M6 追加） ==================== */

async function renderStats(container) {
  const [checkins, progressAll, streak, unlocked] = await Promise.all([
    getAll('checkins'),
    getAll('progress'),
    getStreak(),
    getAll('badges'),
  ]);
  const learned = progressAll.filter((p) => !p.isNew).length;
  const mastered = progressAll.filter((p) => p.stage >= MASTERED_STAGE).length;
  const todayRow = checkins.find((c) => c.date === todayStr());
  const answered = todayRow ? todayRow.correct + todayRow.wrong : 0;
  const accuracy = answered > 0 ? Math.round((todayRow.correct / answered) * 100) : null;

  // 打卡日历：近 30 天，有学习/复习活动的日期高亮（§5）
  const activeDates = new Set(checkins.filter(isActiveCheckin).map((c) => c.date));
  const today = todayStr();
  const calHtml = Array.from({ length: 30 }, (_, i) => {
    const d = shiftDay(today, i - 29);
    const cls = ['cal-day'];
    if (activeDates.has(d)) cls.push('active');
    if (d === today) cls.push('today');
    return `<div class="${cls.join(' ')}" title="${d}">${Number(d.slice(8))}</div>`;
  }).join('');

  const stat = (num, label) => `
    <div class="card stat-card">
      <div class="stat-num">${num}</div>
      <div class="stat-label">${label}</div>
    </div>`;

  // 徽章墙：未解锁灰色 + 条件说明（§4.3-B）
  const unlockedIds = new Set(unlocked.map((b) => b.badgeId));
  const badgeWall = BADGES.map((b) => {
    const has = unlockedIds.has(b.id);
    return `
      <div class="badge ${has ? 'unlocked' : 'locked'}" title="${escapeHtml(b.desc)}">
        <div class="badge-emoji">${b.emoji}</div>
        <div class="badge-name">${escapeHtml(b.name)}</div>
        <div class="badge-desc">${escapeHtml(b.desc)}</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <h1 class="page-title">统计</h1>
    <div class="card">
      <h2 class="card-title">打卡日历（近 30 天）</h2>
      <div class="cal-grid">${calHtml}</div>
    </div>
    <div class="stat-grid">
      ${stat(`🔥 ${streak}`, '连续打卡（天）')}
      ${stat(learned, '累计学习（词）')}
      ${stat(mastered, '已掌握（词）')}
      ${stat(accuracy == null ? '—' : `${accuracy}%`, '今日正确率')}
    </div>
    <div class="card">
      <h2 class="card-title">徽章墙</h2>
      <div class="badge-grid">${badgeWall}</div>
    </div>
    <!-- M6：错词本（§4.6） -->
  `;
}

/* ==================== 词书页（M4：列表 + 掌握进度环 + 设为当前 + 删除；导入已移入设置页 §8-2；详情 M5） ==================== */

/** 环形进度（SVG circle stroke-dasharray，§6） */
function ringHtml(pct, size = 44) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, pct)));
  return `
    <svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="掌握进度 ${Math.round(pct * 100)}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#e5e7eb" stroke-width="5" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--color-primary)" stroke-width="5" fill="none"
              stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
              transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" class="ring-text">${Math.round(pct * 100)}%</text>
    </svg>`;
}

/** 各词书掌握率：Map(bookId → 0..1) */
async function getBookRates() {
  const [words, progressAll] = await Promise.all([getAll('words'), getAll('progress')]);
  const mastered = new Set(progressAll.filter((p) => p.stage >= MASTERED_STAGE).map((p) => p.wordId));
  const total = new Map();
  const done = new Map();
  for (const w of words) {
    total.set(w.bookId, (total.get(w.bookId) || 0) + 1);
    if (mastered.has(w.id)) done.set(w.bookId, (done.get(w.bookId) || 0) + 1);
  }
  const rates = new Map();
  for (const [bookId, n] of total) {
    rates.set(bookId, n > 0 ? (done.get(bookId) || 0) / n : 0);
  }
  return rates;
}

async function renderBooks(container, notice = '') {
  const [books, activeBookId, rates] = await Promise.all([
    getAll('books'),
    getSetting('activeBookId'),
    getBookRates(),
  ]);
  const listHtml = books.length === 0
    ? `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <p>还没有词书，先去导入一本吧</p>
        <a class="btn btn-primary" href="#/settings">去导入</a>
      </div>
    `
    : books.map((b) => `
      <div class="card book-card">
        <div class="book-ring">${ringHtml(rates.get(b.id) || 0)}</div>
        <div class="book-info">
          <div><strong>${escapeHtml(b.name)}</strong></div>
          <div class="book-meta">
            ${b.wordCount} 词 · 来源：${b.source === 'builtin' ? '内置' : '导入'}${b.id === activeBookId ? ' · <span class="book-active">当前词书</span>' : ''}
          </div>
          <div class="book-actions">
            ${b.id === activeBookId ? '' : `<button class="btn btn-outline btn-sm" type="button" data-act="use" data-id="${b.id}">设为当前词书</button>`}
            <button class="btn btn-outline btn-sm" type="button" data-act="detail" data-id="${b.id}">详情</button>
            <button class="btn btn-danger btn-sm" type="button" data-act="del" data-id="${b.id}">删除</button>
          </div>
        </div>
      </div>
    `).join('');

  container.innerHTML = `
    <h1 class="page-title">词书</h1>
    ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
    ${listHtml}
    ${books.length > 0 ? '<p class="text-secondary import-goto">要导入新词书？请到 <a href="#/settings">我的 → 词书管理</a></p>' : ''}
  `;

  container.querySelectorAll('[data-act="use"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await setSetting('activeBookId', Number(btn.dataset.id));
      await renderBooks(container, '已切换当前词书');
    });
  });
  container.querySelectorAll('[data-act="detail"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = `#/books/${btn.dataset.id}`;
    });
  });
  container.querySelectorAll('[data-act="del"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const book = books.find((b) => b.id === id);
      if (!window.confirm(`确定删除词书「${book ? book.name : id}」？其单词与学习进度将一并删除。`)) return;
      await deleteBook(id, activeBookId);
      await renderBooks(container, '词书已删除');
    });
  });
}

/** 导入写库：books + words（bulkAdd）+ 初始化 progress（bulkPut，isNew=true） */
async function importBook(result) {
  const now = Date.now();
  const bookId = await add('books', {
    name: result.name,
    source: 'import',
    createdAt: now,
    wordCount: result.success,
  });
  await bulkAdd('words', result.words.map((w) => ({
    bookId,
    word: w.word,
    pos: w.pos,
    meaning: w.meaning,
    grade: w.grade,
    seq: w.seq,
  })));
  // bulkAdd 不回自增 id，重读一次拿到 wordId 再初始化进度
  const saved = await getAllByIndex('words', 'bookId', bookId);
  await bulkPut('progress', saved.map((w) => createProgress(w.id, now)));
  // 首本词书自动设为当前词书
  if ((await getSetting('activeBookId')) == null) {
    await setSetting('activeBookId', bookId);
  }
  return bookId;
}

/** 删除词书：连带其单词与对应进度；若为当前词书则清空 activeBookId */
async function deleteBook(bookId, activeBookId) {
  const words = await getAllByIndex('words', 'bookId', bookId);
  await Promise.all(words.flatMap((w) => [del('words', w.id), del('progress', w.id)]));
  await del('books', bookId);
  if (activeBookId === bookId) await setSetting('activeBookId', null);
}

/* ==================== 设置页（M4，§5 #/settings 四个分组） ==================== */

async function renderSettings(container, notice = '') {
  const [dailyNew, dailyReviewCap, autoSpeak, voice, books, wordTotal] = await Promise.all([
    getSetting('dailyNew', 20),
    getSetting('dailyReviewCap', 100),
    getSetting('autoSpeak', true),
    getSetting('voice', 'en-US'),
    getAll('books'),
    getAll('words').then((ws) => ws.length),
  ]);

  container.innerHTML = `
    <h1 class="page-title">我的</h1>
    ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}

    <div class="card">
      <h2 class="card-title">学习设置</h2>
      <div class="setting-row">
        <label for="setDailyNew">每日新学数量（5–50）</label>
        <input id="setDailyNew" class="setting-num" type="number" min="5" max="50" value="${dailyNew}">
      </div>
      <div class="setting-row">
        <label for="setDailyReviewCap">每日复习上限（20–300）</label>
        <input id="setDailyReviewCap" class="setting-num" type="number" min="20" max="300" value="${dailyReviewCap}">
      </div>
      <div class="setting-row">
        <label for="setAutoSpeak">学习卡自动发音</label>
        <input id="setAutoSpeak" type="checkbox" ${autoSpeak ? 'checked' : ''}>
      </div>
      <div class="setting-row">
        <label for="setVoice">发音偏好</label>
        <select id="setVoice">
          <option value="en-US" ${voice === 'en-US' ? 'selected' : ''}>美音（en-US）</option>
          <option value="en-GB" ${voice === 'en-GB' ? 'selected' : ''}>英音（en-GB）</option>
        </select>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">词书管理</h2>
      <div class="dropzone" id="dropzone">拖拽词书文件到这里（JSON / CSV / TXT）</div>
      <input class="spell-input" id="importName" type="text" placeholder="词书名称（JSON 自动读取，CSV/TXT 用此项）">
      <input id="importFile" type="file" accept=".json,.csv,.txt">
      <textarea class="import-textarea" id="importText" placeholder="或在此粘贴词表文本"></textarea>
      <button class="btn btn-primary btn-block" id="importBtn" type="button">导入词书</button>
      ${books.length > 0 ? `
        <div class="setting-booklist">
          ${books.map((b) => `<div class="setting-row"><span>${escapeHtml(b.name)}</span><span class="text-secondary">${b.wordCount} 词</span></div>`).join('')}
        </div>
        <a class="btn btn-outline btn-block" href="#/books">查看词书页</a>
      ` : ''}
    </div>

    <div class="card">
      <h2 class="card-title">数据</h2>
      <div class="btn-stack">
        <button class="btn btn-outline btn-block" id="exportBtn" type="button">导出备份（JSON）</button>
        <button class="btn btn-outline btn-block" id="restoreBtn" type="button">导入备份（覆盖恢复）</button>
        <input id="restoreFile" type="file" accept=".json" hidden>
        <button class="btn btn-danger btn-block" id="clearBtn" type="button">清空全部数据</button>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">关于</h2>
      <div class="setting-row"><span>应用</span><span>单词通 ${escapeHtml(APP_VERSION)}</span></div>
      <div class="setting-row"><span>词库</span><span>${books.length} 本词书 · ${wordTotal} 词</span></div>
      <p class="text-secondary about-text">所有数据仅保存在本机浏览器（IndexedDB），不上传任何服务器；清除浏览器数据会丢失进度，请定期导出备份。</p>
      <p class="text-secondary about-text">词根词缀数据（M6）为项目组参考 word-root-workshop（github.com/joeseesun/word-root-workshop）、engra（github.com/eslsoft/engra）的整理思路人工编写，未直接复制其数据；拆解算法思路参考 find-roots-of-word（github.com/excing/find-roots-of-word）。</p>
    </div>
  `;

  // ---- 学习设置：实时生效 ----
  const clamp = (v, lo, hi, dft) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dft;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  };
  container.querySelector('#setDailyNew').addEventListener('change', async (e) => {
    const v = clamp(e.target.value, 5, 50, 20);
    e.target.value = v;
    await setSetting('dailyNew', v);
  });
  container.querySelector('#setDailyReviewCap').addEventListener('change', async (e) => {
    const v = clamp(e.target.value, 20, 300, 100);
    e.target.value = v;
    await setSetting('dailyReviewCap', v);
  });
  container.querySelector('#setAutoSpeak').addEventListener('change', async (e) => {
    await setSetting('autoSpeak', e.target.checked);
  });
  container.querySelector('#setVoice').addEventListener('change', async (e) => {
    await setSetting('voice', e.target.value);
  });

  // ---- 词书导入：文件 / 拖拽 / 粘贴（§4.2） ----
  const fileInput = container.querySelector('#importFile');
  const textArea = container.querySelector('#importText');
  const nameInput = container.querySelector('#importName');
  const fillFromFile = async (file) => {
    if (!file) return;
    textArea.value = await file.text();
    if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '');
  };
  fileInput.addEventListener('change', () => fillFromFile(fileInput.files && fileInput.files[0]));
  const dz = container.querySelector('#dropzone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    await fillFromFile(file);
  });

  container.querySelector('#importBtn').addEventListener('click', async () => {
    const text = textArea.value;
    const name = nameInput.value.trim();
    if (!text.trim()) {
      await renderSettings(container, '请先选择文件或粘贴文本');
      return;
    }
    try {
      const result = parseImportText(text, { name });
      if (result.success === 0) {
        await renderSettings(container, `导入失败：无有效词条（无效行 ${result.invalid}）`);
        return;
      }
      await importBook(result);
      // §4.2 结果提示：成功 N 词、去重跳过 X、无效行 Y
      await renderSettings(container, `导入完成：成功 ${result.success} 词、去重跳过 ${result.duplicates}、无效行 ${result.invalid}`);
    } catch (err) {
      await renderSettings(container, `导入失败：${err && err.message ? err.message : '未知错误'}`);
    }
  });

  // ---- 数据：导出备份 / 导入备份 / 清空全部 ----
  container.querySelector('#exportBtn').addEventListener('click', async () => {
    const stores = {};
    for (const s of STORE_NAMES) stores[s] = await getAll(s);
    const payload = { app: 'wordmaster', version: APP_VERSION, exportedAt: Date.now(), stores };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wordmaster-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const restoreFile = container.querySelector('#restoreFile');
  container.querySelector('#restoreBtn').addEventListener('click', () => restoreFile.click());
  restoreFile.addEventListener('change', async () => {
    const file = restoreFile.files && restoreFile.files[0];
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      await renderSettings(container, '导入备份失败：文件不是合法 JSON');
      return;
    }
    if (!payload || typeof payload !== 'object' || !payload.stores || typeof payload.stores !== 'object') {
      await renderSettings(container, '导入备份失败：备份文件格式不正确');
      return;
    }
    if (!window.confirm('导入备份将覆盖当前全部数据，确定继续？')) return;
    for (const s of STORE_NAMES) await clear(s);
    for (const s of STORE_NAMES) {
      const rows = Array.isArray(payload.stores[s]) ? payload.stores[s] : [];
      if (rows.length > 0) await bulkPut(s, rows); // put 保留原 key，完整还愿进度/自增 id
    }
    await renderSettings(container, '备份已恢复');
  });

  container.querySelector('#clearBtn').addEventListener('click', async () => {
    if (!window.confirm('确定清空全部数据？词书、进度、打卡、徽章都会删除！')) return;
    if (!window.confirm('再次确认：此操作不可恢复（建议先导出备份）。继续清空？')) return;
    for (const s of STORE_NAMES) await clear(s);
    await renderSettings(container, '全部数据已清空');
  });
}
