# 单词通 (WordMaster)

> 轻量化纯静态背单词 PWA —— 零后端、零依赖、零成本

面向初高中学生的间隔重复背单词应用。数据全部本地（IndexedDB），可一键备份还原；可"添加到主屏幕"，离线可用。

## ✨ 核心特性

- **间隔重复调度**（改良艾宾浩斯固定阶梯）
- **三种测验题型**：看词选义 / 看义拼词 / 听音辨词
- **默写模式**：逐字母即时反馈（正确绿 / 错误红）
- **错词本**：按错误次数排序，"立即复习错词"不消耗每日新学额度
- **激励机制**：打卡 streak + XP + 7 级称号 + 8 枚徽章
- **词根词缀拆解**：精简词根表 + 算法拆解，命中率高的词才显示
- **本地优先**：IndexedDB 存全部数据，导出/导入备份，PWA 离线可用
- **零依赖**：无框架 / 无构建 / 无 npm，纯原生 HTML + CSS + ES Module JS

## 🚀 快速开始

```bash
git clone git@github.com:BLAGICLAB/wordmaster.git
cd wordmaster/app
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
# 手机同 WiFi 访问本机 IP 可体验 PWA
```

## 📦 技术栈

| 层 | 选型 |
|----|------|
| 前端 | 原生 HTML + CSS + ES Module JS（**零框架**） |
| 存储 | IndexedDB（库名 `wordmaster`，7 个 store） |
| 发音 | Web Speech API (`speechSynthesis`，美音/英音) |
| PWA | `manifest.json` + Service Worker（cache-first） |
| 部署 | 任意静态托管（GitHub Pages / Netlify / Vercel / 本机 Nginx） |

## 📂 项目结构

```
wordmaster/
├── app/                            # 应用代码
│   ├── index.html                  # SPA 入口（hash 路由）
│   ├── css/style.css               # 全部样式（设计令牌集中在 :root）
│   ├── js/                         # ES Module JS（8 个文件）
│   │   ├── main.js                 # 入口 + APP_VERSION
│   │   ├── db.js                   # IndexedDB 封装
│   │   ├── importer.js             # 词书导入（JSON / CSV / 粘贴）
│   │   ├── scheduler.js            # 间隔重复调度引擎
│   │   ├── gamification.js         # XP / 等级 / 徽章
│   │   ├── morph.js                # 词根词缀拆解（M6）
│   │   ├── speech.js               # 发音封装
│   │   └── pages.js                # 各页面渲染
│   ├── data/roots.json             # 词根词缀表（~200 条，10KB）
│   ├── manifest.json
│   └── sw.js                       # Service Worker
├── test/                           # Node ES Module 单测（无 DOM 依赖）
│   ├── import_logic_test.mjs       # 导入逻辑（43 用例）
│   ├── scheduler_test.mjs          # 调度引擎（51 用例）
│   ├── gamification_test.mjs       # 激励机制（42 用例）
│   └── morph_test.mjs              # 词根拆解（32 用例）
├── 沪教版初中英语词库.json          # 验证语料（1243 → 去重 1179，跳过 64）
├── SPEC.md                         # 完整开发规格（357 行）
└── README.md
```

## 🛣 开发里程碑

严格按 [`SPEC.md` §8](./SPEC.md#8-里程碑与开发顺序) 从 M1 → M6 顺序交付：

| 阶段 | 内容 | Commit |
|------|------|--------|
| M1 | 项目骨架 + IndexedDB（7 store）+ 词书导入 | `2e60dbd` |
| M2 | 调度引擎 + 学习/复习 + 词书列表 | `0e5daea` |
| M3 | 打卡 streak + 统计页 + PWA | `b7cf356` |
| M4 | 激励机制 + 设置页 + UI 美化 + 备份 | `3815a87` |
| M5 | 词书详情页（分组 / 搜索 / 状态 / 50+展开） | `9870279` |
| M6 | 词根拆解 + 听音默写 + 错词本 | `17b3753` |

## 🧪 测试

```bash
cd wordmaster
node --check app/js/*.js     # 8/8 通过
node test/*.mjs              # 168/168 通过
```

测试覆盖（per SPEC §9）：

- **导入**：JSON / CSV / 粘贴三种入口；去重计数；沪教版 1179 / 64 / 0
- **调度**：新学 → stage=0；答对 stage 递增；答错降级；到期队列受 `dailyReviewCap` 截断
- **激励**：XP 累积；7 级称号；8 枚徽章判定；每日上限立即生效
- **拆解**：`unhappy` → `un-` + `happy`；`pollution` → `pollut` + `-ion`；`family` 不显示

## 📖 文档

完整规格见 [`SPEC.md`](./SPEC.md)（357 行）。包括：

- §2 技术栈 + 数据模型（7 个 IndexedDB store）
- §3 调度引擎规则（stage 阶梯）
- §4 功能规格（题型 / 导入 / 激励 / 词根 / 默写 / 错词本）
- §5 页面与路由（hash 路由 7 个页面）
- §6 UI 设计令牌（CSS 自定义属性）
- §7 PWA 规格
- §8 里程碑
- §9 测试计划
- §10 参考开源项目

## 🙏 致谢

词根词缀数据整理思路参考以下开源项目（不直接复制代码与素材）：

- [qwerty-learner](https://github.com/RealKai42/qwerty-learner) — 默写模式 + 错词本 + 美英音切换
- [word-root-workshop](https://github.com/joeseesun/word-root-workshop) — 词根词缀"搭积木"记忆法
- [engra](https://github.com/eslsoft/engra) — 社区词根词缀数据库
- [find-roots-of-word](https://github.com/excing/find-roots-of-word) — 拆解算法思路

算法升级方向：[FSRS](https://github.com/open-spaced-repetition/fsrs4anki) — 二期考虑替换固定阶梯。

## 📄 License

[MIT](./LICENSE) © 2026 BLAGICLAB

> 沪教版初中英语词库为公开教学资料，仅作为算法验证语料使用。