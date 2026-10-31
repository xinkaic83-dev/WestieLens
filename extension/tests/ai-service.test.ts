/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiService } from '../services/ai-service';
import { createSettingsStore, SETTINGS_KEY, CACHE_KEY } from '../services/settings';
import { parseAnalysis, parseDictionary, ALL_FEATURES } from '../services/parsers';
import { cacheKey, createResultCache } from '../services/cache';

const TEXT = 'Although it was raining, we decided to go out.';
const ANALYSIS = {
  translation: '虽然下雨，我们还是出门了。', mainSentence: 'we decided to go out',
  clauses: [{ text: 'Although it was raining', type: 'adverbial_clause', label: '让步状语从句', explanation: '说明让步关系。' }],
  syntaxComponents: [{ text: 'we', component: 'subject', label: '主语', explanation: '行为发出者。' }], grammarPoints: [],
};
const INVALID_STRUCTURE = { ...ANALYSIS, clauses: [{ ...ANALYSIS.clauses[0], text: 'invented text' }] };
const DICTIONARY = [{ word: 'development', phonetic: '/test/',
  phonetics: [{ text: '/test/', audio: 'https://api.dictionaryapi.dev/media/development-us.mp3' }],
  meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'the process of developing' }] }] }];
let local: Record<string, unknown>;
let session: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function chat(content: unknown) { return response({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }); }
async function configured() {
  const settings = createSettingsStore();
  await settings.save('test-secret-api-key', 'deepseek-flash');
  return { settings, ai: createAiService(settings) };
}
const request = { type: 'analyze-requested', text: TEXT, inputType: 'analysis' } as const;

