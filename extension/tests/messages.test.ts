/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/**
 * 消息协议载荷校验单测（§9.1 / §9.2）：未知类型必须拒绝，Background 不信任任意对象。
 */
import { describe, expect, it } from 'vitest';
import { isKnownMessage, isPanelSender, panelTabId, isValidAnalyzePayload, isValidSelectionPayload } from '../utils/messages';

describe('标签页面板来源', () => {
  const panel = 'chrome-extension://test/sidepanel.html';
  it('接受精确面板地址和唯一规范 tabId 参数', () => {
    for (const url of [panel, `${panel}?tabId=12`]) expect(isPanelSender({ id: 'test', url }, 'test', panel)).toBe(true);
    expect(panelTabId(`${panel}?tabId=12`)).toBe(12);
  });
  it('拒绝伪造来源、额外参数、hash、重复或非法 tabId', () => {
    for (const url of [`${panel}?tabId=-1`, `${panel}?tabId=01`, `${panel}?tabId=1&tabId=2`, `${panel}?tabId=1&x=y`, `${panel}?tabId=1#x`, `${panel}?tabId=9007199254740992`, panel.replace('sidepanel', 'options') + '?tabId=1']) {
      expect(isPanelSender({ id: 'test', url }, 'test', panel)).toBe(false);
    }
    expect(isPanelSender({ id: 'external', url: `${panel}?tabId=1` }, 'test', panel)).toBe(false);
  });
});

describe('isKnownMessage', () => {
  it('接受已登记消息类型', () => {
    expect(isKnownMessage({ type: 'selection-updated' })).toBe(true);
    expect(isKnownMessage({ type: 'get-latest-selection' })).toBe(true);
    expect(isKnownMessage({ type: 'analyze-requested' })).toBe(true);
  });

  it('拒绝未登记类型与非法输入', () => {
    expect(isKnownMessage({ type: 'unknown-action' })).toBe(false);
    expect(isKnownMessage({})).toBe(false);
    expect(isKnownMessage(null)).toBe(false);
    expect(isKnownMessage('selection-updated')).toBe(false);
  });
});

describe('isValidSelectionPayload', () => {
  it('合法载荷通过', () => {
    expect(
      isValidSelectionPayload({
        type: 'selection-updated',
        text: 'hello world',
        length: 11,
        url: 'https://example.com',
      }),
    ).toBe(true);
  });

  it('空文本/超长/字段缺失拒绝', () => {
    expect(isValidSelectionPayload({ type: 'selection-updated', text: '', length: 0, url: 'x' })).toBe(false);
    expect(
      isValidSelectionPayload({ type: 'selection-updated', text: 'a'.repeat(501), length: 501, url: 'x' }),
    ).toBe(false);
    expect(isValidSelectionPayload({ type: 'selection-updated', text: 'ok' })).toBe(false);
  });
});

describe('isValidAnalyzePayload', () => {
  it('三种 inputType 白名单通过，未知值拒绝', () => {
    for (const inputType of ['word', 'analysis', 'auto']) {
      expect(isValidAnalyzePayload({ type: 'analyze-requested', text: 'hello', inputType })).toBe(true);
    }
    expect(isValidAnalyzePayload({ type: 'analyze-requested', text: 'hello', inputType: 'sentence' })).toBe(false);
  });

  it('features 必须为字符串数组或省略', () => {
    expect(
      isValidAnalyzePayload({ type: 'analyze-requested', text: 'hello', inputType: 'analysis', features: ['translation'] }),
    ).toBe(true);
    expect(
      isValidAnalyzePayload({ type: 'analyze-requested', text: 'hello', inputType: 'analysis', features: [1, 2] }),
    ).toBe(false);
  });

  it('空白或超长文本拒绝（服务端校验为准，本地先拦一道）', () => {
    expect(isValidAnalyzePayload({ type: 'analyze-requested', text: '   ', inputType: 'word' })).toBe(false);
    expect(isValidAnalyzePayload({ type: 'analyze-requested', text: 'a'.repeat(501), inputType: 'word' })).toBe(false);
  });
});

describe('消息载荷边界', () => {
  it('拒绝错误字符数、非英文选区与无效 URL', () => {
    const valid = { type: 'selection-updated', text: 'hello', length: 5, url: 'https://example.com' };
    for (const invalid of [{ ...valid, length: 4 }, { ...valid, text: '你好', length: 2 }, { ...valid, url: 'http://' }, { ...valid, text: ' hello ', length: 7 }]) {
      expect(isValidSelectionPayload(invalid)).toBe(false);
    }
  });
  it('拒绝未登记的功能值', () => {
    expect(isValidAnalyzePayload({ type: 'analyze-requested', text: 'hello', inputType: 'word', features: ['unknown'] })).toBe(false);
  });
});
