/**
 * 导入逻辑 Node 单测（SPEC §9 测试 1、2、8）
 * 运行：node test/import_logic_test.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseImportText,
  parseJSONBook,
  parseDelimitedText,
  normalizeRecord,
  dedupeWords,
} from '../app/js/importer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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

// ---------- 测试 1：沪教版 JSON 导入 ----------
console.log('测试 1：沪教版 JSON 导入');
const hujiaoText = readFileSync(join(ROOT, '沪教版初中英语词库.json'), 'utf8');
const r1 = parseImportText(hujiaoText);
eq('成功词数', r1.success, 1179);
eq('去重跳过', r1.duplicates, 64);
eq('无效行', r1.invalid, 0);
eq('总条数 = 成功 + 去重', r1.success + r1.duplicates, 1243);
check('词书名取自「版本」', r1.name.includes('沪教版'));

// 字段映射无错位（§9 测试 1：词性/释义/年级册）
const family = r1.words[0];
check('首词 word = family', family.word === 'family');
check('首词 pos = n.', family.pos === 'n.');
check('首词 meaning = 家庭；家人', family.meaning === '家庭；家人');
check('首词 grade = 六年级上册(6A)', family.grade === '六年级上册(6A)');
check('首词 seq = 1', family.seq === 1);
check('去重忽略大小写后无重复', new Set(r1.words.map((w) => w.word.toLowerCase())).size === r1.words.length);

// ---------- 通用数组 JSON ----------
console.log('测试 2a：JSON 通用数组导入');
const generic = JSON.stringify([
  { word: 'apple', pos: 'n.', meaning: '苹果' },
  { word: 'run', pos: 'v.', meaning: '跑' },
  { word: 'APPLE', pos: 'n.', meaning: '苹果（重复）' },
  { word: 'bad' },
]);
const r2a = parseImportText(generic, { name: '通用词表' });
eq('通用数组成功词数', r2a.success, 2);
eq('通用数组去重跳过', r2a.duplicates, 1);
eq('通用数组无效行', r2a.invalid, 1);
eq('通用数组词书名', r2a.name, '通用词表');
check('通用数组字段映射', r2a.words[1].word === 'run' && r2a.words[1].pos === 'v.' && r2a.words[1].meaning === '跑');

// ---------- 测试 2：CSV 导入（5 行：1 无效 + 1 重复）----------
console.log('测试 2b：CSV 导入');
const csv = [
  'apple,n. 苹果',   // 词性拆出
  'banana,香蕉',      // 整列作释义
  'Apple,n. 苹果',   // 重复（忽略大小写）
  'orange',           // 无效：缺释义
  'grape,n. 葡萄',
].join('\n');
const r2b = parseImportText(csv, { name: 'CSV词表' });
eq('CSV 成功词数', r2b.success, 3);
eq('CSV 去重跳过', r2b.duplicates, 1);
eq('CSV 无效行', r2b.invalid, 1);
const csvApple = r2b.words.find((w) => w.word === 'apple');
check('CSV 词性拆出（apple pos=n. meaning=苹果）', csvApple.pos === 'n.' && csvApple.meaning === '苹果');
const csvBanana = r2b.words.find((w) => w.word === 'banana');
check('CSV 无词性时整列作释义', csvBanana.pos === '' && csvBanana.meaning === '香蕉');
check('CSV 保留先出现者（去重忽略大小写）', csvApple.meaning === '苹果');

// 制表符分隔（TXT）
console.log('测试 2c：TXT 制表符分隔');
const r2c = parseImportText('hello\tint. 你好\nworld\tn. 世界', { name: 'TXT词表' });
eq('TXT 成功词数', r2c.success, 2);
check('TXT 词性拆出', r2c.words[0].pos === 'int.' && r2c.words[0].meaning === '你好');

// ---------- 纯函数单元检查 ----------
console.log('纯函数单元检查');
check('normalizeRecord 缺释义返回 null', normalizeRecord({ word: 'x' }, 1) === null);
check('normalizeRecord 缺单词返回 null', normalizeRecord({ meaning: '义' }, 1) === null);
check('normalizeRecord 去除首尾空格', normalizeRecord({ word: '  cat ', meaning: ' 猫 ' }, 1).word === 'cat');
const dd = dedupeWords([
  { word: 'a', meaning: '1' },
  { word: 'A', meaning: '2' },
  { word: 'b', meaning: '3' },
]);
check('dedupeWords 忽略大小写', dd.words.length === 2 && dd.duplicates === 1);
check('parseJSONBook 沪教版结构识别', parseJSONBook(hujiaoText).records.length === 1243);
check('parseDelimitedText 空行计数', parseDelimitedText('a,甲\n\nb,乙').invalid === 1);

// ---------- 测试 8：所有 js 文件过 node --check ----------
console.log('测试 8：JS 语法检查（node --check）');
const jsFiles = [
  'app/js/main.js',
  'app/js/db.js',
  'app/js/importer.js',
  'app/js/scheduler.js',
  'app/js/gamification.js',
  'app/js/morph.js',
  'app/js/speech.js',
  'app/js/pages.js',
];

// ===== M6 附加：morph 模块的 node --check 与纯函数核心抽查 =====
// （morph.js 已在 jsFiles 列表内做语法检查；这里再验证类型/数量、包含 unhappy/pollution 的拆解能力）
import { splitWord } from '../app/js/morph.js';
import { readFileSync as _rfs } from 'node:fs';
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _R = _d(_f(import.meta.url));
const bigDict = JSON.parse(_rfs(_j(_R, '..', 'app', 'data', 'roots.json'), 'utf8'));
check('roots.json 包含 root happy', bigDict.roots.some((r) => r.part === 'happy'));
check('roots.json 包含 root pollut', bigDict.roots.some((r) => r.part === 'pollut'));
check('roots.json 含 prefix un', bigDict.prefixes.some((p) => p.part === 'un'));
check('roots.json 含 suffix ion', bigDict.suffixes.some((s) => s.part === 'ion'));
const _u = splitWord('unhappy', bigDict);
check('真实词根表也能拆 unhappy',
  Array.isArray(_u) && _u[0].part === 'un' && _u.some((p) => p.part === 'happy'));
for (const f of jsFiles) {
  let ok = true;
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
  } catch {
    ok = false;
  }
  check(`node --check ${f}`, ok);
}

// ---------- 汇总 ----------
console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
