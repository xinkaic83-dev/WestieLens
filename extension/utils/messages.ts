/**
 * 扩展内部消息通信协议，与说明书 §9.1 消息类型表一一对应。
 * 新增消息类型必须先在文档 §9.1 登记，再写代码。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import type { SettingsStatus } from '../services/settings';
import type { InputType, Feature } from './api-types';

/** Content Script → Background：稳定选区上报（500ms 防抖后，text 已 trim 且 ≤500 字符） */
export interface SelectionUpdatedMessage {
  type: 'selection-updated';
  text: string;
  length: number;
  url: string;
  tabId?: number;
}

export interface SelectionUpdateAck { stored: boolean }

/** SidePanel → Background：面板打开/激活时读取最近选区 */
export interface GetLatestSelectionMessage {
  type: 'get-latest-selection';
  windowId: number;
}

/** Background → SidePanel：对读取请求的响应；无选区时 selection 为 null（明确空状态，§9.2-5） */
export interface LatestSelectionResponse {
  type: 'latest-selection';
  tabId: number | null;
  selection: SelectionUpdatedMessage | null;
}

/** SidePanel → Background：用户点击"分析"后触发，由 Background 直连官方 API */
export interface AnalyzeRequestedMessage {
  type: 'analyze-requested';
  text: string;
  inputType: InputType;
  features?: Feature[];
}

/** Background → SidePanel：analyze-requested 的响应（成功或错误，错误含统一错误体或本地连接失败标记） */
export type AnalyzeResponseMessage =
  | { ok: true; data: unknown }
  | { ok: false; error: { code?: number; message: string; retryable: boolean } };

export type SettingsMessage =
  | { type: 'get-ai-settings' }
  | { type: 'save-ai-settings'; apiKey?: string; model: string }
  | { type: 'clear-ai-settings' }
  | { type: 'test-ai-connection'; apiKey?: string; model: string };
export type SettingsResponse =
  | { ok: true; data: SettingsStatus }
  | { ok: false; error: { message: string; retryable: boolean } };
export type ConnectionTestResponse =
  | { ok: true; data: { models: string[]; selectedAvailable: boolean } }
  | { ok: false; error: { message: string; retryable: boolean } };
export type InboundMessage = SelectionUpdatedMessage | GetLatestSelectionMessage | AnalyzeRequestedMessage | SettingsMessage;

export const KNOWN_MESSAGE_TYPES = [
  'selection-updated',
  'get-latest-selection',
  'analyze-requested',
  'get-ai-settings',
  'save-ai-settings',
  'clear-ai-settings',
  'test-ai-connection',
] as const;

/** chrome.storage.session 中最新选区的 key（§9.2-2） */
export const LATEST_SELECTION_KEY = 'latestSelection';
export const selectionKey = (tabId: number) => `${LATEST_SELECTION_KEY}:${tabId}`;

export interface MessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

export function isPanelSender(sender: MessageSender, extensionId: string, panelUrl: string): boolean {
  if (sender.id !== extensionId) return false;
  if (sender.url === panelUrl) return true;
  const tabId = panelTabId(sender.url);
  return tabId !== null && sender.url === `${panelUrl}?tabId=${tabId}`;
}

/** 标签页面板的规范绑定参数；来源是否可信仍由 isPanelSender 独立验证。 */
export function panelTabId(url: string | undefined): number | null {
  try {
    const value = new URL(url ?? '').searchParams.get('tabId');
    if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  } catch { return null; }
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

export function isContentSender(sender: MessageSender, extensionId: string, url: string): boolean {
  return sender.id === extensionId && sender.frameId === 0
    && Number.isInteger(sender.tab?.id) && sender.tab!.id! >= 0
    && sender.url === url && isHttpUrl(url);
}

export function isValidWindowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * 类型守卫：未知消息必须拒绝处理，不得静默转成默认动作（§9.1）。
 */
export function isKnownMessage(value: unknown): value is InboundMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  return (KNOWN_MESSAGE_TYPES as readonly string[]).includes(type as string);
}

/**
 * 校验 selection-updated 载荷（Background 侧，§9.2-2）。
 * 不信任 Content Script 传来的任意对象，逐字段验证。
 */
export function isValidSelectionPayload(value: unknown): value is SelectionUpdatedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'selection-updated'
    && typeof v.text === 'string'
    && v.text === v.text.trim()
    && /[a-zA-Z]/.test(v.text)
    && v.text.length > 0
    && v.text.length <= 500
    && v.length === v.text.length
    && isHttpUrl(v.url)
  );
}

/**
 * 校验 analyze-requested 载荷（Background 侧）。
 */
export function isValidAnalyzePayload(value: unknown): value is AnalyzeRequestedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'analyze-requested'
    && typeof v.text === 'string'
    && /[a-zA-Z]/.test(v.text)
    && v.text.trim().length > 0
    && v.text.trim().length <= 500
    && (v.inputType === 'word' || v.inputType === 'analysis' || v.inputType === 'auto')
    && (v.features === undefined || (Array.isArray(v.features) && v.features.every((f) => ['translation', 'clauses', 'syntax', 'grammar'].includes(f))))
  );
}
