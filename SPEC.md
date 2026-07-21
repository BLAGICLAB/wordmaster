# 「单词通」开发文档（v2.0 整合版）

> 轻量化纯静态背单词 PWA，目标用户：初高中学生。
> 本文档是开发的唯一依据，按里程碑 M1 → M6 从零开始实现（见 §8 里程碑与开发顺序）。

---

## 1. 产品概述

### 1.1 定位
纯静态网页应用（PWA），零后端、零成本。核心能力：**导入词书（教材词库/老师发的词表）→ 按间隔重复算法安排学习与复习 → 每日打卡 + 激励**。数据全部存在浏览器本地（IndexedDB），可一键导出/导入备份。

### 1.2 设计原则
- 主动回忆优先：所有学习以"自测"为核心，不做纯翻卡浏览
- 间隔重复调度：改良艾宾浩斯固定节点模型
- 轻量游戏化：打卡 streak + XP 等级 + 徽章，目标是"防弃学"而非"玩游戏"
- 零依赖原则：不引入任何前端框架和构建工具，原生 HTML/CSS/JS，无第三方库

### 1.3 非目标（不做）
- 多设备同步、账号体系、排行榜、家长端
- 例句、图片、音标字段（词库无此数据；发音由 Web Speech 合成）
- 深色模式（设计令牌已集中在 `:root`，预留扩展）
- 服务端 AI 功能

---

## 2. 技术方案

### 2.1 技术栈
| 层 | 选型 | 说明 |
|----|------|------|
| 前端 | 原生 HTML + CSS + ES Module JS | 无框架、无构建步骤 |
| 存储 | IndexedDB（自封装轻量 Promise 封装） | 词书、单词、进度、打卡、激励、拆解缓存 |
| 发音 | Web Speech API `speechSynthesis`（en-US / en-GB 可选） | 不支持时静默降级 |
| PWA | manifest.json + Service Worker（cache-first） | 可"添加到主屏幕"，离线可用 |
| 部署 | 任意静态托管 / Mac mini / GitHub Pages | 仅静态文件 |

### 2.2 目录结构

```
app/
├── index.html          # 唯一页面，SPA，hash 路由
├── css/style.css       # 全部样式，移动端优先，设计令牌见 §6
├── js/
│   ├── main.js         # 入口、路由、页面切换；导出 APP_VERSION 常量
│   ├── db.js           # IndexedDB 封装（openDB/增删改查/批量操作）
│   ├── importer.js     # 词书导入解析；解析函数不依赖 DOM，单独导出供 Node 单测
│   ├── scheduler.js    # 间隔重复调度引擎
│   ├── gamification.js # 激励机制：XP、等级、徽章判定
│   ├── morph.js        # 词根词缀拆解引擎（M6）
│   ├── speech.js       # 发音封装（美音/英音）
│   └── pages.js        # 各页面渲染函数
├── data/
│   └── roots.json      # 词根词缀表（M6，<50KB）
├── icons/              # PWA 图标（SVG）
├── manifest.json
└── sw.js               # Service Worker，缓存版本号与 APP_VERSION 同步

test/
└── import_logic_test.mjs  # 导入逻辑 Node 单测（node test/import_logic_test.mjs）
```

### 2.3 数据模型（IndexedDB，库名 `wordmaster`）

**store: `books`**（keyPath: `id` 自增）
```js
{ id, name, source: 'import' | 'builtin', createdAt, wordCount }
```

**store: `words`**（keyPath: `id` 自增，索引 `bookId`）
```js
{ id, bookId, word, pos, meaning, grade /* 年级/册，可空 */, seq /* 原顺序 */ }
```

**store: `progress`**（keyPath: `wordId`）
```js
{
  wordId,
  stage,          // 0..6 对应间隔阶梯下标；7 = 已掌握
  nextReviewAt,   // 时间戳，到期进入复习队列
  correctStreak,  // 连续答对次数
  wrongCount,     // 累计答错次数；≥3 为易错词
  lastReviewAt,
  isNew           // true = 从未学过
}
```

**store: `checkins`**（keyPath: `date`，格式 `YYYY-MM-DD`）
```js
{ date, newLearned, reviewed, correct, wrong }
```

