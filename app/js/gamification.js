/**
 * gamification.js — 激励机制：XP、等级、徽章判定（M4 实现，见 SPEC §4.3）
 */

/** XP 规则 */
export const XP_RULES = {
  learnNew: 10,    // 新学一词并通过测验
  reviewRight: 5,  // 复习答对
  reviewWrong: 1,  // 复习答错（鼓励分）
  dailyDone: 20,   // 完成当日全部任务
  streak7: 50,     // 连续打卡每满 7 天
};

/** 等级称号：[等级, 称号, 所需累计 XP] */
export const LEVELS = [
  [1, '词汇萌新', 0],
  [2, '词汇学徒', 200],
  [3, '词汇达人', 500],
  [4, '词汇精英', 1000],
  [5, '词汇大师', 2000],
  [6, '词汇学霸', 4000],
  [7, '词汇传说', 8000],
];

/** 徽章常量表（id/名称/描述/判定函数 M4 补齐） */
export const BADGES = [
  { id: 'firstDay',   name: '初来乍到', desc: '完成第 1 次打卡' },
  { id: 'streak7',    name: '七日之约', desc: '连续打卡 7 天' },
  { id: 'streak30',   name: '月度坚持', desc: '连续打卡 30 天' },
  { id: 'master100',  name: '小有积累', desc: '累计掌握 100 词' },
  { id: 'master500',  name: '词汇富翁', desc: '累计掌握 500 词' },
  { id: 'master1000', name: '千词斩',   desc: '累计掌握 1000 词' },
  { id: 'perfect',    name: '百发百中', desc: '单日正确率 100%（答题数 ≥ 20）' },
  { id: 'bookDone',   name: '一书通关', desc: '任意词书掌握率 100%' },
];

// M4：awardXP、levelForXP、checkBadges（答题结算与打卡写入后调用）
