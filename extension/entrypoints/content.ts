/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/**
 * 划词捕获：500ms 防抖、保存回执、一次临时故障重试。
 * 扩展重载后旧网页的 Content Script 会失效，必须停止监听和计时器；
 * runtime.id 和 sendMessage 都可能同步抛错，不能只依赖 Promise.catch。
 */
import { filterSelection, FILTER_REASON_MESSAGES } from '~/utils/filter';
import type { SelectionUpdatedMessage, SelectionUpdateAck } from '~/utils/messages';

const DEBOUNCE_MS = 500;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main(ctx) {
    let stopped = false;
    let version = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let toast: HTMLDivElement | null = null;
    let lastReported = '';

    function cleanup() {
      if (stopped) return;
      stopped = true;
      version++;
      clearTimeout(debounceTimer);
      clearTimeout(toastTimer);
      document.removeEventListener('selectionchange', onSelectionChange);
      toast?.remove(); toast = null;
    }
    function invalidate() {
      cleanup();
      if (!ctx.signal.aborted) ctx.abort('Extension context invalidated');
    }
    function active(): boolean {
      if (stopped || ctx.signal.aborted) return false;
      try {
        if (browser.runtime?.id) return true;
      } catch { /* 旧扩展上下文的 runtime 属性访问也可能同步抛错。 */ }
      invalidate();
      return false;
    }
    function currentText() { return window.getSelection()?.toString() ?? ''; }
    function showTooLong() {
      toast?.remove(); clearTimeout(toastTimer);
      toast = document.createElement('div');
      toast.id = 'readwise-toast';
      toast.textContent = FILTER_REASON_MESSAGES['too-long'];
      toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;' +
        'background:#1f2937;color:#f9fafb;padding:10px 16px;border-radius:8px;' +
        'font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:320px';
      document.body?.appendChild(toast);
      toastTimer = setTimeout(() => { toast?.remove(); toast = null; }, 2500);
    }
    async function report(expectedVersion: number, attempt = 0): Promise<void> {
      if (!active() || expectedVersion !== version) return;
      const result = filterSelection(currentText());
      if (!result.accept) {
        if (result.reason === 'too-long') showTooLong();
        lastReported = '';
        return;
      }
      const key = `${location.href}\n${result.text}`;
      if (key === lastReported) return;
      const message: SelectionUpdatedMessage = {
        type: 'selection-updated', text: result.text, length: result.length, url: location.href,
      };
      const retry = () => {
        if (!active() || expectedVersion !== version || attempt !== 0) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { void report(expectedVersion, 1); }, DEBOUNCE_MS);
      };
      try {
        // try 必须覆盖调用本身：扩展重载可在返回 Promise 前同步抛错。
        const response = await browser.runtime.sendMessage(message) as SelectionUpdateAck | undefined;
        if (!active() || expectedVersion !== version) return;
        if (!response?.stored) { retry(); return; }
        if (location.href === message.url && currentText().trim() === result.text) lastReported = key;
      } catch (error) {
        if (error instanceof Error && /extension context invalidated/i.test(error.message)) {
          invalidate(); return;
        }
        retry();
      }
    }
    function onSelectionChange() {
      if (!active()) return;
      const expectedVersion = ++version;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void report(expectedVersion); }, DEBOUNCE_MS);
    }
    ctx.onInvalidated(cleanup);
    if (active()) document.addEventListener('selectionchange', onSelectionChange);
  },
});
