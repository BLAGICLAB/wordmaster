/**
 * scheduler.js — 间隔重复调度引擎（M2 实现，见 SPEC §3）
 * 间隔阶梯 stage → 距下次复习：10min / 1d / 2d / 4d / 7d / 15d / 30d，之后 stage=7 已掌握。
 * 本模块不依赖 DOM，M2 需配 Node 单测（§9 测试 3）。
 */

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

// M2：新学队列、到期复习队列（dailyReviewCap 截断、易错词置顶）、答对/答错结算、今日任务合成
