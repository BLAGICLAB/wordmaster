/**
 * scheduler.js — 间隔重复调度引擎（SPEC §3）
 * 间隔阶梯 stage → 距下次复习：10min / 1d / 2d / 4d / 7d / 15d / 30d，之后 stage=7 已掌握。
 * 纯函数部分不依赖 DOM / IndexedDB，供 Node 单测（test/scheduler_test.mjs，§9 测试 3）；
 * DB 包装函数与打卡辅助仅在浏览器端由页面调用（import db.js 不在顶层触碰浏览器 API）。
 */

import { get, put, getAll, getAllByIndex, getSetting } from './db.js';

/** 间隔阶梯（毫秒），下标即 stage */
export const INTERVALS = [
  10 * 60 * 1000,        // stage 0: 10 分钟
  1 * 24 * 3600 * 1000,  // stage 1: 1 天
  2 * 24 * 3600 * 1000,  // stage 2: 2 天
  4 * 24 * 3600 * 1000,  // stage 3: 4 天
  7 * 24 * 3600 * 1000,  // stage 4: 7 天
  15 * 24 * 3600 * 1000, // stage 5: 15 天
  30 * 24 * 3600 * 1000, // stage 6: 30 天 → 之后 stage=7 已掌握
];

export const MASTERED_STAGE = 7;

/**
 * 已掌握词的 nextReviewAt 取值决策：置为 Date 上限时间戳（远未来），表示不再参与调度。
 * （备选项 now + INTERVALS[6] 会让掌握词 30 天后"看似到期"，虽被 stage<7 过滤，但语义不干净。）
 */
export const FAR_FUTURE = 8640000000000000;

/** settings 默认值（§2.3） */
export const DEFAULT_DAILY_NEW = 20;
export const DEFAULT_DAILY_REVIEW_CAP = 100;

/** 易错词阈值：wrongCount >= 3 复习队列置顶（§3） */
export const WRONG_PIN_THRESHOLD = 3;

/* ==================== 纯函数（Node 可测，now 均作参数注入） ==================== */

/**
 * 新建学习进度记录（§2.3 progress store）。
 * 新词尚未进入调度：nextReviewAt / lastReviewAt 置 null，isNew=true。
 * @param {number} wordId
 * @param {number} now 当前时间戳（保留入参，便于与未来字段扩展/测试对齐）
 */
export function createProgress(wordId, now) {
  void now;
  return {
    wordId,
    stage: 0,
    nextReviewAt: null,
    correctStreak: 0,
    wrongCount: 0,
    lastReviewAt: null,
    isNew: true,
  };
}

/**
 * 新学流程走完（学习卡 + 测验）后置为「已学」（§3）：stage=0，10 分钟后首次复习。
 * 返回新对象，不改动入参。
 */
export function toLearned(progress, now) {
  return {
    ...progress,
    stage: 0,
    nextReviewAt: now + INTERVALS[0],
    lastReviewAt: now,
    isNew: false,
  };
}

/**
 * 答题结算（§3），返回新进度对象，不改动入参。
 * 答对：stage+1（6→7 已掌握），nextReviewAt = now + 阶梯[新 stage]（掌握后取 FAR_FUTURE），
 *       correctStreak+1，lastReviewAt=now，isNew=false。
 * 答错：stage=max(0,stage-1)，nextReviewAt = now + 10min（当次会话很快再见），
 *       wrongCount+1，correctStreak=0，lastReviewAt=now，isNew=false。
 */
export function applyAnswer(progress, correct, now) {
  const base = { ...progress, lastReviewAt: now, isNew: false };
  if (correct) {
    const newStage = Math.min(progress.stage + 1, MASTERED_STAGE);
    return {
      ...base,
      stage: newStage,
      nextReviewAt: newStage >= MASTERED_STAGE ? FAR_FUTURE : now + INTERVALS[newStage],
      correctStreak: progress.correctStreak + 1,
    };
  }
  return {
    ...base,
    stage: Math.max(0, progress.stage - 1),
    nextReviewAt: now + INTERVALS[0],
    wrongCount: progress.wrongCount + 1,
    correctStreak: 0,
  };
}

/**
 * 到期复习队列（§3）：nextReviewAt <= now 且 stage < 7 且非新词，
 * 易错词（wrongCount>=3）置顶，组内按到期时间升序，最后按 cap 截断（超出顺延）。
 * @returns {Array} 截断后的进度记录队列
 */
