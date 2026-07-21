/**
 * db.js — IndexedDB 轻量 Promise 封装
 * 库名 wordmaster，版本 1。M1 一次性建好全部 7 个 store（见 SPEC §2.3），
 * 后续里程碑不得再做 schema 版本迁移。
 */

export const DB_NAME = 'wordmaster';
export const DB_VERSION = 1;

/** store 定义：数据模型最终版，见 SPEC §2.3 */
export const STORE_NAMES = [
  'books',      // { id, name, source, createdAt, wordCount } keyPath: id 自增
  'words',      // { id, bookId, word, pos, meaning, grade, seq } keyPath: id 自增，索引 bookId
  'progress',   // { wordId, stage, nextReviewAt, correctStreak, wrongCount, lastReviewAt, isNew } keyPath: wordId
  'checkins',   // { date, newLearned, reviewed, correct, wrong } keyPath: date (YYYY-MM-DD)
  'settings',   // { key, value } keyPath: key
  'badges',     // { badgeId, unlockedAt } keyPath: badgeId
  'morphology', // { word, parts: [{ part, type, meaning }] } keyPath: word
];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('words')) {
        const words = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        words.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'wordId' });
      }
      if (!db.objectStoreNames.contains('checkins')) {
        db.createObjectStore('checkins', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('badges')) {
        db.createObjectStore('badges', { keyPath: 'badgeId' });
      }
      if (!db.objectStoreNames.contains('morphology')) {
        db.createObjectStore('morphology', { keyPath: 'word' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const out = fn(store);
    tx.oncomplete = () => resolve(out && out.__result !== undefined ? out.__result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function get(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).getAll());
}

/** 按索引查询（如 words 的 bookId 索引） */
export async function getAllByIndex(storeName, indexName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).index(indexName).getAll(key));
}

export async function put(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  return reqToPromise(tx.objectStore(storeName).put(value));
}

export async function add(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  return reqToPromise(tx.objectStore(storeName).add(value));
}

export async function del(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  return reqToPromise(tx.objectStore(storeName).delete(key));
}

export async function clear(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  return reqToPromise(tx.objectStore(storeName).clear());
}

/** 批量写入（单事务） */
export async function bulkPut(storeName, values) {
  return withStore(storeName, 'readwrite', (store) => {
    for (const v of values) store.put(v);
    return values.length;
  });
}

/** 批量新增（单事务，自增 key） */
export async function bulkAdd(storeName, values) {
  return withStore(storeName, 'readwrite', (store) => {
    for (const v of values) store.add(v);
    return values.length;
  });
}

export async function count(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).count());
}

/** settings 便捷读写 */
export async function getSetting(key, defaultValue = null) {
  const row = await get('settings', key);
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}
