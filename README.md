# 单词通 (WordMaster)

纯静态 PWA 背单词应用，面向初高中学生。零后端、零依赖、零成本。

## 核心特性

- 间隔重复调度（改良艾宾浩斯）
- 三种测验题型（看词选义 / 看义拼词 / 听音辨词）
- 打卡 streak + XP 等级 + 8 枚徽章
- 词根词缀拆解辅助
- 默写模式 + 错词本
- 完整数据导出/导入备份
- PWA，可添加到主屏幕，离线可用

## 文档

完整开发规格见 [`SPEC.md`](./SPEC.md)。本文档是开发的唯一依据，严格按 M1 → M6 顺序实现。

## 技术栈

- 原生 HTML + CSS + ES Module JS（无框架 / 无构建）
- IndexedDB 本地存储（库名 `wordmaster`）
- Web Speech API 发音
- PWA（manifest + Service Worker，cache-first）

## 本地运行

```bash
cd app
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 部署

任意静态托管：GitHub Pages / Netlify / Vercel / 本机 Nginx 等。仅静态文件。

## License

词根词缀数据来源见 [SPEC §10](./SPEC.md#10-附录参考的开源项目)。基于开源项目整理须在「关于」页注明来源与 license。