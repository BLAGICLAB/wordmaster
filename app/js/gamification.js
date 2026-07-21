/**
 * gamification.js — 激励机制：XP、等级、徽章判定（SPEC §4.3）
 * 纯函数部分（levelForXP / addXP / evaluateBadges）不依赖 DOM / IndexedDB，供 Node 单测
 * （test/gamification_test.mjs，§9 测试 4）；DB 包装仅浏览器端调用。
 */

import { getAll, getSetting, setSetting, put } from './db.js';
import { todayStr, calcStreak, isActiveCheckin, MASTERED_STAGE } from './scheduler.js';

/** XP 规则（§4.3-A） */
export const XP_RULES = {
  learnNew: 10,    // 新学一词并通过测验
  reviewRight: 5,  // 复习答对
  reviewWrong: 1,  // 复习答错（鼓励分）
  dailyDone: 20,   // 完成当日全部任务
  streak7: 50,     // 连续打卡每满 7 天
};

/** 等级称号：[等级, 称号, 所需累计 XP]（§4.3-A） */
export const LEVELS = [
  [1, '词汇萌新', 0],
  [2, '词汇学徒', 200],
  [3, '词汇达人', 500],
  [4, '词汇精英', 1000],
  [5, '词汇大师', 2000],
  [6, '词汇学霸', 4000],
  [7, '词汇传说', 8000],
];

/** 徽章常量表（§4.3-B）：id / 名称 / 描述 / 展示 emoji */
export const BADGES = [
  { id: 'firstDay',   name: '初来乍到', desc: '完成第 1 次打卡',            emoji: '🌱' },
  { id: 'streak7',    name: '七日之约', desc: '连续打卡 7 天',              emoji: '📅' },
  { id: 'streak30',   name: '月度坚持', desc: '连续打卡 30 天',             emoji: '🗓️' },
  { id: 'master100',  name: '小有积累', desc: '累计掌握 100 词',            emoji: '💯' },
  { id: 'master500',  name: '词汇富翁', desc: '累计掌握 500 词',            emoji: '💰' },
  { id: 'master1000', name: '千词斩',   desc: '累计掌握 1000 词',           emoji: '🏆' },
  { id: 'perfect',    name: '百发百中', desc: '单日正确率 100%（答题数 ≥ 20）', emoji: '🎯' },
  { id: 'bookDone',   name: '一书通关', desc: '任意词书掌握率 100%',        emoji: '📕' },
];

/* ==================== 纯函数（Node 可测） ==================== */

/**
 * 累计 XP → 等级信息。
 * @returns {{ level:number, title:string, current:number, next:number|null, progress:number }}
 *   current 当前级起始 XP；next 下一级起始 XP（满级为 null）；progress 0..1 级内进度。
 */
export function levelForXP(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let cur = LEVELS[0];
  for (const lv of LEVELS) {
    if (x >= lv[2]) cur = lv;
  }
  const next = LEVELS.find((lv) => lv[2] > x) || null;
  const progress = next ? (x - cur[2]) / (next[2] - cur[2]) : 1;
  return { level: cur[0], title: cur[1], current: cur[2], next: next ? next[2] : null, progress };
}

/**
 * 加 XP（纯函数）。
 * @returns {{ xp:number, leveledUp:boolean, from:object, to:object }} from/to 为 levelForXP 结果
 */
export function addXP(currentXp, amount) {
  const from = levelForXP(currentXp);
  const xp = Math.max(0, (Number(currentXp) || 0) + amount);
  const to = levelForXP(xp);
  return { xp, leveledUp: to.level > from.level, from, to };
}

/**
 * 徽章判定（纯函数）：输入汇总状态，返回满足条件的 badgeId 数组。
 * @param {object} state
 *   state.checkinCount 有活动的打卡天数（firstDay）
 *   state.streak       当前连续打卡天数
 *   state.mastered     累计掌握词数（stage = 7）
 *   state.todayRow     当日 checkin 行（perfect：答题数 ≥ 20 且全对）
 *   state.bookRates    各词书掌握率数组 0..1（bookDone：任一为 1）
 */
