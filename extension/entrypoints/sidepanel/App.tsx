/**
 * SidePanel 主面板：状态机 idle → preview → loading → result | error（说明书 §10.1）。
 * - 打开/激活时主动向 Background 读取最新选区（get-latest-selection，§9.2-3）；
 * - 监听 storage.session 变化获得新选区，只更新预览、不自动发起分析（§9.2-4）；
 * - 任意状态下收到新 selection-updated 回到 preview；
 * - 只有用户点击"分析"才通过 Background 请求官方 API。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalyzeResult, InputType, WordDetail } from '~/utils/api-types';
import { mapErrorMessage } from '~/utils/errors';
import { suggestRoute } from '~/utils/routing';
import { PANEL_HIDDEN_EVENT } from '~/utils/speech';
import {
  LATEST_SELECTION_KEY,
  panelTabId,
  isValidSelectionPayload,
  type AnalyzeResponseMessage,
  type LatestSelectionResponse,
  type SelectionUpdatedMessage,
} from '~/utils/messages';
import SelectionPreviewCard from '~/components/SelectionPreviewCard';
import Skeleton from '~/components/Skeleton';
import SentenceResultCard from '~/components/SentenceResultCard';
import WordResultCard from '~/components/WordResultCard';
import ErrorCard from '~/components/ErrorCard';
import AiSettingsCard from '~/components/AiSettingsCard';
import { SETTINGS_KEY, type SettingsStatus } from '~/services/settings';
import type { SettingsResponse } from '~/utils/messages';

type Stage = 'idle' | 'preview' | 'loading' | 'result' | 'error';

interface PanelError {
  message: string;
  retryable: boolean;
}

/** 分析请求默认功能集合（插件 features 白名单，§6.1） */
const DEFAULT_FEATURES = ['translation', 'clauses', 'syntax', 'grammar'] as const;

