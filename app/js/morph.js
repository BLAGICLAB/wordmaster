/**
 * morph.js — 词根词缀拆解引擎（M6 实现，见 SPEC §4.4）
 * 路线：精简词根词缀表（data/roots.json）+ 前缀剥离 + 后缀剥离 + 词根匹配。
 * 命中生成 parts 缓存入 morphology store；拆不出的词不显示任何内容；模块失败静默降级。
 */

// M6：loadRoots、splitWord(word) → parts | null、缓存读写
