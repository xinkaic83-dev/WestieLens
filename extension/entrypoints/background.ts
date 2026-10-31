/**
 * Background Service Worker：SidePanel 初始化、消息中转与代理请求（说明书 §4.1.1 / §9.2）。
 * - Background 是唯一官方 API 调用入口；密钥只保存在受限 local 存储；
 * - 校验消息类型、载荷与 sender 后才写入 chrome.storage.session（不依赖内存变量）；
 * - 总等待 120s，覆盖上游动态超时及结构重试。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import {
  LATEST_SELECTION_KEY,
  isKnownMessage,
  selectionKey,
  isPanelSender,
  isContentSender,
  isValidWindowId,
  panelTabId,
  type MessageSender,
  type SelectionUpdateAck,
  type ConnectionTestResponse,
  type SettingsResponse,
  isValidSelectionPayload,
  isValidAnalyzePayload,
  type AnalyzeResponseMessage,
  type LatestSelectionResponse,
  type SelectionUpdatedMessage,
} from '~/utils/messages';
import { createSettingsStore, safeError, ServiceError } from '~/services/settings';
import { createAiService } from '~/services/ai-service';
import { filterSelection } from '~/utils/filter';

// 每个标签页串行提交存储和清理，避免导航清理被较早的写入覆盖。
const pendingWrites = new Map<number, Promise<unknown>>();
function inTabOrder<T>(tabId: number, action: () => Promise<T>): Promise<T> {
  const next = (pendingWrites.get(tabId) ?? Promise.resolve()).catch(() => {}).then(action);
  pendingWrites.set(tabId, next);
  void next.finally(() => {
    if (pendingWrites.get(tabId) === next) pendingWrites.delete(tabId);
  }).catch(() => {});
  return next;
}

async function readActiveSelection(windowId: number, boundTabId: number | null): Promise<LatestSelectionResponse> {
  const tab = boundTabId === null
    ? (await browser.tabs.query({ active: true, windowId }))[0] : await browser.tabs.get(boundTabId);
  if (boundTabId !== null && tab?.windowId !== windowId) return { type: 'latest-selection', tabId: null, selection: null };
  if (tab?.id === undefined) return { type: 'latest-selection', tabId: null, selection: null };
  const tabId = tab.id;
  return inTabOrder(tabId, async () => {
    const stored = await browser.storage.session.get(selectionKey(tabId));
    const candidate: unknown = stored[selectionKey(tabId)];
    const selection = isValidSelectionPayload(candidate) && candidate.tabId === tabId ? candidate : null;
    return { type: 'latest-selection', tabId, selection };
  });
}

/**
 * 右键菜单（§4.1.2 v0.2 增强）：与划词走同一套校验和同一条存储通道，
 * 不新增消息类型，因此不需要改动说明书 §9.1 的消息表。
 */
const CONTEXT_MENU_ID = 'readwise-analyze-selection';
let menuSetup = Promise.resolve();

function ensureContextMenu(): void {
  // 安装和启动事件可能并发；优先更新已存在菜单，串行补建缺失菜单。
  menuSetup = menuSetup.catch(() => {}).then(async () => {
    const properties = {
      title: '用 WestieLens 分析“%s”',
      contexts: ['selection'] as ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    };
    try {
      await browser.contextMenus.update(CONTEXT_MENU_ID, properties);
      return;
    } catch { /* 首次安装时菜单尚不存在。 */ }
    // create 返回 ID 而不是 Promise，必须在回调里读取 lastError。
    const created = await new Promise<boolean>((resolve) => {
      browser.contextMenus.create({ id: CONTEXT_MENU_ID, ...properties }, () => {
        resolve(!browser.runtime.lastError);
      });
    });
    if (!created) await browser.contextMenus.update(CONTEXT_MENU_ID, properties);
  }).catch(() => {});
}

/** 右键菜单点击：复用 isValidSelectionPayload 的同一套载荷约定，只多了一条"自动打开侧边栏" */
async function handleContextMenuClick(
  info: { menuItemId: string | number; selectionText?: string; pageUrl?: string },
  tab?: { id?: number; url?: string },
): Promise<void> {
  if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined) return;
  const result = filterSelection(info.selectionText ?? '');
  if (!result.accept) return;

  const payload: SelectionUpdatedMessage = {
    type: 'selection-updated',
    text: result.text,
    length: result.length,
    url: info.pageUrl ?? tab.url ?? '',
    tabId: tab.id,
  };
  // 载荷自检：Background 自己的数据也要过同一道校验，避免菜单链路绕过长度/类型约束
  if (!isValidSelectionPayload(payload)) return;

  // 先在用户手势回调内打开面板，不能等异步存储后再调用。
  const opening = typeof browser.sidePanel.open === 'function'
    ? browser.sidePanel.open({ tabId: tab.id }).catch(() => {}) : Promise.resolve();
  try {
    await inTabOrder(tab.id, () => browser.storage.session.set({ [selectionKey(tab.id!)]: payload }));
  } catch {
    return;
  }
  await opening;
}

