/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/** 配置只由 Background 读写，面板只收到脱敏状态。 */
export const SETTINGS_KEY = 'aiSettings';
export const CACHE_KEY = 'aiResultCache';
export const DEFAULT_MODEL = 'deepseek-flash';
export interface AiSettings { apiKey: string; model: string; revision: string }
export interface SettingsStatus { configured: boolean; model: string; revision: string }

export class ServiceError extends Error {
  constructor(message: string, public retryable = true, public code?: number) { super(message); }
}
export function safeError(error: unknown) {
  return error instanceof ServiceError
    ? { message: error.message, retryable: error.retryable, code: error.code }
    : { message: '操作失败，请重新尝试', retryable: true };
}
export function validateModel(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value);
}
export function validateKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{8,512}$/.test(value);
}

export function createSettingsStore() {
  // local 默认可供 Content Script 访问，先收紧再读写；失败时不保存密钥。
  const ready = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void ready.catch(() => {});
  let queue = Promise.resolve();
  async function read(): Promise<AiSettings | null> {
    await ready;
    const value = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<AiSettings> | undefined;
    return value && validateKey(value.apiKey) && validateModel(value.model) && typeof value.revision === 'string'
      ? value as AiSettings : null;
  }
  async function status(): Promise<SettingsStatus> {
    const value = await read();
    return { configured: !!value, model: value?.model ?? DEFAULT_MODEL, revision: value?.revision ?? '' };
  }
  function mutate(action: () => Promise<SettingsStatus>) {
    const task = queue.catch(() => {}).then(action);
    queue = task.then(() => {}, () => {});
    return task;
  }
  return {
    read, status,
    save(apiKey: unknown, model: unknown) {
      return mutate(async () => {
        if (!validateModel(model)) throw new ServiceError('请选择有效模型', false);
        const previous = await read();
        const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : previous?.apiKey;
        if (!validateKey(key)) throw new ServiceError('请填写有效的 API Key', false);
        await browser.storage.session.remove(CACHE_KEY);
        await browser.storage.local.set({ [SETTINGS_KEY]: { apiKey: key, model, revision: crypto.randomUUID() } });
        return status();
      });
    },
    clear() {
      return mutate(async () => {
        await ready;
        await browser.storage.local.remove(SETTINGS_KEY);
        await browser.storage.session.remove(CACHE_KEY);
        return status();
      });
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;
