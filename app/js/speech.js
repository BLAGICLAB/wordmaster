/**
 * speech.js — 发音封装（Web Speech API，en-US 美音 / en-GB 英音）
 * 不支持 speechSynthesis 时静默降级。M2 接入学习卡自动发音。
 */

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// M2：speak(word, { voice: 'en-US' | 'en-GB' })、voice 偏好读取 settings.voice
