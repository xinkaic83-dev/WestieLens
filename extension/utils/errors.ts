/**
 * 错误码 → 中文文案映射（§4.7 / §5.2），保留原有通用错误字典。
 * 直连服务返回脱敏中文原因，未知 code 保留服务提供的固定文案。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import type { ApiErrorCode } from './api-types';

export const ERROR_CODE_MESSAGES: Record<ApiErrorCode, string> = {
  4001: '选中文本过长，请缩短后重试',
  4002: '请选中英文文本',
  4003: '请求参数有误',
  // 说明书 §4.7 未覆盖限流场景，后端以 4290 返回，retryable=true
  4290: '请求过于频繁，请稍后再试',
  5001: 'AI 暂时无法完成翻译，请重试',
  5002: '未查到可靠词条，请尝试其他词形',
  5003: '网络异常，请检查网络后重试',
  5004: '服务异常，请重试',
};

/**
 * 按 code 映射文案；未知 code 回退后端原文或通用异常文案（5004 语义）。
 */
export function mapErrorMessage(code: number | undefined, backendMessage?: string): string {
  if (code !== undefined && code in ERROR_CODE_MESSAGES) {
    return ERROR_CODE_MESSAGES[code as ApiErrorCode];
  }
  return backendMessage ?? ERROR_CODE_MESSAGES[5004];
}