**store: `settings`**（keyPath: `key`）
```js
{ key: 'dailyNew', value: 20 }        // 每日新学上限，5–50，默认 20
{ key: 'dailyReviewCap', value: 100 } // 每日复习上限，20–300，默认 100
{ key: 'activeBookId', value: 1 }     // 当前学习词书
{ key: 'autoSpeak', value: true }     // 学习卡进入时自动发音
{ key: 'voice', value: 'en-US' }      // 发音偏好：en-US 美音 / en-GB 英音
{ key: 'xp', value: 0 }               // 累计经验值
```

**store: `badges`**（keyPath: `badgeId`）
```js
{ badgeId: 'streak7', unlockedAt: 1721462400000 }
```

**store: `morphology`**（keyPath: `word`，词根词缀拆解缓存）
```js
{ word: 'unhappy', parts: [
  { part: 'un',    type: 'prefix', meaning: '不，否定' },
  { part: 'happy', type: 'root',   meaning: '快乐' }
] }
```
查不到拆解规则的词不入库；该 store 可整体清空重建，不影响主流程。

---

## 3. 间隔重复调度引擎（scheduler.js）

间隔阶梯（stage → 距下次复习）：
```
stage 0: 10 分钟
stage 1: 1 天
stage 2: 2 天
stage 3: 4 天
stage 4: 7 天
stage 5: 15 天
stage 6: 30 天 → 之后标记 stage=7「已掌握」
```

规则：
- **新学**：从当前词书取 `isNew=true` 的词，每日上限 `dailyNew`。新学流程走完（学习卡 + 测验通过）后置 `stage=0`，`nextReviewAt = now + 10min`。
- **到期复习**：`nextReviewAt <= now` 且 `stage < 7` 的词，按到期时间升序，受 `dailyReviewCap` 截断（超出顺延，防复习债失控）。
- **答对**：`stage+1`，`nextReviewAt = now + 阶梯[stage]`，`correctStreak+1`。
- **答错**：`stage = max(0, stage-1)`，`nextReviewAt = now + 10min`（当次会话内很快再见），`wrongCount+1`，`correctStreak=0`。
- **易错词**：`wrongCount >= 3` 的词在复习队列中置顶。
- **今日任务** = 到期复习词（截断后）+ 新学词（不超上限）。完成后写入 `checkins` 达成当日打卡。

---

## 4. 功能规格

### 4.1 测验题型（三种，学习/复习时随机混合）

1. **看词选义**：显示英文单词（可点发音），4 个中文释义选项（干扰项从同词书随机抽取）。
2. **看义拼词**：显示中文释义，输入英文拼写。判定：忽略大小写、首尾空格；多词短语按完整字符串比较。
3. **听音辨词**（M6）：只播放发音、不显示单词文本，输入拼写，判定规则同上。

### 4.2 词书导入（importer.js）

入口在设置页（§5），支持文件选择、拖拽、文本粘贴三种方式。

**A. JSON 格式**（主要格式，兼容沪教版词库结构）
```json
{
  "版本": "词书名（作为词书名称）",
  "词汇": [
    { "序号": 1, "年级/册": "六年级上册(6A)", "单词": "family", "词性": "n.", "中文释义": "家庭；家人" }
  ]
}
```
同时兼容通用数组格式：`[{ "word": "...", "pos": "...", "meaning": "..." }]`。

**B. CSV / TXT 格式**：每行一条，逗号或制表符分隔：
```
apple,n. 苹果    → 第二列匹配到词性标记（n. v. adj. 等）则拆出词性，否则整列作释义
apple,苹果
```

**导入处理规则**
- 词书内按 `word` 去重（忽略大小写），跳过并计数
- 空行、缺少释义的行跳过并计数
- 完成后弹出结果：成功 N 词、去重跳过 X、无效行 Y
- 发音统一走 Web Speech，无需预制音频

### 4.3 激励机制（gamification.js）

**A. 经验值 XP**

| 行为 | XP |
|------|----|
| 新学一词并通过测验 | +10 |
| 复习答对 | +5 |
| 复习答错（鼓励分） | +1 |
| 完成当日全部任务 | +20 |
| 连续打卡每满 7 天 | +50 |

