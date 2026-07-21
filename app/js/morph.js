/**
 * morph.js — 词根词缀拆解引擎（SPEC §4.4）
 *
 * 路线：精简词根词缀表（data/roots.json，前缀剥离 + 后缀剥离 + 词根匹配）
 * 命中生成 parts 缓存入 morphology store；拆不出的词不显示任何内容；模块失败静默降级。
 *
 * 设计：
 *   - splitWord(word, dict) 纯函数（Node 可测）
 *   - loadRoots() 浏览器 fetch 或 Node fs 兜底（首次调用加载一次缓存）
 *   - analyzeWord(word, opts) 异步包装：缓存命中读 morphology store；未命中 split + 写库
 *   - clearMorphCache(opts) 清空 morphology store（重建不影响主流程）
 *
 * 测试接口：opts.adapter 注入 { get, put, clear, ... }；缺省用 db.js（浏览器端）。
 */

const ROOTS_URL_BROWSER = './data/roots.json';
const ROOTS_RELATIVE_FROM_JS = '../data/roots.json';

let _rootsCache = null;

/**
 * 加载词根词缀表。浏览器 fetch，Node fs 兜底。失败时返回空表（不会阻塞主流程）。
 * @returns {Promise<{roots: Array, prefixes: Array, suffixes: Array}>}
 */
export async function loadRoots() {
  if (_rootsCache) return _rootsCache;
  // 浏览器端
  if (typeof fetch !== 'undefined') {
    try {
      const resp = await fetch(ROOTS_URL_BROWSER);
      if (resp && resp.ok) {
        _rootsCache = await resp.json();
        return _rootsCache;
      }
    } catch {
      // fallback through
    }
  }
  // Node / SW / 其他环境：尝试 fs 读
  try {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const text = fs.readFileSync(path.join(here, ROOTS_RELATIVE_FROM_JS), 'utf8');
    _rootsCache = JSON.parse(text);
    return _rootsCache;
  } catch {
    // 兜底空表
    _rootsCache = { roots: [], prefixes: [], suffixes: [] };
    return _rootsCache;
  }
}

/** 测试钩子：注入自定义词根表，绕过缓存与 IO */
export function __setRootsForTest(dict) {
  _rootsCache = dict;
}

/**
 * 纯函数：把单词拆成 parts。算法：
 *   1. 优先尝试前缀：剥离最长的匹配前缀 → 余下 middle+suffix
 *   2. middle 部分优先尝试最长后缀剥离 + root 匹配；或仅作为 root 匹配
 *   3. 若前缀均不匹配，退回 root + suffix 直接组合
 *   4. 整体必须是 root（remainder 必须在 roots 表中），否则视为拆不出 → null
 *
 * @param {string} word
 * @param {{roots?: Array, prefixes?: Array, suffixes?: Array}} dict
 * @returns {Array<{part: string, type: 'prefix'|'root'|'suffix', meaning: string}>|null}
 */
export function splitWord(word, dict) {
  if (!word || typeof word !== 'string' || !dict) return null;
  const w = word.toLowerCase();
  const prefixes = (dict.prefixes || []).slice().sort((a, b) => b.part.length - a.part.length);
  const suffixes = (dict.suffixes || []).slice().sort((a, b) => b.part.length - a.part.length);
  const roots = dict.roots || [];
  const rootMap = new Map(roots.map((r) => [String(r.part).toLowerCase(), r]));
  const findRoot = (s) => {
    const hit = rootMap.get(s);
    return hit ? { part: hit.part, type: 'root', meaning: hit.meaning } : null;
  };

  if (w.length < 2) return null;

  // Step 1：优先前缀
  for (const p of prefixes) {
    const pk = String(p.part).toLowerCase();
    if (!pk || pk.length >= w.length) continue;
    if (!w.startsWith(pk)) continue;
    const rest = w.slice(pk.length);
    if (!rest) continue;
    // 1a) 尝试 rest = root + suffix
    for (const s of suffixes) {
      const sk = String(s.part).toLowerCase();
      if (!sk || sk.length >= rest.length) continue;
      if (!rest.endsWith(sk)) continue;
      const middle = rest.slice(0, rest.length - sk.length);
      if (!middle) continue;
      const r = findRoot(middle);
      if (r) {
        return [
          { part: p.part, type: 'prefix', meaning: p.meaning },
          r,
          { part: s.part, type: 'suffix', meaning: s.meaning },
        ];
      }
    }
    // 1b) 整段 rest 当作一个 root
    const r = findRoot(rest);
    if (r) {
      return [
        { part: p.part, type: 'prefix', meaning: p.meaning },
        r,
      ];
    }
  }

  // Step 2：无前缀 → root + suffix
  for (const s of suffixes) {
    const sk = String(s.part).toLowerCase();
    if (!sk || sk.length >= w.length) continue;
    if (!w.endsWith(sk)) continue;
    const middle = w.slice(0, w.length - sk.length);
    if (!middle) continue;
    const r = findRoot(middle);
    if (r) {
      return [
        r,
        { part: s.part, type: 'suffix', meaning: s.meaning },
      ];
    }
  }

  // Step 3：单词本身就是 root（极少见，但允许）
  const rOnly = findRoot(w);
  if (rOnly) return [rOnly];

  return null;
}

/**
 * 异步拆解 + 缓存。morphology store 用 opts.adapter（默认 db.js）。
 * 查不到拆解的词不入库（§4.4 / §2.3）。
 * @param {string} word 英文单词
 * @param {object} [opts]
 *   - adapter: {get(store,key),put(store,val),clear(store),getAll(store)} 用于测试注入
 *   - dict: 直接传入词根表，避免 loadRoots
 * @returns {Promise<Array|null>}
 */
export async function analyzeWord(word, opts = {}) {
  if (!word || typeof word !== 'string') return null;
  let adapter = opts.adapter;
  if (!adapter) {
    try { adapter = await import('./db.js'); } catch { adapter = null; }
  }
  const dict = opts.dict || await loadRoots();
  const key = word.toLowerCase();
  if (adapter && typeof adapter.get === 'function') {
    try {
      const cached = await adapter.get('morphology', key);
      if (cached && Array.isArray(cached.parts)) return cached.parts;
    } catch {
      // 读缓存失败 → 当作未命中继续
    }
  }
  const parts = splitWord(word, dict);
  if (!parts || parts.length === 0) return null;
  if (adapter && typeof adapter.put === 'function') {
    try { await adapter.put('morphology', { word: key, parts }); } catch { /* 静默 */ }
  }
  return parts;
}

/**
 * 清空 morphology 缓存（重建不影响主流程，§2.3）。
 * @param {object} [opts] opts.adapter 注入
 */
export async function clearMorphCache(opts = {}) {
  const adapter = opts.adapter || await import('./db.js').catch(() => null);
  if (adapter && typeof adapter.clear === 'function') {
    try { await adapter.clear('morphology'); } catch { /* 静默 */ }
  }
  return true;
}
