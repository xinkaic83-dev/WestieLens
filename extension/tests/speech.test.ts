/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEECH, englishVoices, normalizeSpeechPreferences, selectVoice, speechChunks } from '../utils/speech';
const make = (name: string, lang = 'en-US', localService = true) => ({ name, lang, localService, voiceURI: name, default: false });
const voices = [make('Chinese', 'zh-CN'), make('Boing'), make('Samantha'), make('Daniel', 'en-GB'), make('Ava (Enhanced)')];
describe('英文音色选择', () => {
  it('仅选择英文音色，优先指定口音及增强音色，避免娱乐声音', () => {
    expect(englishVoices(voices, 'en-US').map((v) => v.name)).toEqual(['Ava (Enhanced)', 'Samantha', 'Boing', 'Daniel']);
    expect(selectVoice(voices, { ...DEFAULT_SPEECH, accent: 'en-GB' })?.name).toBe('Daniel');
  });
  it('尊重用户明确选择；保存音色失效时回退可用英文音色', () => {
    expect(selectVoice(voices, { ...DEFAULT_SPEECH, voiceURI: 'Samantha' })?.name).toBe('Samantha');
    expect(selectVoice(voices, { ...DEFAULT_SPEECH, voiceURI: 'Removed' })?.name).toBe('Ava (Enhanced)');
    expect(selectVoice([make('Chinese', 'zh-CN')], DEFAULT_SPEECH)).toBeNull();
  });
  it('识别 en_US，并且不会修改浏览器返回的原数组', () => {
    const list = [make('British', 'en_GB'), make('American', 'en_US')];
    expect(englishVoices(list, 'en-US')[0]?.name).toBe('American');
    expect(list[0]?.name).toBe('British');
  });
});
describe('朗读偏好与分段', () => {
  it('校验保存的偏好，不接受过快语速或任意来源', () => {
    expect(normalizeSpeechPreferences(null)).toEqual(DEFAULT_SPEECH);
    expect(normalizeSpeechPreferences({ rate: 30, accent: 'zh-CN', source: 'remote-url' })).toEqual(DEFAULT_SPEECH);
    expect(normalizeSpeechPreferences({ rate: 0.9, accent: 'en-GB', source: 'dictionary', voiceURI: 'Daniel' }))
      .toEqual({ rate: 0.9, accent: 'en-GB', source: 'dictionary', voiceURI: 'Daniel' });
  });
  it('长句按自然边界分段，不漏词、不增加内容', () => {
    const text = 'Although it was raining, we decided to go out. '.repeat(9).trim();
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 131)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
    expect(speechChunks('   ')).toEqual([]);
    expect(speechChunks('Hello world.')).toEqual(['Hello world.']);
  });
});
