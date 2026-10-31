/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import type { MessageSender } from '../utils/messages';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const extensionId = 'test-extension';
const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
const pageUrl = 'https://example.com/article';
const contentSender = { id: extensionId, frameId: 0, url: pageUrl, tab: { id: 1, url: pageUrl } };
const panelSender = { id: extensionId, url: panelUrl };
const selection = { type: 'selection-updated', text: 'hello', length: 5, url: pageUrl };
let onMessage: Function;
let onUpdated: Function;
let onRemoved: Function;
let onTabCreated: Function;
let onInstalled: Function;
let onStartup: Function;
let memory: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let activeTab: number;

async function message(payload: unknown, sender: MessageSender = panelSender) {
  let response: unknown;
  const asyncResponse = onMessage(payload, sender, (value: unknown) => { response = value; });
  // 等待标签页存储队列与 Promise 链完成，不依赖真实计时器。
  for (let i = 0; i < 30; i++) await Promise.resolve();
  return { response, asyncResponse };
}

beforeEach(async () => {
  vi.resetModules();
  memory = {};
  activeTab = 1;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('defineBackground', (setup: Function) => setup());
  vi.stubGlobal('browser', {
    runtime: {
      id: extensionId, getURL: () => panelUrl,
      onMessage: { addListener: (fn: Function) => { onMessage = fn; } },
      onInstalled: { addListener: (fn: Function) => { onInstalled = fn; } },
      onStartup: { addListener: (fn: Function) => { onStartup = fn; } },
    },
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      setOptions: vi.fn().mockResolvedValue(undefined),
    },
    contextMenus: {
      onClicked: { addListener: vi.fn() },
      update: vi.fn().mockResolvedValue(undefined),
      create: vi.fn((_properties, callback) => { callback(); return 'readwise-analyze-selection'; }),
    },
    tabs: {
      query: vi.fn(async ({ windowId }: { windowId: number }) => [{ id: windowId === 2 ? 2 : activeTab }]),
      get: vi.fn(async (id: number) => ({ id, windowId: id === 2 ? 2 : 1 })),
      onUpdated: { addListener: (fn: Function) => { onUpdated = fn; } },
      onRemoved: { addListener: (fn: Function) => { onRemoved = fn; } },
      onCreated: { addListener: (fn: Function) => { onTabCreated = fn; } },
    },
    storage: { local: {
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
    }, session: {
      get: vi.fn(async (key: string) => ({ [key]: memory[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(memory, values); }),
      remove: vi.fn(async (key: string) => { delete memory[key]; }),
    } },
  });
  await import('../entrypoints/background');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Background 消息与选区隔离', () => {
  it('前台和后台新标签页都配置独立面板，不关闭其他页', async () => {
    onTabCreated({ id: 10, windowId: 2, active: false });
    onTabCreated({ id: 11, windowId: 3, active: true });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(browser.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 10, path: 'sidepanel.html?tabId=10', enabled: true });
    expect(browser.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 11, path: 'sidepanel.html?tabId=11', enabled: true });
    expect(browser.sidePanel.close).not.toHaveBeenCalled();
  });

  it('已有菜单优先更新，不重复创建', async () => {
    onInstalled(); onStartup();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(browser.contextMenus.update).toHaveBeenCalledTimes(2);
    expect(browser.contextMenus.create).not.toHaveBeenCalled();
  });

  it('安装与启动并发时只创建一次缺失菜单', async () => {
    let exists = false;
    vi.mocked(browser.contextMenus.update).mockImplementation(async () => {
      if (!exists) throw new Error('missing menu');
    });
    vi.mocked(browser.contextMenus.create).mockImplementation((_properties, callback) => {
      exists = true; callback?.(); return 'readwise-analyze-selection';
    });
    onInstalled(); onStartup();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(browser.contextMenus.create).toHaveBeenCalledOnce();
    expect(browser.contextMenus.update).toHaveBeenCalledTimes(2);
  });

  it('菜单创建回调读取 lastError，重复 ID 时改为更新', async () => {
    vi.mocked(browser.contextMenus.update).mockRejectedValueOnce(new Error('missing menu'));
    const lastError = vi.fn(() => ({ message: 'duplicate id' }));
    vi.mocked(browser.contextMenus.create).mockImplementation((_properties, callback) => {
      Object.defineProperty(browser.runtime, 'lastError', { configurable: true, get: lastError });
      callback?.();
      delete (browser.runtime as { lastError?: unknown }).lastError;
      return 'readwise-analyze-selection';
    });
    onInstalled();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(lastError).toHaveBeenCalledOnce();
    expect(browser.contextMenus.update).toHaveBeenCalledTimes(2);
  });

  it('初始化禁用全局面板，为已有页配置独立面板并保留选区', async () => {
    await message(selection, contentSender);
    expect(browser.sidePanel.setOptions).toHaveBeenCalledWith({ enabled: false });
    expect(browser.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 1, path: 'sidepanel.html?tabId=1', enabled: true });
    expect(browser.sidePanel.close).not.toHaveBeenCalled();
    expect(browser.sidePanel.setPanelBehavior).toHaveBeenCalledExactlyOnceWith({ openPanelOnActionClick: true });
    expect(memory['latestSelection:1']).toEqual({ ...selection, tabId: 1 });
  });

  it('绑定面板在其他页激活后仍只读取自己的选区，并验证窗口归属', async () => {
    await message(selection, contentSender);
    activeTab = 3;
    const sender = { ...panelSender, url: `${panelUrl}?tabId=1` };
    expect((await message({ type: 'get-latest-selection', windowId: 1 }, sender)).response)
      .toEqual({ type: 'latest-selection', tabId: 1, selection: { ...selection, tabId: 1 } });
    expect((await message({ type: 'get-latest-selection', windowId: 2 }, sender)).response)
      .toEqual({ type: 'latest-selection', tabId: null, selection: null });
  });

  it('标签页已关闭或配置失败时，不抛未处理异常且不返回其他页选区', async () => {
    vi.mocked(browser.sidePanel.setOptions).mockRejectedValueOnce(new Error('tab removed'));
    onTabCreated({ id: 10, windowId: 1, active: true });
    vi.mocked(browser.tabs.get).mockRejectedValueOnce(new Error('tab removed'));
    expect((await message({ type: 'get-latest-selection', windowId: 1 }, { ...panelSender, url: `${panelUrl}?tabId=10` })).response)
      .toEqual({ type: 'latest-selection', tabId: null, selection: null });
  });

  it('从可信 sender 填充 tabId，按活动标签页和窗口读取', async () => {
    expect((await message({ ...selection, tabId: 999 }, contentSender)).response).toEqual({ stored: true });
    const first = await message({ type: 'get-latest-selection', windowId: 1 });
    expect(first.response).toEqual({ type: 'latest-selection', tabId: 1, selection: { ...selection, tabId: 1 } });
    activeTab = 2;
    expect((await message({ type: 'get-latest-selection', windowId: 1 })).response)
      .toEqual({ type: 'latest-selection', tabId: 2, selection: null });
    expect((await message({ type: 'get-latest-selection', windowId: 2 })).response)
      .toEqual({ type: 'latest-selection', tabId: 2, selection: null });
  });

  it('拒绝 iframe、外部扩展、URL 不一致和非法载荷', async () => {
    for (const sender of [
      { ...contentSender, frameId: 1 },
      { ...contentSender, id: 'external' },
      { ...contentSender, url: 'https://evil.test' },
    ]) await message(selection, sender);
    await message({ ...selection, length: 99 }, contentSender);
    expect(memory).toEqual({});
  });

  it('网页脚本和其他扩展页面不能读取选区或触发 AI 请求', async () => {
    for (const sender of [contentSender, { id: extensionId, url: panelUrl.replace('sidepanel', 'options') }]) {
      expect((await message({ type: 'get-latest-selection', windowId: 1 }, sender)).asyncResponse).toBe(false);
      for (const type of ['get-ai-settings', 'save-ai-settings', 'clear-ai-settings', 'test-ai-connection']) {
        expect((await message({ type, apiKey: 'private-key', model: 'deepseek-flash' }, sender)).asyncResponse).toBe(false);
      }
      expect((await message({ type: 'analyze-requested', text: 'hello', inputType: 'word' }, sender)).asyncResponse).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('导航/关闭清理对应标签页，其他标签页不受影响', async () => {
    await message(selection, contentSender);
    await message(selection, { ...contentSender, tab: { id: 2, url: pageUrl } });
    onUpdated(1, { status: 'loading' });
    expect((await message({ type: 'get-latest-selection', windowId: 1 })).response)
      .toEqual({ type: 'latest-selection', tabId: 1, selection: null });
    expect(memory['latestSelection:2']).toBeDefined();
    onRemoved(2);
    await message({ type: 'get-latest-selection', windowId: 2 });
    expect(memory).toEqual({});
  });

  it('导航与尚未完成的存储并发时，最终不保留旧选区', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(browser.storage.session.set).mockImplementationOnce(async (values) => {
      await gate;
      Object.assign(memory, values);
    });
    await message(selection, contentSender);
    onUpdated(1, { status: 'loading' });
    release();
    expect((await message({ type: 'get-latest-selection', windowId: 1 })).response)
      .toEqual({ type: 'latest-selection', tabId: 1, selection: null });
    expect(memory).toEqual({});
  });

  it('存储失败明确回执，不把未保存选区标成成功', async () => {
    vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('storage full'));
    expect((await message(selection, contentSender)).response).toEqual({ stored: false });
    expect(memory).toEqual({});
  });

  it('重启后从 session 读取，并对存储故障返回空状态', async () => {
    memory['latestSelection:1'] = { ...selection, tabId: 1 };
    expect((await message({ type: 'get-latest-selection', windowId: 1 })).response)
      .toEqual({ type: 'latest-selection', tabId: 1, selection: { ...selection, tabId: 1 } });
    vi.mocked(browser.storage.session.get).mockRejectedValueOnce(new Error('storage unavailable'));
    expect((await message({ type: 'get-latest-selection', windowId: 1 })).response)
      .toEqual({ type: 'latest-selection', tabId: null, selection: null });
  });
});
