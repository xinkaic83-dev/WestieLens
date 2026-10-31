/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/**
 * 选区文本过滤单测（§4.1.2 / v0.1 DoD）。
 */
import { describe, expect, it } from 'vitest';
import { filterSelection, MAX_SELECTION_LENGTH } from '../utils/filter';

describe('filterSelection', () => {
  it('接受含英文的选区并 trim', () => {
    const result = filterSelection('  hello world \n');
    expect(result).toEqual({ accept: true, text: 'hello world', length: 11 });
  });

  it('中英混排含英文字母可上报', () => {
    const result = filterSelection('使用 Spring Boot 框架');
    expect(result.accept).toBe(true);
  });

  it('空选区拦截', () => {
    expect(filterSelection('')).toEqual({ accept: false, reason: 'empty' });
    expect(filterSelection('   \n  ')).toEqual({ accept: false, reason: 'empty' });
  });

  it('纯数字/纯符号拦截（no-english）', () => {
    expect(filterSelection('12345')).toEqual({ accept: false, reason: 'no-english' });
    expect(filterSelection('你好世界')).toEqual({ accept: false, reason: 'no-english' });
    expect(filterSelection('———！！！')).toEqual({ accept: false, reason: 'no-english' });
  });

  it('超过 500 字符拦截（too-long）', () => {
    const long = 'a'.repeat(MAX_SELECTION_LENGTH + 1);
    expect(filterSelection(long)).toEqual({ accept: false, reason: 'too-long' });
  });

  it('恰好 500 字符允许通过', () => {
    const exact = 'a'.repeat(MAX_SELECTION_LENGTH);
    const result = filterSelection(exact);
    expect(result.accept).toBe(true);
  });
});
