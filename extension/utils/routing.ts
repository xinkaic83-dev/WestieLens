/**
 * 插件词句路由规则：单词查词，多词默认分析（用户可切换）。
 * 前端用它对预览文本给出"查词/句子分析"的建议；用户手动选择优先于建议。
 * 纯函数，Vitest 单测覆盖。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import type { InputType } from './api-types';

/** 单词：纯字母，允许内部连字符/撇号（ice-cream、don't），首尾必须是字母 */
const SINGLE_WORD = /^[A-Za-z]+(['-][A-Za-z]+)*$/;

/** 单个词默认查词，多词默认分析；用户可在面板手动切换。 */
export function suggestRoute(trimmedText: string): InputType {
  return SINGLE_WORD.test(trimmedText.trim()) ? 'word' : 'analysis';
}
