/**
 * pages.js — 各页面渲染函数（SPEC §5）
 * M2 实现：今日（基础版）/ 学习 / 复习 / 词书（基础版 + 临时导入入口）。
 * 词书详情 M5、统计 M3、设置 M4 仍为占位。
 * 学习与复习共用本文件「测验会话」区（§4.1 题型 1/2；题型 3 听音辨词 M6 在此扩展）。
 */

import {
  getAll, getAllByIndex, add, del, bulkAdd, bulkPut, getSetting, setSetting,
} from './db.js';
import {
  getTodayTask, markLearned, recordAnswer, bumpCheckin, createProgress,
} from './scheduler.js';
import { speak } from './speech.js';
import { parseImportText } from './importer.js';

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
  if (path === '/stats') return renderPlaceholder(container, '统计', '统计页将于 M3 实现');
  if (path === '/settings') return renderPlaceholder(container, '我的', '设置页将于 M4 实现');
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
  const task = await getTodayTask(book.id);
  container.innerHTML = `
    <div class="home-header">
      <!-- M4：此处补充等级称号 + XP 进度条 + streak 火焰（§4.3-A、§6） -->
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
  }
  if (!container.isConnected) return;
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
  }
  if (!container.isConnected) return;
  // 队列清空 → 回今日页（§5）。M3 在此替换为全屏彩带 + 「打卡成功」卡（§4.3-C）
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

/* ==================== 词书页（M2 基础版：列表 + 设为当前 + 删除 + 临时导入；进度环 M4、详情 M5） ==================== */

async function renderBooks(container, notice = '') {
  const [books, activeBookId] = await Promise.all([getAll('books'), getSetting('activeBookId')]);
  const listHtml = books.length === 0
    ? `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <p>还没有词书，先在下方导入一本</p>
      </div>
    `
    : books.map((b) => `
      <div class="card">
        <div><strong>${escapeHtml(b.name)}</strong></div>
        <div class="book-meta">
          ${b.wordCount} 词 · 来源：${b.source === 'builtin' ? '内置' : '导入'}${b.id === activeBookId ? ' · <span class="book-active">当前词书</span>' : ''}
        </div>
        <!-- M4：掌握进度环（SVG circle，§6） -->
        <div class="book-actions">
          ${b.id === activeBookId ? '' : `<button class="btn btn-outline btn-sm" type="button" data-act="use" data-id="${b.id}">设为当前词书</button>`}
          <button class="btn btn-outline btn-sm" type="button" data-act="detail" data-id="${b.id}">详情（M5）</button>
          <button class="btn btn-danger btn-sm" type="button" data-act="del" data-id="${b.id}">删除</button>
        </div>
      </div>
    `).join('');

  container.innerHTML = `
    <h1 class="page-title">词书</h1>
    ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
    ${listHtml}
    <div class="card">
      <strong>导入词书</strong>
      <p class="text-secondary import-tip">临时入口，M4 移入「我的 → 设置」（§8 开发须知 2）。支持 JSON / CSV / TXT（§4.2）。</p>
      <input class="spell-input" id="importName" type="text" placeholder="词书名称（JSON 自动读取，CSV/TXT 用此项）">
      <input id="importFile" type="file" accept=".json,.csv,.txt">
      <textarea class="import-textarea" id="importText" placeholder="或在此粘贴词表文本"></textarea>
      <button class="btn btn-primary btn-block" id="importBtn" type="button">导入</button>
    </div>
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

  const fileInput = container.querySelector('#importFile');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    container.querySelector('#importText').value = await file.text();
    const nameInput = container.querySelector('#importName');
    if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '');
  });

  container.querySelector('#importBtn').addEventListener('click', async () => {
    const text = container.querySelector('#importText').value;
    const name = container.querySelector('#importName').value.trim();
    if (!text.trim()) {
      await renderBooks(container, '请先选择文件或粘贴文本');
      return;
    }
    try {
      const result = parseImportText(text, { name });
      if (result.success === 0) {
        await renderBooks(container, `导入失败：无有效词条（无效行 ${result.invalid}）`);
        return;
      }
      await importBook(result);
      // §4.2 结果提示：成功 N 词、去重跳过 X、无效行 Y
      await renderBooks(container, `导入完成：成功 ${result.success} 词、去重跳过 ${result.duplicates}、无效行 ${result.invalid}`);
    } catch (err) {
      await renderBooks(container, `导入失败：${err && err.message ? err.message : '未知错误'}`);
    }
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