export default defineBackground(() => {
  const settings = createSettingsStore();
  const ai = createAiService(settings);

  // 点击扩展图标直接打开 SidePanel（§4.1.1）
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // 每个标签页使用独立面板，Chrome 保存该页的展开状态；不关闭其他页面的面板。
  const defaultsReady = browser.sidePanel.setOptions({ enabled: false });
  void defaultsReady.catch(() => {});
  const configureTab = async (tabId: number | undefined) => {
    if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0) return;
    await defaultsReady;
    await browser.sidePanel.setOptions({ tabId, path: `sidepanel.html?tabId=${tabId}`, enabled: true });
  };
  browser.tabs.onCreated.addListener((tab) => {
    void configureTab(tab.id).catch(() => {});
  });
  // 包括更新前已打开的页面；Worker 重启也重新确保配置，不改变 enabled 面板的展开状态。
  void browser.tabs.query({}).then((tabs) => Promise.all(tabs.map((tab) => configureTab(tab.id)))).catch(() => {});

  // 旧版本全局选区不能迁移到任意标签页，直接移除。
  void browser.storage.session.remove(LATEST_SELECTION_KEY).catch(() => {});
  browser.tabs.onRemoved.addListener((tabId) => {
    void inTabOrder(tabId, () => browser.storage.session.remove(selectionKey(tabId))).catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url !== undefined) {
      void inTabOrder(tabId, () => browser.storage.session.remove(selectionKey(tabId))).catch(() => {});
    }
  });

  // 安装/升级和启动均幂等更新菜单，避免保留旧标题或重复创建。
  browser.runtime.onInstalled.addListener(ensureContextMenu);
  browser.runtime.onStartup.addListener(ensureContextMenu);
  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenuClick(info, tab);
  });

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: MessageSender,
      sendResponse: (response?: LatestSelectionResponse | AnalyzeResponseMessage | SelectionUpdateAck | SettingsResponse | ConnectionTestResponse) => void,
    ) => {
      // 未知类型拒绝处理，不静默转默认动作（§9.1）
      if (!isKnownMessage(message)) return false;

      if (message.type === 'selection-updated') {
        const payload: SelectionUpdatedMessage = message;
        if (isValidSelectionPayload(payload) && isContentSender(sender, browser.runtime.id, payload.url)) {
          // 写 storage.session 而非内存变量，Service Worker 可能被挂起重启（§9.2-2）
          const tabId = sender.tab!.id!;
          const trusted = { ...payload, tabId };
          void inTabOrder(tabId, () => browser.storage.session.set({ [selectionKey(tabId)]: trusted }))
            .then(() => sendResponse({ stored: true }))
            .catch(() => sendResponse({ stored: false }));
          return true;
        }
        return false;
      }

      if (!isPanelSender(sender, browser.runtime.id, browser.runtime.getURL('/sidepanel.html'))) return false;

      if (message.type === 'get-ai-settings' || message.type === 'save-ai-settings'
        || message.type === 'clear-ai-settings' || message.type === 'test-ai-connection') {
        const action = async () => {
          switch (message.type) {
            case 'get-ai-settings': return settings.status();
            case 'clear-ai-settings': return settings.clear();
            case 'save-ai-settings':
            case 'test-ai-connection':
              if (message.apiKey !== undefined && typeof message.apiKey !== 'string') throw new ServiceError('请求参数有误', false);
              return message.type === 'save-ai-settings'
                ? settings.save(message.apiKey, message.model) : ai.test(message.apiKey, message.model);
          }
        };
        void action().then((data) => sendResponse({ ok: true, data }))
          .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
        return true;
      }

      if (message.type === 'get-latest-selection') {
        if (!isValidWindowId(message.windowId)) return false;
        readActiveSelection(message.windowId, panelTabId(sender.url))
          .then(sendResponse)
          .catch(() => sendResponse({ type: 'latest-selection', tabId: null, selection: null }));
        return true;
      }

      if (message.type === 'analyze-requested') {
        if (!isValidAnalyzePayload(message)) {
          sendResponse({ ok: false, error: { code: 4003, message: '请求参数有误', retryable: false } });
          return false;
        }
        ai.analyze(message).then((res) => sendResponse(res));
        return true; // 异步响应
      }

      return false;
    },
  );
});
