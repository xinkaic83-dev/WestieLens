/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/**
 * 词句路由规则单测（§4.1.3 / v0.1 DoD）。
 * 插件直连链路与面板预览共用此路由。
 */
import { describe, expect, it } from 'vitest';
import { suggestRoute } from '../utils/routing';

describe('suggestRoute', () => {
  it('单个英文单词建议查词', () => {
    expect(suggestRoute('development')).toBe('word');
    expect(suggestRoute('a')).toBe('word');
    expect(suggestRoute('Software')).toBe('word');
  });

  it('连字符/撇号词建议查词', () => {
    expect(suggestRoute('ice-cream')).toBe('word');
    expect(suggestRoute("don't")).toBe('word');
  });

  it('无标点多词默认分析，用户可手动查短语', () => {
    expect(suggestRoute('the development of software systems')).toBe('analysis');
    expect(suggestRoute('How are you')).toBe('analysis');
  });

  it('含标点多词文本建议句子分析', () => {
    // 3 个词但是完整句子
    expect(suggestRoute('How are you?')).toBe('analysis');
    expect(suggestRoute('Although it was raining, we decided to go out.')).toBe('analysis');
  });

  it('单词带句末标点走分析（Prompt 允许非完整句子）', () => {
    expect(suggestRoute('hello.')).toBe('analysis');
  });

  it('空文本回退分析路由', () => {
    expect(suggestRoute('   ')).toBe('analysis');
  });
});
