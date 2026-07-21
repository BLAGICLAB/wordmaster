/**
 * 调度引擎 Node 单测（SPEC §9 测试 3）
 * 运行：node test/scheduler_test.mjs
 * 覆盖：新学 → stage=0；答对 stage 递增与 nextReviewAt；stage 6 答对 → 7 已掌握；
 *       答错降级 / wrongCount+1 / streak 清零；150 到期词 + cap 100 → 队列恰为 100；
 *       易错词置顶与组内到期升序；新学选词的 dailyNew 上限与 seq 顺序。
 */
import {
  INTERVALS,
  MASTERED_STAGE,
  FAR_FUTURE,
  createProgress,
  toLearned,
  applyAnswer,
  selectDueReviews,
  selectNewWords,
} from '../app/js/scheduler.js';

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

const NOW = 1700000000000;
const TEN_MIN = INTERVALS[0];

function isAsc(list, key) {
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1][key] > list[i][key]) return false;
  }
  return true;
}

// ---------- 新学 ----------
console.log('新学：createProgress / toLearned');
const fresh = createProgress(1, NOW);
check('createProgress isNew=true', fresh.isNew === true);
eq('createProgress stage', fresh.stage, 0);
eq('createProgress wrongCount', fresh.wrongCount, 0);
eq('createProgress correctStreak', fresh.correctStreak, 0);

const learned = toLearned(fresh, NOW);
eq('新学后 stage=0', learned.stage, 0);
eq('新学后 nextReviewAt = now + 10min', learned.nextReviewAt, NOW + TEN_MIN);
check('新学后 isNew=false', learned.isNew === false);
eq('新学后 lastReviewAt=now', learned.lastReviewAt, NOW);
check('toLearned 不改动原对象', fresh.isNew === true && fresh.nextReviewAt === null);

// ---------- 答对 ----------
console.log('答对：stage 递增与 nextReviewAt');
const a1 = applyAnswer(learned, true, NOW);
eq('stage 0 答对 → stage 1', a1.stage, 1);
eq('答对 nextReviewAt = now + INTERVALS[1]', a1.nextReviewAt, NOW + INTERVALS[1]);
eq('答对 correctStreak+1', a1.correctStreak, 1);
eq('答对 lastReviewAt=now', a1.lastReviewAt, NOW);
check('applyAnswer 不改动原对象', learned.stage === 0);

let p = learned;
for (let s = 1; s <= 6; s++) p = applyAnswer(p, true, NOW);
eq('连对 6 次到 stage 6', p.stage, 6);
eq('stage 6 nextReviewAt = now + INTERVALS[6]', p.nextReviewAt, NOW + INTERVALS[6]);
const mastered = applyAnswer(p, true, NOW);
eq('stage 6 答对 → stage 7 已掌握', mastered.stage, MASTERED_STAGE);
eq('已掌握 nextReviewAt = FAR_FUTURE', mastered.nextReviewAt, FAR_FUTURE);
eq('已掌握 streak 继续累计', mastered.correctStreak, 7);

// ---------- 答错 ----------
console.log('答错：降级 / wrongCount+1 / streak 清零');
const mid = { ...learned, stage: 3, correctStreak: 5, wrongCount: 2, nextReviewAt: NOW - 1 };
const w1 = applyAnswer(mid, false, NOW);
eq('stage 3 答错 → stage 2', w1.stage, 2);
eq('答错 nextReviewAt = now + 10min', w1.nextReviewAt, NOW + TEN_MIN);
eq('答错 wrongCount+1', w1.wrongCount, 3);
eq('答错 correctStreak 清零', w1.correctStreak, 0);
eq('答错 lastReviewAt=now', w1.lastReviewAt, NOW);
check('答错 isNew=false', w1.isNew === false);
const w0 = applyAnswer({ ...learned, stage: 0 }, false, NOW);
eq('stage 0 答错保持 0', w0.stage, 0);

// ---------- 到期复习队列 ----------
console.log('selectDueReviews：150 到期 + cap 100 → 队列恰为 100');
const list = [];
for (let i = 0; i < 150; i++) {
  list.push({
    wordId: i + 1,
    stage: 1,
    nextReviewAt: NOW - (150 - i) * 1000, // 均已到期，时间各不相同
    correctStreak: 0,
    wrongCount: 0,
    lastReviewAt: null,
    isNew: false,
  });
}
// 5 个易错词（wrongCount>=3），到期时间反而最晚，用于验证置顶优先于时间
for (let i = 0; i < 5; i++) {
  list.push({
    wordId: 1000 + i,
    stage: 2,
    nextReviewAt: NOW - (5 - i) * 1000,
    correctStreak: 0,
    wrongCount: 3 + i,
    lastReviewAt: null,
    isNew: false,
  });
}
// 不应入选：未到期 / 已掌握 / 新词
list.push({ wordId: 2001, stage: 1, nextReviewAt: NOW + 10000, correctStreak: 0, wrongCount: 0, lastReviewAt: null, isNew: false });
list.push({ wordId: 2002, stage: MASTERED_STAGE, nextReviewAt: NOW - 1000, correctStreak: 0, wrongCount: 0, lastReviewAt: null, isNew: false });
list.push({ wordId: 2003, stage: 0, nextReviewAt: null, correctStreak: 0, wrongCount: 0, lastReviewAt: null, isNew: true });

const queue = selectDueReviews(list, 100, NOW);
eq('队列长度恰为 100', queue.length, 100);
check('易错词全部置顶（前 5 个 wrongCount>=3）', queue.slice(0, 5).every((x) => x.wrongCount >= 3));
check('易错词组内按到期升序', isAsc(queue.slice(0, 5), 'nextReviewAt'));
check('普通词组内按到期升序', isAsc(queue.slice(5), 'nextReviewAt'));
check('未到期词未入选', !queue.some((x) => x.wordId === 2001));
check('已掌握词未入选', !queue.some((x) => x.wordId === 2002));
check('新词未入选', !queue.some((x) => x.wordId === 2003));
check('截断取最早到期者（wordId 1 在队首普通组）', queue[5].wordId === 1);

// ---------- 新学选词 ----------
console.log('selectNewWords：dailyNew 上限与 seq 顺序');
const words = [
  { id: 1, seq: 2 },
  { id: 2, seq: 1 },
  { id: 3, seq: 3 },
  { id: 4, seq: 4 },
];
const pmap = new Map([[3, { wordId: 3, isNew: false, stage: 1 }]]); // id3 已学
const sel2 = selectNewWords(words, pmap, 2);
eq('dailyNew=2 只取 2 个', sel2.length, 2);
check('按 seq 升序取（id2 再 id1）', sel2[0].id === 2 && sel2[1].id === 1);
const selAll = selectNewWords(words, pmap, 10);
eq('上限足够时取全部新词', selAll.length, 3);
check('已学词被排除', !selAll.some((w) => w.id === 3));
check('seq 顺序正确', selAll.map((w) => w.id).join(',') === '2,1,4');
const selObj = selectNewWords(words, { 3: { wordId: 3, isNew: false } }, 10);
eq('progressMap 兼容普通对象', selObj.length, 3);

// ---------- 汇总 ----------
console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
