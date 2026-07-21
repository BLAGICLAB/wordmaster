/**
 * 词根词缀拆解 Node 单测（SPEC §9 测试 7）
 * 运行：node test/morph_test.mjs
 * 覆盖：unhappy / pollution / happy 等典型拆解；family 不应拆出；
 *       analyzeWord 缓存（morphology store 命中）；clearMorphCache 清空。
 */
import {
  splitWord,
  analyzeWord,
  clearMorphCache,
  __setRootsForTest,
} from '../app/js/morph.js';

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
  check(`${name}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

// 极简词根表（覆盖 unhappy / pollution / family 等测试用例）
const DICT = {
  prefixes: [
    { part: 'un', meaning: '不' },
    { part: 're', meaning: '再' },
    { part: 'in', meaning: '不' },
    { part: 'im', meaning: '不' },
  ],
  roots: [
    { part: 'happy', meaning: '快乐' },
    { part: 'pollut', meaning: '污染' },
    { part: 'cover', meaning: '覆盖' },
    { part: 'place', meaning: '放' },
    { part: 'act', meaning: '做' },
  ],
  suffixes: [
    { part: 'tion', meaning: '行为' },
    { part: 'ion', meaning: '行为' },
    { part: 'ed', meaning: '被…的' },
    { part: 'ing', meaning: '正在' },
    { part: 'ly', meaning: '…地' },
    { part: 'ize', meaning: '使' },
  ],
};

// ---------- splitWord 纯函数 ----------
console.log('splitWord 纯函数拆解');
const u = splitWord('unhappy', DICT);
check('unhappy 拆出 2 个 part', u && u.length === 2);
check('unhappy 包含 prefix un', !!u && u[0].type === 'prefix' && u[0].part === 'un');
check('unhappy 包含 root happy', !!u && u.some((p) => p.type === 'root' && p.part === 'happy'));
check('unhappy 无 suffix', !!u && !u.some((p) => p.type === 'suffix'));

const p = splitWord('pollution', DICT);
check('pollution 拆出 2 个 part', p && p.length === 2);
check('pollution 包含 root pollut', !!p && p.some((x) => x.type === 'root' && x.part === 'pollut'));
check('pollution 包含 suffix ion', !!p && p.some((x) => x.type === 'suffix' && x.part === 'ion'));

const f = splitWord('family', DICT);
check('family 拆不出 → null', f == null);

const act = splitWord('act', DICT);
check('单词本身就是 root 也允许（act → [act]）',
  Array.isArray(act) && act.length === 1 && act[0].part === 'act');

// re + cover = "recover" —— 算法应在 prefix 优先路径下找到
const rec = splitWord('recover', DICT);
check('recover = re + cover',
  Array.isArray(rec) && rec.length === 2 && rec[0].part === 're' && rec[1].part === 'cover');

// 不应拆出（即便 ly 后缀匹配，剩余部分不是 root）
const ugly = splitWord('ugly', DICT);
check('ugly 因剩部分不是 root → null', ugly == null);

// pollution 大写输入也应拆出
const pUpper = splitWord('Pollution', DICT);
check('Pollution 大小写不敏感', Array.isArray(pUpper) && pUpper.some((x) => x.part === 'pollut'));

// 边界
eq('空字符串 → null', splitWord('', DICT), null);
eq('非字符串 → null', splitWord(null, DICT), null);
eq('单词字典为空 → null', splitWord('unhappy', { roots: [], prefixes: [], suffixes: [] }), null);

// ---------- 全 roots.json 的 healthy 自检（兼容性） ----------
console.log('全 roots.json 健康自检');
__setRootsForTest(null); // 用真实加载的表
const big = await loadBigDict();
function loadBigDict() {
  // 浏览器中没有 fetch；Node 直接读文件
  return import('node:fs').then((fs) => {
    const text = fs.readFileSync(new URL('../app/data/roots.json', import.meta.url), 'utf8');
    return JSON.parse(text);
  });
}
__setRootsForTest(await big);
const u2 = splitWord('unhappy', big);
check('真实词根表也能拆 unhappy', Array.isArray(u2) && u2[0].part === 'un' && u2.some((p) => p.part === 'happy'));
const pol2 = splitWord('pollution', big);
check('真实词根表也能拆 pollution', Array.isArray(pol2) && pol2.some((p) => p.part === 'pollut') && pol2.some((p) => p.part === 'ion'));
const fam2 = splitWord('family', big);
check('真实词根表 family 仍不应拆出', fam2 == null);

// ---------- analyzeWord：缓存 & 清空 ----------
console.log('analyzeWord 缓存 & clearMorphCache');
__setRootsForTest(DICT); // 切回极简表

// 内存适配器
const cache = new Map();
let getCalls = 0;
let putCalls = 0;
let clearCalls = 0;
const adapter = {
  get: async (store, key) => { getCalls += 1; return cache.get(`${store}:${key}`) || null; },
  put: async (store, val) => {
    putCalls += 1;
    cache.set(`${store}:${val.word}`, val);
  },
  clear: async (store) => {
    clearCalls += 1;
    for (const k of [...cache.keys()]) if (k.startsWith(`${store}:`)) cache.delete(k);
  },
  getAll: async (store) => [...cache.values()].filter((_, i) => String(i) /* unused placeholder */),
};

putCalls = 0; getCalls = 0; clearCalls = 0;

const ar1 = await analyzeWord('unhappy', { adapter, dict: DICT });
check('analyzeWord(unhappy) 返回 prefix un + root happy',
  Array.isArray(ar1) && ar1[0].part === 'un' && ar1[1].part === 'happy');
check('第一次拆解触发 put 缓存', putCalls === 1);
check('morphology store 命中缓存', cache.has('morphology:unhappy'));
eq('缓存内容 word 字段小写',
  cache.get('morphology:unhappy').word, 'unhappy');

// 第二次同一词：应从缓存读取，put 计数不再增加
const getCallsBefore = getCalls;
const ar2 = await analyzeWord('unhappy', { adapter, dict: DICT });
check('第二次 analyze 命中缓存（value 相同）', JSON.stringify(ar2) === JSON.stringify(ar1));
check('第二次读也走 get', getCalls > getCallsBefore);
check('第二次未再次 put', putCalls === 1);

// family 不应入 morphology 缓存
const arFam = await analyzeWord('family', { adapter, dict: DICT });
eq('analyzeWord(family) → null', arFam, null);
check('family 不入 morphology 缓存', !cache.has('morphology:family'));

// clearMorphCache
await clearMorphCache({ adapter });
check('clearMorphCache 清空 morphology 缓存',
  ![...cache.keys()].some((k) => k.startsWith('morphology:')));
check('clearMorphCache 调用了 adapter.clear', clearCalls === 1);

// 后续 analyze 重新 put（缓存被清空）
putCalls = 0;
await analyzeWord('unhappy', { adapter, dict: DICT });
check('清空缓存后再 analyze 触发 put', putCalls === 1);

// ---------- 默认 loader 不抛错（接口稳健性） ----------
console.log('接口稳健性');
const noCache = await analyzeWord('unhappy', { dict: DICT /* 无 adapter */ });
check('无 adapter 也能正常拆解（缺省不写库）', Array.isArray(noCache));
const noopClear = await clearMorphCache();
check('clearMorphCache 无 adapter 不抛错', noopClear === true);

// ---------- 汇总 ----------
console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
