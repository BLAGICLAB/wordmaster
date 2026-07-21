/**
 * importer.js — 词书导入解析（SPEC §4.2）
 * 解析函数全部为纯函数，不依赖 DOM / IndexedDB，命名导出供 Node 单测。
 *
 * 支持格式：
 *   A. JSON 沪教版：{ "版本": "词书名", "词汇": [{ "序号", "年级/册", "单词", "词性", "中文释义" }] }
 *   B. JSON 通用数组：[{ "word", "pos", "meaning", "grade"? }]
 *   C. CSV / TXT：每行一条，逗号或制表符分隔；第二列匹配词性标记则拆出词性
 *
 * 统一返回 ImportResult：
 *   { name, words: [{ word, pos, meaning, grade, seq }], success, duplicates, invalid }
 *   - words 已按 word 去重（忽略大小写），seq 为原始顺序
 *   - success = words.length，duplicates = 去重跳过数，invalid = 无效行数
 */

/** 词性标记（n. v. vt. vi. adj. adv. prep. conj. pron. num. art. int. aux. abbr. phr. 等） */
const POS_RE = /^((?:vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|interj|aux|abbr|phr|det)\.)\s*(.*)$/i;

/** 规范化一条记录；缺单词或释义返回 null（无效行） */
export function normalizeRecord(raw, seq) {
  if (!raw || typeof raw !== 'object') return null;
  const word = String(raw.word ?? '').trim();
  const meaning = String(raw.meaning ?? '').trim();
  if (!word || !meaning) return null;
  return {
    word,
    pos: String(raw.pos ?? '').trim(),
    meaning,
    grade: raw.grade != null && raw.grade !== '' ? String(raw.grade).trim() : null,
    seq,
  };
}

/** 按 word 去重（忽略大小写），保留先出现者 */
export function dedupeWords(words) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const w of words) {
    const key = w.word.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
    } else {
      seen.add(key);
      unique.push(w);
    }
  }
  return { words: unique, duplicates };
}

/** 汇总为 ImportResult */
export function buildResult(name, records, invalid) {
  const { words, duplicates } = dedupeWords(records);
  return {
    name: name || '未命名词书',
    words,
    success: words.length,
    duplicates,
    invalid,
  };
}

/**
 * 解析 JSON 文本（自动识别沪教版对象结构 / 通用数组结构）。
 * @returns {{ name: string, records: Array, invalid: number }}
 * @throws 非 JSON 或结构不识别时抛错
 */
export function parseJSONBook(text) {
  const data = JSON.parse(text); // 非 JSON 直接抛错，由调用方回退 CSV/TXT

  // A. 沪教版结构
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data['词汇'])) {
    const name = typeof data['版本'] === 'string' && data['版本'].trim()
      ? data['版本'].trim()
      : '沪教版词库';
    const records = [];
    let invalid = 0;
    data['词汇'].forEach((item, i) => {
      const rec = item && typeof item === 'object'
        ? normalizeRecord(
            {
              word: item['单词'],
              pos: item['词性'],
              meaning: item['中文释义'],
              grade: item['年级/册'],
            },
            item['序号'] != null ? Number(item['序号']) : i + 1,
          )
        : null;
      if (rec) records.push(rec);
      else invalid += 1;
    });
    return { name, records, invalid };
  }

  // B. 通用数组结构
  if (Array.isArray(data)) {
    const records = [];
    let invalid = 0;
    data.forEach((item, i) => {
      const rec = normalizeRecord(item, i + 1);
      if (rec) records.push(rec);
      else invalid += 1;
    });
    return { name: '', records, invalid };
  }

  throw new Error('无法识别的 JSON 词书结构');
}

/**
 * 解析 CSV / TXT 文本：每行一条，逗号或制表符分隔。
 *   apple,n. 苹果  → 第二列匹配词性标记则拆出词性，其余作释义
 *   apple,苹果     → 整列作释义
 * 空行、缺释义的行计为无效行。
 */
export function parseDelimitedText(text) {
  const records = [];
  let invalid = 0;
  const lines = String(text).split(/\r\n|\r|\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      invalid += 1; // 空行跳过并计数（SPEC §4.2）
      return;
    }
    // 按第一个逗号或制表符切成「单词」与「剩余列」
    const m = trimmed.match(/^([^,\t]+)[,\t](.*)$/);
    if (!m) {
      invalid += 1; // 无分隔符 → 缺释义
      return;
    }
    const word = m[1].trim();
    let rest = m[2].trim();
    let pos = '';
    const posMatch = rest.match(POS_RE);
    if (posMatch) {
      pos = posMatch[1];
      rest = posMatch[2].trim();
    }
    const rec = normalizeRecord({ word, pos, meaning: rest }, i + 1);
    if (rec) records.push(rec);
    else invalid += 1;
  });
  return { records, invalid };
}

/**
 * 导入入口：自动识别 JSON / CSV / TXT。
 * @param {string} text 文件或粘贴文本
 * @param {object} [opts] opts.name 词书名（JSON 沪教版自带名称时忽略）
 * @returns {ImportResult}
 */
export function parseImportText(text, opts = {}) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return { name: opts.name || '未命名词书', words: [], success: 0, duplicates: 0, invalid: 0 };
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const { name, records, invalid } = parseJSONBook(trimmed);
      return buildResult(name || opts.name, records, invalid);
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error('JSON 解析失败：' + err.message);
      throw err;
    }
  }
  const { records, invalid } = parseDelimitedText(text);
  return buildResult(opts.name, records, invalid);
}