export default function App() {
  const requestVersion = useRef(0);
  const settingsRef = useRef<SettingsStatus | null>(null);
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const selectionRef = useRef<SelectionUpdatedMessage | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [selection, setSelection] = useState<SelectionUpdatedMessage | null>(null);
  const [mode, setMode] = useState<InputType>('analysis');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<PanelError | null>(null);

  /** 新选区统一入口：重置为 preview + 自动路由建议（用户可手动切换，§4.1.3） */
  const applyNewSelection = useCallback((next: SelectionUpdatedMessage | null) => {
    const previous = selectionRef.current;
    if (previous?.tabId === next?.tabId && previous?.text === next?.text && previous?.url === next?.url) return;
    selectionRef.current = next;
    requestVersion.current += 1;
    setSelection(next);
    if (next) {
      setMode(suggestRoute(next.text));
      setStage('preview');
      setResult(null);
      setError(null);
    } else {
      setResult(null);
      setError(null);
      setStage('idle');
    }
  }, []);

  const settingsChanged = useCallback((next: SettingsStatus) => {
    const previous = settingsRef.current;
    setSettingsError('');
    if (previous?.revision === next.revision && previous.configured === next.configured && previous.model === next.model) return;
    settingsRef.current = next;
    requestVersion.current += 1;
    setSettings(next);
    setSettingsError('');
    setResult(null); setError(null);
    setStage(selectionRef.current ? 'preview' : 'idle');
    if (!next.configured) setShowSettings(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let version = 0;
    const load = async () => {
      const current = ++version;
      try {
        const response = await browser.runtime.sendMessage({ type: 'get-ai-settings' }) as SettingsResponse;
        if (cancelled || current !== version) return;
        if (response?.ok) settingsChanged(response.data);
        else setSettingsError(response?.error.message ?? '配置读取失败，请重试');
      } catch { if (!cancelled) setSettingsError('配置读取失败，请重新打开面板'); }
    };
    const onSettings = (changes: Record<string, unknown>) => {
      if (SETTINGS_KEY in changes) {
        const revision = (changes[SETTINGS_KEY] as { newValue?: { revision?: string } })?.newValue?.revision;
        if (settingsRef.current && (revision ?? '') === settingsRef.current.revision) return;
        // 配置修改立即使旧请求失效，再异步读取脱敏状态。
        requestVersion.current += 1;
        setResult(null); setError(null); setStage(selectionRef.current ? 'preview' : 'idle');
        void load();
      }
    };
    browser.storage.local.onChanged.addListener(onSettings);
    void load();
    return () => { cancelled = true; browser.storage.local.onChanged.removeListener(onSettings); };
  }, [settingsChanged]);

  // 原生面板绑定所属标签页；无绑定参数的测试面板跟随当前窗口活动页。
  useEffect(() => {
    let cancelled = false;
    let windowId: number | undefined;
    let activeTabId: number | null = null;
    let refreshVersion = 0;
    const boundTabId = panelTabId(window.location.href);

    const refresh = async (clear = false) => {
      const version = ++refreshVersion;
      if (clear) applyNewSelection(null);
      if (windowId === undefined) return;
      try {
        const response = await browser.runtime.sendMessage({
          type: 'get-latest-selection', windowId,
        }) as LatestSelectionResponse | undefined;
        if (cancelled || version !== refreshVersion) return;
        activeTabId = response?.tabId ?? null;
        const next = response?.selection;
        applyNewSelection(isValidSelectionPayload(next) && next.tabId === activeTabId ? next : null);
      } catch {
        if (!cancelled && version === refreshVersion) applyNewSelection(null);
      }
    };
    const onStorage = (changes: Record<string, unknown>) => {
      if (boundTabId !== null && !(`${LATEST_SELECTION_KEY}:${boundTabId}` in changes)) return;
      if (Object.keys(changes).some((key) => key.startsWith(`${LATEST_SELECTION_KEY}:`))) void refresh();
    };
    const onActivated = (info: { windowId: number; tabId: number }) => {
      if (info.windowId !== windowId) return;
      if (boundTabId !== null) {
        if (info.tabId === boundTabId) void refresh();
        else window.dispatchEvent(new Event(PANEL_HIDDEN_EVENT));
        return;
      }
      activeTabId = info.tabId;
      void refresh(true);
    };
    const onUpdated = (tabId: number, change: { status?: string; url?: string }) => {
      if (tabId === activeTabId && (change.status === 'loading' || change.url !== undefined)) {
        ++refreshVersion;
        applyNewSelection(null);
      }
    };
    const onRemoved = (tabId: number) => {
      if (tabId === activeTabId) void refresh(true);
    };
    const onFocus = () => { void refresh(); };
    browser.storage.session.onChanged.addListener(onStorage);
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    window.addEventListener('focus', onFocus);
    void browser.windows.getCurrent().then((current) => {
      if (cancelled) return;
      windowId = current.id;
      void refresh();
    }).catch(() => { if (!cancelled) applyNewSelection(null); });
    return () => {
      cancelled = true;
      requestVersion.current += 1;
      browser.storage.session.onChanged.removeListener(onStorage);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      window.removeEventListener('focus', onFocus);
    };
  }, [applyNewSelection]);

  const analyze = useCallback(async () => {
    if (!selection) return;
    if (!settings?.configured) { setShowSettings(true); return; }
    const version = ++requestVersion.current;
    setStage('loading');
    setError(null);

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'analyze-requested',
        text: selection.text,
        inputType: mode,
        features: mode === 'analysis' ? [...DEFAULT_FEATURES] : undefined,
      })) as AnalyzeResponseMessage;

      if (version !== requestVersion.current) return;
      if (response?.ok) {
        // word 路由返回词典 DTO，analysis 路由返回句子 DTO
        setResult(response.data as AnalyzeResult);
        setStage('result');
      } else {
        const err = response?.error ?? { code: undefined, message: '服务异常，请重试', retryable: true };
        setError({ message: mapErrorMessage(err.code, err.message), retryable: err.retryable !== false });
        setStage('error');
      }
    } catch {
      if (version !== requestVersion.current) return;
      setError({ message: '扩展通信失败，请重新尝试', retryable: true });
      setStage('error');
    }
  }, [selection, mode, settings?.configured]);

  const isWordResult = (r: AnalyzeResult): r is WordDetail => 'definitions' in r;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <img src="/icon/48.png" alt="" width={24} height={24} className="shrink-0" />
            WestieLens
          </h1>
          <button type="button" onClick={() => setShowSettings(!showSettings)} className="text-xs text-blue-600">配置 AI</button>
        </div>
        <p className="text-xs text-slate-400">选中网页英文 → 预览 → 点击分析</p>
      </header>

      <main className="flex-1 space-y-3 p-4">
        <p className="text-xs text-slate-500">{settings?.configured ? `已配置 · ${settings.model}` : settings ? '尚未配置 API Key' : '正在读取配置…'}</p>
        {settingsError && <p role="alert" className="text-xs text-red-600">{settingsError}</p>}
        {showSettings && <AiSettingsCard status={settings} onStatus={settingsChanged} onClose={() => setShowSettings(false)} />}
        {settings && !settings.configured && !showSettings && <button type="button" onClick={() => setShowSettings(true)} className="text-sm text-blue-600">配置 DeepSeek 后开始分析</button>}
        {stage === 'idle' && (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            <p>在网页中选中英文单词或句子，这里会显示预览。</p>
            <p className="mt-2 text-xs">刚更新或重新加载插件？请先刷新已打开的网页，再划词。</p>
          </div>
        )}

        {stage !== 'idle' && selection && (
          <SelectionPreviewCard
            selection={selection}
            mode={mode}
            loading={stage === 'loading'}
            onModeChange={(next) => {
              requestVersion.current += 1;
              setMode(next);
              setResult(null);
              setError(null);
              setStage('preview');
            }}
            onAnalyze={analyze}
          />
        )}

        {stage === 'loading' && <Skeleton />}

        {stage === 'result' && result && (
          isWordResult(result)
            ? <WordResultCard data={result} />
            : <SentenceResultCard data={result} />
        )}

        {stage === 'error' && error && (
          <ErrorCard message={error.message} retryable={error.retryable} onRetry={analyze} />
        )}
      </main>

      {/* 常驻免责声明（§2-4 / §10.3） */}
      <footer className="border-t border-slate-200 bg-white px-4 py-2">
        <p className="text-[11px] leading-relaxed text-slate-400">
          AI 语法分析与翻译结果由大模型生成，仅供英语学习参考，不保证百分之百准确。
        </p>
        <details className="mt-1 text-[11px] leading-relaxed text-slate-500">
          <summary className="cursor-pointer">关于与开源许可</summary>
          <p className="mt-1">Copyright © 2026 ReadWise English Contributors</p>
          <p>原项目维护者：xinkaic83-dev。本软件按 GPLv3（仅第 3 版）许可，可依协议再分发和修改，不提供担保。</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-blue-600">
            <a href="/LICENSE.txt" target="_blank" rel="noopener noreferrer">GPLv3 全文</a>
            <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer">第三方声明</a>
            <a href="https://github.com/xinkaic83-dev/WestieLens" target="_blank" rel="noopener noreferrer">原项目源码</a>
          </div>
        </details>
      </footer>
    </div>
  );
}
