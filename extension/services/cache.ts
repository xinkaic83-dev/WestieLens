/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { isAnalyzeResult, type AnalyzeResult } from '~/utils/api-types';
import { CACHE_KEY } from './settings';
interface Entry { key: string; expires: number; value: AnalyzeResult }
const TTL = 24 * 60 * 60 * 1000;
export async function cacheKey(parts: unknown[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function createResultCache() {
  let queue = Promise.resolve();
  async function entries(): Promise<Entry[]> {
    const stored: unknown = (await browser.storage.session.get(CACHE_KEY))[CACHE_KEY];
    return Array.isArray(stored) ? stored.filter((item): item is Entry =>
      typeof item?.key === 'string' && item.expires > Date.now() && isAnalyzeResult(item.value)) : [];
  }
  return {
    async get(key: string): Promise<AnalyzeResult | null> {
      try {
        const hit = (await entries()).find((item) => item.key === key);
        return hit ? { ...hit.value, cached: true } : null;
      } catch { return null; } // 缓存故障不阻塞分析。
    },
    put(key: string, value: AnalyzeResult, stillCurrent: () => Promise<boolean>) {
      const next = queue.catch(() => {}).then(async () => {
        const list = (await entries()).filter((item) => item.key !== key);
        list.push({ key, value, expires: Date.now() + TTL });
        while (list.length > 1000 || JSON.stringify(list).length > 2_000_000) list.shift();
        // 配置可能在等待缓存读写队列时变化，提交前再次核对。
        if (await stillCurrent()) {
          await browser.storage.session.set({ [CACHE_KEY]: list });
          if (!(await stillCurrent())) await browser.storage.session.remove(CACHE_KEY);
        }
      }).catch(() => {});
      queue = next;
      return next;
    },
  };
}