**等级称号**（今日页顶部显示称号 + XP 进度条，升级弹出全屏祝贺层 1.5 秒）：
```
Lv.1 词汇萌新 0 ｜ Lv.2 词汇学徒 200 ｜ Lv.3 词汇达人 500 ｜ Lv.4 词汇精英 1000
Lv.5 词汇大师 2000 ｜ Lv.6 词汇学霸 4000 ｜ Lv.7 词汇传说 8000
```

**B. 徽章（8 枚，常量表写在 gamification.js：id/名称/描述/判定函数）**

| id | 名称 | 条件 |
|----|------|------|
| `firstDay` | 初来乍到 | 完成第 1 次打卡 |
| `streak7` | 七日之约 | 连续打卡 7 天 |
| `streak30` | 月度坚持 | 连续打卡 30 天 |
| `master100` | 小有积累 | 累计掌握 100 词 |
| `master500` | 词汇富翁 | 累计掌握 500 词 |
| `master1000` | 千词斩 | 累计掌握 1000 词 |
| `perfect` | 百发百中 | 单日正确率 100%（答题数 ≥ 20） |
| `bookDone` | 一书通关 | 任意词书掌握率 100% |

判定时机：每次答题结算、每次打卡写入后调用 `checkBadges()`。新解锁徽章在今日页弹出提示；统计页展示徽章墙（未解锁灰色 + 条件说明）。

**C. 即时反馈**
- 答对：选项变绿 + 轻微放大（CSS transform 200ms）
- 答错：变红轻抖动（`@keyframes shake`）+ 展示正确答案 2 秒
- 完成当日任务：全屏彩带动画（纯 CSS 实现，不引库）+ 「打卡成功」卡

### 4.4 词根词缀辅助拆解（morph.js + data/roots.json，M6）

- 实现路线：**精简词根词缀表 + 规则拆解引擎**，不挂大型词源数据库。
  - `data/roots.json`：人工整理初高中常见约 100 个词根 + 50 个前后缀（含中文含义），<50KB，随 app shell 缓存。可参考开源数据整理（license 义务见 §9）。
  - 拆解引擎：前缀剥离 + 后缀剥离 + 词根匹配（思路参考 find-roots-of-word），命中生成 parts 缓存入 `morphology` store。
- 展示位置：学习卡释义下方、词书详情页展开卡中，如 `un-（不）+ happy（快乐）`；**拆不出的词不显示任何内容**（宁缺毋滥，初中简单词命中率低属预期）。
- 降级：整个模块失败时静默跳过，不影响学习复习主流程。

### 4.5 默写模式（M6，对应学校听写场景）

- 入口：词书页 / 词书详情页，选择一个年级/册分组开始。
- 玩法（借鉴 Typing Word）：播放发音 + 显示释义，用户打字输入，**逐字母即时反馈**（字母对错实时标色）。
- 错词自动 `wrongCount+1` 并加入当日复习队列。
- 结束出结果页：正确率、错词列表、可一键加入复习。

### 4.6 错词本（M6）

- 位置：统计页新增「错词本」卡片。
- 内容：`wrongCount >= 1` 的词按错误次数降序，显示 单词/释义/答错次数/掌握状态，附发音按钮。
- 「立即复习错词」：临时生成只含错词的复习队列，不占用当日新学额度。

---

## 5. 页面与路由（hash 路由）

| 路由 | 页面 | 内容 |
|------|------|------|
| `#/` | 今日 | 等级称号 + XP 进度条 + streak 火焰；当前词书、今日任务（新学 X / 复习 Y）、开始按钮；未导入词书时引导去设置页 |
| `#/study` | 学习 | 新学卡片（单词+词性+释义+词根拆解+发音按钮）→「我记住了」→ 立即测验一题 → 下一词 |
| `#/review` | 复习 | 逐题测验 → 即时反馈 → 队列清空后回今日页并触发打卡庆祝 |
| `#/books` | 词书 | 词书列表（名称/词数/掌握进度环）、设为当前词书、删除、进入详情；默写模式入口；导入仅保留"去导入"跳转链接 |
| `#/books/:id` | 词书详情 | 见下 |
| `#/stats` | 统计 | 打卡日历（近 30 天）、累计学习/掌握词数、今日正确率、徽章墙、错词本 |
| `#/settings` | 设置 | 见下 |

