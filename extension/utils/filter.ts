/**
 * 选区文本过滤规则（§4.1.2）：仅含英文字母、trim 后 ≤500 字符的选区才上报。
 * 纯数字、纯符号、空选区在预览阶段即拦截；超长文本给出明确提示。
 * 纯函数，Vitest 单测覆盖。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

export const MAX_SELECTION_LENGTH = 500;

export type FilterResult =
  | { accept: true; text: string; length: number }
  | { accept: false; reason: 'empty' | 'no-english' | 'too-long' };

const ENGLISH_PATTERN = /[a-zA-Z]/;

/**
 * 对原始选区字符串做上报前过滤。
 */
export function filterSelection(raw: string): FilterResult {
  const text = (raw ?? '').trim();
  if (text === '') {
    return { accept: false, reason: 'empty' };
  }
  if (!ENGLISH_PATTERN.test(text)) {
    return { accept: false, reason: 'no-english' };
  }
  if (text.length > MAX_SELECTION_LENGTH) {
    return { accept: false, reason: 'too-long' };
  }
  return { accept: true, text, length: text.length };
}

/** 过滤拒绝原因 → 中文提示文案（与 §4.7 错误码语义对齐，前端本地拦截） */
export const FILTER_REASON_MESSAGES: Record<'empty' | 'no-english' | 'too-long', string> = {
  empty: '未检测到选中文本',
  'no-english': '请选中英文文本',
  'too-long': '选中文本过长（超过 500 字符），请缩短后重试',
};