export function evaluateBadges(state) {
  const ids = [];
  const { checkinCount = 0, streak = 0, mastered = 0, todayRow = null, bookRates = [] } = state || {};
  if (checkinCount >= 1) ids.push('firstDay');
  if (streak >= 7) ids.push('streak7');
  if (streak >= 30) ids.push('streak30');
  if (mastered >= 100) ids.push('master100');
  if (mastered >= 500) ids.push('master500');
  if (mastered >= 1000) ids.push('master1000');
  if (todayRow && todayRow.wrong === 0 && todayRow.correct >= 20) ids.push('perfect');
  if (bookRates.some((r) => r >= 1)) ids.push('bookDone');
  return ids;
}

/* ==================== DB 包装（页面调用） ==================== */

/**
 * 加 XP 并写回 settings。
 * @returns {Promise<{ xp:number, leveledUp:boolean, from:object, to:object }>}
 */
export async function awardXP(amount) {
  const cur = await getSetting('xp', 0);
  const r = addXP(cur, amount);
  await setSetting('xp', r.xp);
  return r;
}

/**
 * 完成当日全部任务 +20（§4.3-A），每日只奖一次。
 * @returns {Promise<object|null>} awardXP 结果；今日已奖过返回 null
 */
export async function awardDailyDone() {
  if ((await getSetting('dailyDoneDate')) === todayStr()) return null;
  await setSetting('dailyDoneDate', todayStr());
  return awardXP(XP_RULES.dailyDone);
}

/**
 * 连续打卡每满 7 天 +50（§4.3-A），每档（7/14/21/…）只奖一次。
 * @param {number} streak 当前连续打卡天数
 * @returns {Promise<object|null>}
 */
export async function awardStreakMilestone(streak) {
  if (streak <= 0 || streak % 7 !== 0) return null;
  const last = await getSetting('streakXpAwarded', 0);
  if (streak <= last) return null;
  await setSetting('streakXpAwarded', streak);
  return awardXP(XP_RULES.streak7);
}

/**
 * 徽章检查：每次答题结算、每次打卡写入后调用（§4.3-B）。
 * 汇总当前状态 → evaluateBadges → 新满足的写入 badges store。
 * @returns {Promise<Array>} 本次新解锁的徽章（BADGES 中的完整对象）
 */
export async function checkBadges() {
  const [checkins, progressAll, unlocked, words, books] = await Promise.all([
    getAll('checkins'),
    getAll('progress'),
    getAll('badges'),
    getAll('words'),
    getAll('books'),
  ]);
  const active = checkins.filter(isActiveCheckin);
  const masteredById = new Set(
    progressAll.filter((p) => p.stage >= MASTERED_STAGE).map((p) => p.wordId),
  );
  // 各词书掌握率 = 已掌握词数 / 词书词数（无词的词书跳过）
  const bookRates = books.map((b) => {
    const bookWords = words.filter((w) => w.bookId === b.id);
    if (bookWords.length === 0) return 0;
    return bookWords.filter((w) => masteredById.has(w.id)).length / bookWords.length;
  });
  const satisfied = new Set(evaluateBadges({
    checkinCount: active.length,
    streak: calcStreak(active.map((c) => c.date)),
    mastered: masteredById.size,
    todayRow: checkins.find((c) => c.date === todayStr()) || null,
    bookRates,
  }));
  const have = new Set(unlocked.map((b) => b.badgeId));
  const fresh = BADGES.filter((b) => satisfied.has(b.id) && !have.has(b.id));
  const now = Date.now();
  for (const b of fresh) {
    await put('badges', { badgeId: b.id, unlockedAt: now });
  }
  return fresh;
}