**词书详情页（#/books/:id）**
- 顶部：词书名 + 掌握进度环 + 搜索框（实时过滤单词前缀或释义，200ms 防抖）
- 分组浏览：按 `grade`（年级/册）分组折叠，默认展开第一组；无 grade 的词书直接平铺
- 单词条目：单词 + 词性 + 释义 + 状态标记 + 发音按钮；状态标记：灰=未学、黄=学习中（stage 0–6）、绿=已掌握（7）、红=易错（wrongCount≥3）
- 点击条目展开小卡：stage、连续答对、累计答错、下次复习日期、词根拆解
- 性能：每组默认只渲染前 50 条 + 「显示更多」按钮（避免千词一次性渲染）

**设置页（#/settings）分组**
1. **学习设置**：每日新学数量（5–50，默认 20）；每日复习上限（20–300，默认 100）；自动发音开关；发音偏好（美音/英音）。均实时生效
2. **词书管理**：「导入词书」（文件/拖拽/粘贴）+ 已导入词书列表 + 跳转词书页
3. **数据**：导出备份（全部 IndexedDB → JSON 下载）、导入备份（确认后覆盖恢复）、清空全部数据（二次确认）
4. **关于**：应用名 + 版本号（读 `main.js` 的 `APP_VERSION`，格式 `v2.0.0`）、词库信息（词书数/总词数）、数据说明（仅保存本机浏览器）、词根数据来源及 license 说明

**通用交互细节**
- 学习卡进入自动发音一次（受"自动发音"开关与浏览器策略限制，失败静默）
- 答错后正确答案展示 2 秒再进下一题
- 学习/复习页顶部有进度条（第 3/20 题）

---

## 6. UI 视觉规范

**设计令牌（CSS 自定义属性，写在 `:root`）**
```css
--color-primary: #0d9488;        /* 主色 青绿 */
--color-primary-dark: #0f766e;
--color-accent: #f59e0b;         /* 点缀 琥珀：XP、徽章、streak 火焰 */
--color-success: #22c55e;
--color-danger: #ef4444;
--color-bg: #f6f7f9;
--color-card: #ffffff;
--color-text: #1f2937;
--color-text-secondary: #6b7280;
--radius-card: 16px;
--radius-button: 12px;
--shadow-card: 0 2px 12px rgba(0,0,0,.06);
--font-size-word: 34px;          /* 学习卡单词字号 */
```

**页面视觉要点**
- **今日页 Header**：主色渐变（`#0d9488 → #14b8a6`）圆角大卡，含等级称号、XP 进度条（琥珀色）、streak 火焰 + 天数；其余页面用简洁白底标题栏
- **卡片**：白底、`--radius-card`、`--shadow-card`，间距 16px
- **按钮**：主按钮主色白字、圆角 `--radius-button`、按下 `transform: scale(.97)`；次按钮描边
- **学习卡**：单词居中 34px 粗体，词性为小号灰胶囊，发音为圆形图标按钮
- **选项按钮**：整宽列表式，对错动效见 §4.3 C
- **进度**：学习/复习页顶部细进度条；词书掌握度用环形进度（SVG circle stroke-dasharray）
- **底部 Tab 栏**：5 项（今日/学习/复习/词书/我的），内联 SVG 图标，激活项主色 + 轻微上浮；「我的」即设置页
- **空状态**：无数据时大号 emoji/SVG 占位 + 引导文案 + 跳转按钮
- **动画**：页面切换淡入 150ms；打卡彩带；升级祝贺遮罩 + 称号缩放弹入
- **整体**：移动端优先，内容最大宽度 480px 居中，桌面端两侧留白

---

## 7. PWA 规格

- `manifest.json`：名称「单词通」、主题色 `#0d9488`、192/512 图标、`display: standalone`
- `sw.js`：cache-first 缓存 app shell（含 `data/roots.json`）；缓存版本号与 `APP_VERSION` 同步（如 `wordmaster-v2.0.0`），发版一并修改
- 移动端 meta：`viewport`、`apple-mobile-web-app-capable`

---

## 8. 里程碑与开发顺序

本项目从零开发，严格按 M1 → M6 顺序实现，每个里程碑完成并通过验收后再做下一个。

