/**
 * speech.js — 发音封装（Web Speech API，en-US 美音 / en-GB 英音）
 * 不支持 speechSynthesis 或播放失败时静默降级（§2.1）。M2 接入学习卡自动发音。
 */

import { getSetting } from './db.js';

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * 朗读英文文本（单词/短语）。发音偏好读 settings.voice（'en-US' | 'en-GB'，默认 'en-US'）。
 * 全部异常静默吞掉：发音是学习辅助，任何失败都不影响学习主流程。
 */
export async function speak(text) {
  try {
    if (!isSpeechSupported() || !text) return;
    let pref = 'en-US';
    try {
      pref = (await getSetting('voice', 'en-US')) || 'en-US';
    } catch {
      // 设置读取失败时用默认美音
    }
    const synth = window.speechSynthesis;
    synth.cancel(); // 先打断上一次朗读，避免排队叠加
    const utter = new SpeechSynthesisUtterance(String(text));
    utter.lang = pref === 'en-GB' ? 'en-GB' : 'en-US';
    utter.rate = 0.9;
    const voices = synth.getVoices() || [];
    const voice = voices.find((v) => v.lang === utter.lang)
      || voices.find((v) => v.lang && v.lang.replace('_', '-').startsWith(utter.lang.slice(0, 2)));
    if (voice) utter.voice = voice;
    synth.speak(utter);
  } catch {
    // 静默降级
  }
}
