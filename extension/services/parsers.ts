/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import type { AnalyzeResponse, Feature, WordDetail } from '~/utils/api-types';
import { object } from './http';

export const ALL_FEATURES: Feature[] = ['translation', 'clauses', 'syntax', 'grammar'];
export function normalizeFeatures(features?: Feature[]): Feature[] {
  return [...new Set(features?.length ? features : ALL_FEATURES)].sort();
}
function text(value: unknown, max: number, required = true): string | null {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0) ? value : null;
}
export function parseAnalysis(original: string, output: string, features: Feature[]): AnalyzeResponse | null {
  let root: unknown;
  try { root = JSON.parse(output); } catch { return null; }
  if (!object(root)) return null;
  const translation = text(root.translation, 1000);
  if (!translation) return null;
  const result: AnalyzeResponse = { text: original, translation, mainSentence: '', clauses: [], syntaxComponents: [], grammarPoints: [], partial: false, cached: false };
  const specs = [
    ['clauses', 'clauses', ['type', 'label', 'explanation'], 20],
    ['syntaxComponents', 'syntax', ['component', 'label', 'explanation'], 20],
    ['grammarPoints', 'grammar', ['name', 'explanation'], 10],
  ] as const;
  for (const [field, feature, required, limit] of specs) {
    if (!features.includes(feature)) continue;
    const values = root[field] ?? [];
    if (!Array.isArray(values) || values.length > limit || values.some((item) =>
      !object(item) || !text(item.text, 500) || !original.includes(item.text as string)
      || required.some((key) => !text(item[key], key === 'explanation' ? 1000 : 100)))) {
      result.partial = true;
      break;
    }
    // 字段已逐项校验，仅提取 DTO 字段，不透传任意模型字段。
    const projected = values.map((item) => Object.fromEntries(['text', ...required].map((key) => [key, item[key]])));
    Object.assign(result, { [field]: projected });
  }
  if (result.partial) {
    result.clauses = []; result.syntaxComponents = []; result.grammarPoints = [];
  } else if (features.some((feature) => feature !== 'translation')) {
    result.mainSentence = text(root.mainSentence, 500, false) ?? '';
  }
  return result;
}

const POS: Record<string, string> = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', pronoun: 'pron.', conjunction: 'conj.', preposition: 'prep.', determiner: 'det.', interjection: 'int.', exclamation: 'int.' };
export interface DictionaryEntry {
  phoneticUk: string; phoneticUs: string; audioUkUrl: string; audioUsUrl: string;
  glosses: { pos: string; definition: string }[];
}
function safeAudio(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function parseDictionary(value: unknown): DictionaryEntry | null {
  if (!Array.isArray(value) || !object(value[0])) return null;
  const entry = value[0];
  const result: DictionaryEntry = { phoneticUk: '', phoneticUs: '', audioUkUrl: '', audioUsUrl: '', glosses: [] };
  const seen = new Set<string>();
  for (const meaning of Array.isArray(entry.meanings) ? entry.meanings : []) {
    if (!object(meaning)) continue;
    for (const definition of Array.isArray(meaning.definitions) ? meaning.definitions : []) {
      if (!object(definition)) continue;
      const value = text(definition.definition, 1000)?.trim();
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      const pos = typeof meaning.partOfSpeech === 'string' ? meaning.partOfSpeech.slice(0, 50) : '';
      result.glosses.push({ pos: POS[pos.toLowerCase()] ?? pos, definition: value });
      if (result.glosses.length >= 5) break;
    }
    if (result.glosses.length >= 5) break;
  }
  if (!result.glosses.length) return null;
  let neutral = text(entry.phonetic, 60) ?? '';
  let neutralAudio = safeAudio(entry.audio);
  for (const phonetic of Array.isArray(entry.phonetics) ? entry.phonetics : []) {
    if (!object(phonetic)) continue;
    const audio = safeAudio(phonetic.audio);
    const ipa = text(phonetic.text, 60) ?? '';
    const region = audio ? /[-_]([a-z]{2})\.[a-z0-9]+$/i.exec(new URL(audio).pathname)?.[1]?.toLowerCase() : undefined;
    if (region === 'uk' || region === 'gb') {
      result.phoneticUk ||= ipa; result.audioUkUrl ||= audio;
    } else if (region === 'us') {
      result.phoneticUs ||= ipa; result.audioUsUrl ||= audio;
    } else if (!region) {
      neutral ||= ipa; neutralAudio ||= audio;
    }
  }
  result.phoneticUk ||= neutral; result.phoneticUs ||= neutral;
  if (!result.audioUkUrl && !result.audioUsUrl) result.audioUsUrl = neutralAudio;
  return result;
}
export function dictionaryResult(word: string, entry: DictionaryEntry, meanings: string[] | null): WordDetail {
  return {
    word, phoneticUk: entry.phoneticUk, phoneticUs: entry.phoneticUs, audioUkUrl: entry.audioUkUrl, audioUsUrl: entry.audioUsUrl,
    definitions: entry.glosses.map((gloss, index) => ({ pos: gloss.pos, meaning: (meanings?.[index] ?? gloss.definition).slice(0, 200) })),
    source: 'dictionary', phoneticSource: entry.phoneticUk || entry.phoneticUs ? 'dictionary' : 'unavailable',
    fallbackTts: !entry.audioUkUrl && !entry.audioUsUrl, cached: false, definitionLanguage: meanings ? 'zh' : 'en',
  };
}
export function parseMeanings(output: string, size: number): string[] | null {
  try {
    const root: unknown = JSON.parse(output);
    return object(root) && Array.isArray(root.meanings) && root.meanings.length === size
      && root.meanings.every((value) => text(value, 100)) ? root.meanings as string[] : null;
  } catch { return null; }
}
export function parseAiWord(word: string, output: string): WordDetail | null {
  try {
    const root: unknown = JSON.parse(output);
    if (!object(root) || !Array.isArray(root.definitions)) return null;
    const definitions = root.definitions.filter((item) => object(item) && text(item.meaning, 100))
      .slice(0, 4).map((item) => ({ pos: text(item.pos, 50, false) ?? '', meaning: item.meaning as string }));
    if (!definitions.length) return null;
    const phoneticUk = text(root.phoneticUk, 60, false) ?? '';
    const phoneticUs = text(root.phoneticUs, 60, false) ?? '';
    return { word, phoneticUk, phoneticUs, audioUkUrl: '', audioUsUrl: '', definitions, source: 'ai_fallback',
      phoneticSource: phoneticUk || phoneticUs ? 'ai_generated' : 'unavailable', fallbackTts: true, cached: false, definitionLanguage: 'zh' };
  } catch { return null; }
}