| 阶段 | 内容 | 验收 |
|------|------|------|
| M1 | 项目骨架 + IndexedDB（db.js，含全部 7 个 store）+ 词书导入 | 沪教版词库成功导入（1179 词），导入测试通过 |
| M2 | 学习 + 复习 + 调度引擎 | 新学/复习闭环跑通，调度测试通过 |
| M3 | 打卡 + 统计页 + PWA | 可添加到主屏幕、离线可打开 |
| M4 | 激励机制 + 设置页 + UI 美化 | XP/徽章/等级生效，备份恢复可用，视觉符合 §6 |
| M5 | 词书详情页 | 分组/搜索/状态标记可用，千词词书浏览流畅 |
| M6 | 词根词缀 + 听音默写 + 错词本 | 拆解抽查合格，默写闭环，错词本可用 |

**开发须知**
1. 数据模型（§2.3）是最终版，M1 建库时就把 7 个 store 全部建好，避免后期做 IndexedDB 版本迁移。
2. 底部 Tab 最终形态为 今日/学习/复习/词书/我的（设置页）；M1–M3 阶段设置页未做时，导入按钮可临时放在词书页，M4 再移入设置页。
3. 导入解析（importer.js）的纯函数与调度引擎（scheduler.js）不依赖 DOM，直接写对应的 Node 单测（见 §9）。
4. 本地运行：`cd app && python3 -m http.server 8000`，浏览器开 `http://localhost:8000`；手机同一 WiFi 访问本机局域网 IP 可体验 PWA。
5. 测试词库：项目根目录 `沪教版初中英语词库.json`（1243 条原始数据，按单词去重后 1179 词，其中 64 个为跨年级重复词）。

---

## 9. 测试计划

1. **导入测试**：用 `沪教版初中英语词库.json` 导入，验证成功 **1179 词、去重跳过 64**，字段映射（词性/释义/年级册）无错位，结果提示计数正确。
2. **CSV 导入测试**：构造 5 行 CSV（含 1 无效、1 重复）验证计数。
3. **调度测试**：新学 1 词 → stage=0；模拟答对 → stage 递增、nextReviewAt 正确；模拟答错 → stage 降级、wrongCount+1；构造 150 个到期词 + `dailyReviewCap=100`，当日复习队列恰为 100。
4. **激励测试**：新学 1 词 → XP+10；完成当日任务 → XP+20；`dailyNew=5` 后任务上限立即生效；模拟连续 7 天打卡 → 解锁 `streak7`。
5. **设置页测试**：导出备份 → 清空数据 → 导入备份 → 词书与进度完整恢复；版本号与 `APP_VERSION` 一致。
6. **词书详情页测试**：按年级/册正确分组；搜索 "fam" 过滤出 family；状态标记与 progress 一致；1179 词滚动不卡。
7. **扩展模块测试**：`unhappy`、`pollution` 拆解正确、`family` 不显示拆解、`morphology` 缓存生效；听音辨词不显示单词文本；错词本在答错后出现该词且「立即复习错词」队列只含错词。
8. **JS 语法检查**：所有 js 文件过 `node --check`；导入逻辑单测 `node test/import_logic_test.mjs` 全过。
9. **人工冒烟**：`python3 -m http.server 8000` 起服务，浏览器走一遍 导入→学习→复习→词书详情→统计→设置 全流程。

---

## 10. 附录：参考的开源项目

| 项目 | 借鉴点 | 链接 |
|------|--------|------|
| qwerty-learner / Typing Word | 默写模式逐字母即时反馈、错词本、美英音切换 | github.com/RealKai42/qwerty-learner |
| word-root-workshop | 词根词缀"搭积木"记忆法、精简词根表思路 | github.com/joeseesun/word-root-workshop |
| engra | 社区共建词根词缀数据库（整理 roots.json 参考） | github.com/eslsoft/engra |
| find-roots-of-word | 纯算法拆解单词为词根词缀组合的思路 | github.com/excing/find-roots-of-word |
| Anki / FSRS | 间隔重复算法二期升级方向 | github.com/open-spaced-repetition/fsrs4anki |

注意：参考设计思路与数据整理方式，不直接复制代码与素材；词根词缀数据若基于上述项目整理，须在「关于」页注明来源与 license。
