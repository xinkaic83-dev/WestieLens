/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/** 单词和句子共用的朗读偏好；不包含 API Key。 */
export const SPEECH_SETTINGS_KEY = 'speechPreferences';
export const SPEECH_PREFERENCES_EVENT = 'readwise-speech-preferences';
export const PANEL_HIDDEN_EVENT = 'readwise:panel-hidden';
export interface SpeechPreferences {
  accent: 'en-US' | 'en-GB';
  voiceURI: string;
  rate: number;
  source: 'system' | 'dictionary';
}
export const DEFAULT_SPEECH: SpeechPreferences = { accent: 'en-US', voiceURI: '', rate: 1, source: 'system' };
export const SPEECH_RATES = [0.75, 0.9, 1, 1.1, 1.25];
export function normalizeSpeechPreferences(value: unknown): SpeechPreferences {
  const v = typeof value === 'object' && value !== null ? value as Partial<SpeechPreferences> : {};
  return {
    accent: v.accent === 'en-GB' ? 'en-GB' : 'en-US',
    voiceURI: typeof v.voiceURI === 'string' && v.voiceURI.length <= 1000 ? v.voiceURI : '',
    rate: typeof v.rate === 'number' && SPEECH_RATES.includes(v.rate) ? v.rate : 1,
    source: v.source === 'dictionary' ? 'dictionary' : 'system',
  };
}
export function englishVoices<T extends Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'voiceURI' | 'localService' | 'default'>>(voices: T[], accent: string): T[] {
  const lang = (voice: T) => voice.lang.replaceAll('_', '-').toLowerCase();
  const score = (voice: T) => {
    let value = lang(voice) === accent.toLowerCase() ? 1000 : 0;
    if (/enhanced|premium|natural|neural/i.test(voice.name)) value += 100;
    // 自动选择优先常规本机音色，避免默认中文或娱乐音色；用户仍可自行试听选择。
    if (voice.localService) value += 40;
    if (/samantha|daniel|karen|moira|serena|ava|allison|tom|susan|google|microsoft/i.test(voice.name)) value += 20;
    if (voice.default) value += 5;
    if (/bad news|good news|bahh|boing|bubbles|cellos|hysterical|pipe organ|trinoids|whisper|wobble|zarvox|bells/i.test(voice.name)) value -= 500;
    return value;
  };
  return voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}
export function selectVoice<T extends Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'voiceURI' | 'localService' | 'default'>>(voices: T[], preferences: SpeechPreferences): T | null {
  const ranked = englishVoices(voices, preferences.accent);
  return ranked.find((voice) => voice.voiceURI === preferences.voiceURI) ?? ranked[0] ?? null;
}
/** 按标点/空格拆短段，避免部分引擎对长 utterance 的截断；不增加朗读内容。 */
export function speechChunks(text: string, maxLength = 130): string[] {
  let remaining = text.trim();
  const result: string[] = [];
  while (remaining.length > maxLength) {
    const prefix = remaining.slice(0, maxLength + 1);
    const boundaries = [...prefix.matchAll(/[.!?;:,]\s+|\s+/g)];
    const preferred = boundaries.filter((match) => /[.!?;:,]/.test(match[0]) && match.index! > maxLength / 3);
    const boundary = preferred.at(-1) ?? boundaries.at(-1);
    const at = boundary && boundary.index! > 0 ? boundary.index! + boundary[0].length : maxLength;
    result.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}