beforeEach(() => {
  local = {}; session = {}; fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const area = (memory: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: memory[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(memory, structuredClone(values)); }),
    remove: vi.fn(async (key: string) => { delete memory[key]; }),
  });
  vi.stubGlobal('browser', {
    storage: { local: { ...area(local), setAccessLevel: vi.fn().mockResolvedValue(undefined) }, session: area(session) },
    runtime: { getPlatformInfo: vi.fn().mockResolvedValue({}) },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('用户配置与密钥边界', () => {
  it('先限制 local 存储为可信上下文，脱敏状态不返回密钥', async () => {
    const { settings } = await configured();
    expect(browser.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect((local[SETTINGS_KEY] as { apiKey: string }).apiKey).toBe('test-secret-api-key');
    expect(JSON.stringify(await settings.status())).not.toContain('test-secret');
    expect(await settings.status()).toMatchObject({ configured: true, model: 'deepseek-flash' });
  });
  it('留空沿用密钥，修改模型轮换配置版本，清除同时删除缓存', async () => {
    const { settings } = await configured();
    const first = await settings.status();
    await settings.save('', 'deepseek-v4-pro');
    expect((await settings.read())?.apiKey).toBe('test-secret-api-key');
    expect((await settings.status()).revision).not.toBe(first.revision);
    session[CACHE_KEY] = ['cached'];
    await settings.clear();
    expect(await settings.status()).toMatchObject({ configured: false });
    expect(local[SETTINGS_KEY]).toBeUndefined(); expect(session[CACHE_KEY]).toBeUndefined();
  });
  it('存储保护失败时不保存密钥', async () => {
    vi.mocked(browser.storage.local.setAccessLevel).mockRejectedValueOnce(new Error('denied'));
    const store = createSettingsStore();
    await expect(store.save('test-secret-api-key', 'deepseek-flash')).rejects.toThrow();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
  it('未配置时不发网络请求，未知 features 提前拒绝', async () => {
    const ai = createAiService(createSettingsStore());
    expect(await ai.analyze(request)).toMatchObject({ ok: false, error: { retryable: false, message: '请先配置 DeepSeek API Key' } });
    expect(await ai.analyze({ ...request, features: ['unknown'] } as never)).toMatchObject({ ok: false, error: { code: 4003 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('测试连接只请求官方 /models，不保存临时密钥、不发送选区', async () => {
    const { ai } = await configured();
    const previous = structuredClone(local);
    fetchMock.mockResolvedValue(response({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
    expect(await ai.test('test-draft-secret', 'deepseek-flash')).toEqual({ models: ['deepseek-flash', 'deepseek-v4-pro'], selectedAvailable: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/models');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(local).toEqual(previous);
  });
});

describe('直连分析、重试与缓存', () => {
  it('官方请求携带配置密钥，关闭思考并启用 JSON，重复请求命中 session 缓存', async () => {
    const { ai } = await configured(); fetchMock.mockImplementation(async () => chat(ANALYSIS));
    expect(await ai.analyze(request)).toMatchObject({ ok: true, data: { partial: false, cached: false } });
    expect(await ai.analyze(request)).toMatchObject({ ok: true, data: { cached: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-secret-api-key');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(JSON.stringify(session)).not.toContain('test-secret-api-key');
  });
  it('恢复 Worker 后仍可读缓存；换模型/配置不复用旧缓存', async () => {
    const { ai, settings } = await configured(); fetchMock.mockImplementation(async () => chat(ANALYSIS));
    await ai.analyze(request);
    expect(await createAiService(settings).analyze(request)).toMatchObject({ ok: true, data: { cached: true } });
    await settings.save('', 'deepseek-v4-pro');
    await ai.analyze(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('结构错误仅重试一次，两次失败降级且不缓存', async () => {
    const { ai } = await configured(); fetchMock.mockImplementation(async () => chat(INVALID_STRUCTURE));
    expect(await ai.analyze(request)).toMatchObject({ ok: true, data: { partial: true, translation: ANALYSIS.translation, clauses: [], syntaxComponents: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session[CACHE_KEY]).toBeUndefined();
  });
  it('首次译文保留：重试非法 JSON 或上游故障不会丢掉译文', async () => {
    for (const second of [() => chat('not JSON'), () => response({}, 503)]) {
      const { ai } = await configured();
      fetchMock.mockReset().mockResolvedValueOnce(chat(INVALID_STRUCTURE)).mockImplementationOnce(second);
      expect(await ai.analyze(request)).toMatchObject({ ok: true, data: { partial: true, translation: ANALYSIS.translation } });
    }
  });
  it.each([401, 403, 402, 429, 503])('HTTP %s 不自动重试且不回显上游错误/密钥', async (status) => {
    const { ai } = await configured(); fetchMock.mockResolvedValue(response({ error: 'test-secret-api-key' }, status));
    const result = await ai.analyze(request);
    expect(result).toMatchObject({ ok: false, error: { retryable: status === 429 || status === 503 } });
    expect(JSON.stringify(result)).not.toContain('test-secret-api-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('翻译缺失最多两次后报错', async () => {
    const { ai } = await configured(); fetchMock.mockImplementation(async () => chat({}));
    expect(await ai.analyze(request)).toMatchObject({ ok: false, error: { code: 5001 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('配置清除后旧请求不能回填缓存', async () => {
    const { ai, settings } = await configured();
    let release!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = ai.analyze(request);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settings.clear();
    release(chat(ANALYSIS));
    expect(await pending).toMatchObject({ ok: true });
    expect(session[CACHE_KEY]).toBeUndefined();
  });
  it('features 部分请求仅返回需要的结构，空数组使用默认全集', () => {
    expect(parseAnalysis(TEXT, JSON.stringify(INVALID_STRUCTURE), ['translation'])).toMatchObject({ partial: false, mainSentence: '', clauses: [] });
    expect(parseAnalysis(TEXT, JSON.stringify(INVALID_STRUCTURE), ALL_FEATURES)).toMatchObject({ partial: true });
  });
  it('模型非法片段、空翻译、数组错误均被识别', () => {
    expect(parseAnalysis(TEXT, 'null', ALL_FEATURES)).toBeNull();
    expect(parseAnalysis(TEXT, JSON.stringify({ translation: '' }), ALL_FEATURES)).toBeNull();
    expect(parseAnalysis(TEXT, JSON.stringify({ ...ANALYSIS, clauses: [null] }), ALL_FEATURES)).toMatchObject({ partial: true });
  });
});

describe('词典归一化、中文补全和 AI 兜底', () => {
  it('词典提供 IPA/音频，模型按序补中文；词典请求不携带密钥', async () => {
    const { ai } = await configured(); fetchMock.mockResolvedValueOnce(response(DICTIONARY)).mockResolvedValueOnce(chat({ meanings: ['发展；开发'] }));
    expect(await ai.analyze({ ...request, text: 'development', inputType: 'word' })).toMatchObject({ ok: true, data: {
      source: 'dictionary', phoneticSource: 'dictionary', definitions: [{ pos: 'n.', meaning: '发展；开发' }], definitionLanguage: 'zh',
    } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/development');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
  it('中文补全失败保留英文并标注，不缓存临时降级结果', async () => {
    const { ai } = await configured(); fetchMock.mockResolvedValueOnce(response(DICTIONARY)).mockResolvedValueOnce(response({}, 503));
    expect(await ai.analyze({ ...request, text: 'development', inputType: 'word' })).toMatchObject({ ok: true, data: { definitionLanguage: 'en' } });
    expect(session[CACHE_KEY]).toBeUndefined();
  });
  it('词典未命中走 AI 释义，音标标记来源且允许 TTS', async () => {
    const { ai } = await configured(); fetchMock.mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(chat({ phoneticUs: '/test/', definitions: [{ pos: 'n.', meaning: '发展' }] }));
    expect(await ai.analyze({ ...request, text: 'development', inputType: 'word' })).toMatchObject({ ok: true, data: { source: 'ai_fallback', phoneticSource: 'ai_generated', fallbackTts: true, audioUsUrl: '' } });
  });
  it('AI 没有可用释义时返回不可重试查无此词', async () => {
    const { ai } = await configured(); fetchMock.mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(chat({ definitions: [] }));
    expect(await ai.analyze({ ...request, text: 'development', inputType: 'word' })).toMatchObject({ ok: false, error: { code: 5002, retryable: false } });
  });
  it('非英美地域音频不冒充英美，非法音频协议被丢弃', () => {
    const parsed = parseDictionary([{ ...DICTIONARY[0], phonetic: undefined, phonetics: [
      { text: '/au/', audio: 'https://example.test/read-au.mp3' }, { text: '/x/', audio: 'javascript:alert(1)' },
    ] }]);
    expect(parsed).toMatchObject({ audioUkUrl: '', audioUsUrl: '', phoneticUk: '/x/' });
  });
});

describe('缓存 TTL 和容量', () => {
  it('24 小时后失效，有界容量不超过 1000', async () => {
    vi.useFakeTimers();
    const cache = createResultCache(); const value = parseAnalysis(TEXT, JSON.stringify(ANALYSIS), ALL_FEATURES)!;
    session[CACHE_KEY] = Array.from({ length: 1000 }, (_, i) => ({ key: String(i), expires: Date.now() + 86_400_000, value }));
    await cache.put('new', value, async () => true);
    expect((session[CACHE_KEY] as unknown[]).length).toBe(1000);
    expect(await cache.get('0')).toBeNull();
    expect(await cache.get('new')).toMatchObject({ cached: true });
    await vi.advanceTimersByTimeAsync(86_400_001);
    expect(await cache.get('new')).toBeNull();
  });
  it('cacheKey 隐藏原文，包含模型与配置版本', async () => {
    expect(await cacheKey(['model-a', TEXT])).not.toBe(await cacheKey(['model-b', TEXT]));
    expect(await cacheKey(['model-a', TEXT])).toMatch(/^[a-f0-9]{64}$/);
  });
});
