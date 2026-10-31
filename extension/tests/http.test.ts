/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { afterEach, expect, it, vi } from 'vitest';
import { RequestBudget } from '../services/http';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('读取超时会中止 fetch，返回脱敏超时错误并释放定时器', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('private-input')));
  })));
  const pending = new RequestBudget().json('https://api.deepseek.com/models', {}, 15000);
  const rejected = expect(pending).rejects.toThrow('请求超时，请重试');
  await vi.advanceTimersByTimeAsync(15000); await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it('总预算耗尽后不发下一次网络请求', async () => {
  vi.useFakeTimers(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const budget = new RequestBudget();
  await vi.advanceTimersByTimeAsync(120001);
  await expect(budget.json('https://api.deepseek.com/models', {}, 15000)).rejects.toThrow('请求超时');
  expect(fetch).not.toHaveBeenCalled();
});
