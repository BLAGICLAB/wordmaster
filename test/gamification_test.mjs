/**
 * 激励机制 Node 单测（SPEC §9 测试 4）
 * 运行：node test/gamification_test.mjs
 * 覆盖：XP 规则值（新学 +10 / 完成当日任务 +20 / streak 满 7 天 +50）；
 *       levelForXP 等级边界与进度；addXP 升级判定；
 *       evaluateBadges 八枚徽章判定（含模拟连续 7 天打卡 → 解锁 streak7）；
 *       dailyNew=5 上限即时生效（复用 scheduler.selectNewWords 验证）。
 */
import {
  XP_RULES,
  LEVELS,
  BADGES,
  levelForXP,
  addXP,
  evaluateBadges,
} from '../app/js/gamification.js';
import { selectNewWords, calcStreak, shiftDay } from '../app/js/scheduler.js';

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function eq(name, actual, expected) {
  check(`${name}（期望 ${expected}，实际 ${actual}）`, actual === expected);
}

// ---------- XP 规则值（§4.3-A） ----------
console.log('XP 规则');
eq('新学一词并通过测验 +10', XP_RULES.learnNew, 10);
eq('复习答对 +5', XP_RULES.reviewRight, 5);
eq('复习答错（鼓励分）+1', XP_RULES.reviewWrong, 1);
eq('完成当日全部任务 +20', XP_RULES.dailyDone, 20);
eq('连续打卡每满 7 天 +50', XP_RULES.streak7, 50);
eq('徽章共 8 枚', BADGES.length, 8);
eq('等级共 7 级', LEVELS.length, 7);

// ---------- 等级 ----------
console.log('levelForXP 等级边界');
eq('0 XP → Lv.1', levelForXP(0).level, 1);
eq('0 XP 称号 词汇萌新', levelForXP(0).title, '词汇萌新');
eq('199 XP 仍 Lv.1', levelForXP(199).level, 1);
eq('200 XP → Lv.2', levelForXP(200).level, 2);
eq('999 XP → Lv.3', levelForXP(999).level, 3);
eq('1000 XP → Lv.4', levelForXP(1000).level, 4);
eq('8000 XP → Lv.7 满级', levelForXP(8000).level, 7);
eq('满级 next=null', levelForXP(8000).next, null);
eq('满级 progress=1', levelForXP(9000).progress, 1);
eq('Lv.1→2 进度 100/200=0.5', levelForXP(100).progress, 0.5);
eq('下一级门槛 200', levelForXP(0).next, 200);

// ---------- addXP ----------
console.log('addXP 升级判定');
const r1 = addXP(0, XP_RULES.learnNew);
eq('新学 1 词 XP=10', r1.xp, 10);
check('10 XP 未升级', !r1.leveledUp);
const r2 = addXP(190, XP_RULES.dailyDone);
eq('190+20=210', r2.xp, 210);
check('跨过 200 升级', r2.leveledUp);
eq('升级后 Lv.2', r2.to.level, 2);
const r3 = addXP(200, XP_RULES.reviewRight);
check('同级内加分不升级', !r3.leveledUp);

// ---------- 徽章判定 ----------
console.log('evaluateBadges 徽章判定');
const base = { checkinCount: 0, streak: 0, mastered: 0, todayRow: null, bookRates: [] };
eq('初始无徽章', evaluateBadges(base).length, 0);
check('首次打卡 → firstDay', evaluateBadges({ ...base, checkinCount: 1 }).includes('firstDay'));

// 模拟连续 7 天打卡 → 解锁 streak7（§9 测试 4）
const TODAY = '2026-07-21';
const week = Array.from({ length: 7 }, (_, i) => shiftDay(TODAY, -i));
const streak7 = calcStreak(week, TODAY);
eq('模拟连续 7 天打卡 streak=7', streak7, 7);
const ids7 = evaluateBadges({ ...base, checkinCount: 7, streak: streak7 });
check('连续 7 天 → 解锁 streak7', ids7.includes('streak7'));
check('streak7 同时含 firstDay', ids7.includes('firstDay'));
check('7 天未达 streak30', !ids7.includes('streak30'));
check('连续 30 天 → streak30', evaluateBadges({ ...base, streak: 30 }).includes('streak30'));

check('掌握 100 → master100', evaluateBadges({ ...base, mastered: 100 }).includes('master100'));
check('掌握 99 无 master100', !evaluateBadges({ ...base, mastered: 99 }).includes('master100'));
check('掌握 500 → master500', evaluateBadges({ ...base, mastered: 500 }).includes('master500'));
check('掌握 1000 → master1000', evaluateBadges({ ...base, mastered: 1000 }).includes('master1000'));

check('20 题全对 → perfect', evaluateBadges({ ...base, todayRow: { correct: 20, wrong: 0 } }).includes('perfect'));
check('19 题全对未达 20 题', !evaluateBadges({ ...base, todayRow: { correct: 19, wrong: 0 } }).includes('perfect'));
check('有答错无 perfect', !evaluateBadges({ ...base, todayRow: { correct: 25, wrong: 1 } }).includes('perfect'));

check('词书掌握率 100% → bookDone', evaluateBadges({ ...base, bookRates: [0.5, 1] }).includes('bookDone'));
check('掌握率 99% 无 bookDone', !evaluateBadges({ ...base, bookRates: [0.99] }).includes('bookDone'));

// ---------- 设置上限即时生效（§9 测试 4：dailyNew=5） ----------
console.log('dailyNew 上限即时生效');
const words = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, seq: i + 1 }));
eq('dailyNew=5 只取 5 词', selectNewWords(words, new Map(), 5).length, 5);
eq('dailyNew=20 取 20 词', selectNewWords(words, new Map(), 20).length, 20);

// ---------- 汇总 ----------
console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
