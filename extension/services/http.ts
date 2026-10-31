/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { ServiceError } from './settings';

export const DEEPSEEK_BASE = 'https://api.deepseek.com';
export const DICTIONARY_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

/** 请求间共享截止时间；每次上游读取（含 JSON body）也有独立超时。 */
export class RequestBudget {
  private deadline = Date.now() + 120_000;
  async json(url: string, init: RequestInit, timeout: number): Promise<unknown> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new ServiceError('请求超时，请重试');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeout, remaining));
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit' });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new ServiceError('API Key 无效或无访问权限，请检查配置', false);
        if (response.status === 402) throw new ServiceError('DeepSeek 账户余额不足，请充值后重试', false);
        if (response.status === 429) throw new ServiceError('请求过于频繁，请稍后再试', true, 4290);
        if (response.status >= 400 && response.status < 500) throw new ServiceError('请求被服务拒绝，请检查模型和配置', false);
        throw new ServiceError('AI 服务暂时不可用，请稍后重试');
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (controller.signal.aborted) throw new ServiceError('请求超时，请重试');
      if (error instanceof SyntaxError) throw new ServiceError('服务返回的数据格式有误，请重试');
      throw new ServiceError('网络连接失败，请检查网络后重试');
    } finally { clearTimeout(timer); }
  }
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