export function selectDueReviews(progressList, cap, now) {
  const due = progressList.filter((p) => p
    && !p.isNew
    && p.stage < MASTERED_STAGE
    && p.nextReviewAt != null
    && p.nextReviewAt <= now);
  due.sort((a, b) => {
    const pinA = a.wrongCount >= WRONG_PIN_THRESHOLD ? 0 : 1;
    const pinB = b.wrongCount >= WRONG_PIN_THRESHOLD ? 0 : 1;
    if (pinA !== pinB) return pinA - pinB;
    return a.nextReviewAt - b.nextReviewAt;
  });
  return due.slice(0, cap);
}

/**
 * 新学选词（§3）：无进度记录或进度 isNew=true 的词，按 seq 升序，取前 dailyNew 个。
 * @param {Array} words 词书记录（含 id、seq）
 * @param {Map|Object} progressMap wordId → progress（Map 或普通对象均可）
 */
export function selectNewWords(words, progressMap, dailyNew) {
  const getP = (id) => (progressMap instanceof Map ? progressMap.get(id) : progressMap[id]);
  return [...words]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .filter((w) => {
      const p = getP(w.id);
      return !p || p.isNew;
    })
    .slice(0, dailyNew);
}

/* ==================== DB 包装（页面调用） ==================== */

/**
 * 取某词书全部单词的进度映射：Map(wordId → progress)。
 */
export async function getProgressMap(bookId) {
  const words = await getAllByIndex('words', 'bookId', bookId);
  const ids = new Set(words.map((w) => w.id));
  const all = await getAll('progress');
  const map = new Map();
  for (const p of all) {
    if (ids.has(p.wordId)) map.set(p.wordId, p);
  }
  return map;
}

/**
 * 今日任务（§3）= 到期复习词（dailyReviewCap 截断后）+ 新学词（不超 dailyNew）。
 * @returns {Promise<{ newWords: Array, reviews: Array }>}
 *   newWords / reviews 均为 word 记录；reviews 已按调度队列顺序（易错词置顶、到期升序）排好。
 */
export async function getTodayTask(bookId) {
  const dailyNew = await getSetting('dailyNew', DEFAULT_DAILY_NEW);
  const dailyReviewCap = await getSetting('dailyReviewCap', DEFAULT_DAILY_REVIEW_CAP);
  const words = await getAllByIndex('words', 'bookId', bookId);
  const progressMap = await getProgressMap(bookId);
  const newWords = selectNewWords(words, progressMap, dailyNew);
  const wordById = new Map(words.map((w) => [w.id, w]));
  const reviews = selectDueReviews([...progressMap.values()], dailyReviewCap, Date.now())
    .map((p) => wordById.get(p.wordId))
    .filter(Boolean);
  return { newWords, reviews };
}

/** 新学完成：置 stage=0、10 分钟后首次复习（§3） */
export async function markLearned(wordId, now = Date.now()) {
  const p = (await get('progress', wordId)) || createProgress(wordId, now);
  await put('progress', toLearned(p, now));
}

/** 复习答题结算：读出现有进度（无则新建），applyAnswer 后写回 */
export async function recordAnswer(wordId, correct, now = Date.now()) {
  const p = (await get('progress', wordId)) || createProgress(wordId, now);
  await put('progress', applyAnswer(p, correct, now));
}

/* ==================== 打卡辅助（M2 简易版；M3 打卡日历 / 统计 / streak 在此基础上扩展） ==================== */

const CHECKIN_FIELDS = ['newLearned', 'reviewed', 'correct', 'wrong'];

/** 本地日期串 YYYY-MM-DD（checkins store 的 keyPath） */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 累加当日打卡计数（不存在则按 §2.3 结构新建）。
 * @param {'newLearned'|'reviewed'|'correct'|'wrong'} field
 * @param {number} delta 增量，默认 1
 * @param {string} date 日期串，默认今天（todayStr()）
 * @returns {Promise<object>} 更新后的 checkin 行
 */
export async function bumpCheckin(field, delta = 1, date = todayStr()) {
  if (!CHECKIN_FIELDS.includes(field)) {
    throw new Error(`bumpCheckin: 未知字段 ${field}`);
  }
  const row = (await get('checkins', date))
    || { date, newLearned: 0, reviewed: 0, correct: 0, wrong: 0 };
  row[field] += delta;
  await put('checkins', row);
  return row;
}
