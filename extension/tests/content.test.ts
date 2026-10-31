/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let documentTarget: EventTarget;
let controller: AbortController;
let selected: string;
let sendMessage: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;
let runtime: { id?: string; sendMessage: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules();
  selected = 'hello'; controller = new AbortController(); documentTarget = new EventTarget();
  sendMessage = vi.fn().mockResolvedValue({ stored: true });
  runtime = { id: 'test-extension', sendMessage };
  removeListener = vi.fn((...args: Parameters<EventTarget['removeEventListener']>) => documentTarget.removeEventListener(...args));
  vi.stubGlobal('document', {
    addEventListener: documentTarget.addEventListener.bind(documentTarget), removeEventListener: removeListener,
  });
  vi.stubGlobal('window', { getSelection: () => ({ toString: () => selected }) });
  vi.stubGlobal('location', { href: 'https://example.com/article' });
  vi.stubGlobal('browser', { runtime });
  vi.stubGlobal('defineContentScript', (definition: { main: Function }) => {
    definition.main({ signal: controller.signal, abort: () => controller.abort(),
      onInvalidated: (callback: () => void) => controller.signal.addEventListener('abort', callback) });
    return definition;
  });
  await import('../entrypoints/content');
});
afterEach(() => { controller.abort(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const select = () => documentTarget.dispatchEvent(new Event('selectionchange'));

it('防抖后只上报一次，成功后同一选区不重复发送', async () => {
  select(); select();
  await vi.advanceTimersByTimeAsync(499); expect(sendMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(sendMessage).toHaveBeenCalledTimes(1);
  select(); await vi.advanceTimersByTimeAsync(500); expect(sendMessage).toHaveBeenCalledTimes(1);
});
it('sendMessage 同步抛出 context invalidated 时清理，后续选区不再调用 API', async () => {
  sendMessage.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
  select(); await vi.advanceTimersByTimeAsync(500);
  expect(controller.signal.aborted).toBe(true);
  expect(removeListener).toHaveBeenCalled();
  select(); await vi.advanceTimersByTimeAsync(2000);
  expect(sendMessage).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('异步失效拒绝也停止监听，不重试已失效上下文', async () => {
  sendMessage.mockRejectedValue(new Error('Extension context invalidated.'));
  select(); await vi.advanceTimersByTimeAsync(2000);
  expect(controller.signal.aborted).toBe(true); expect(sendMessage).toHaveBeenCalledTimes(1);
});
it('runtime.id getter 抛错时，不触发 API 调用', async () => {
  Object.defineProperty(runtime, 'id', { get() { throw new Error('Extension context invalidated.'); } });
  expect(select).not.toThrow();
  await vi.advanceTimersByTimeAsync(1000);
  expect(sendMessage).not.toHaveBeenCalled(); expect(controller.signal.aborted).toBe(true);
});
it('生命周期失效取消已排队防抖和临时故障重试', async () => {
  sendMessage.mockRejectedValue(new Error('Could not establish connection'));
  select(); await vi.advanceTimersByTimeAsync(500);
  controller.abort(); await vi.advanceTimersByTimeAsync(2000);
  expect(sendMessage).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('暂时连接失败允许一次重试，成功后去重', async () => {
  sendMessage.mockRejectedValueOnce(new Error('Could not establish connection'));
  select(); await vi.advanceTimersByTimeAsync(1000);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  select(); await vi.advanceTimersByTimeAsync(500); expect(sendMessage).toHaveBeenCalledTimes(2);
});
it('旧选区失败回执不打断新选区的防抖', async () => {
  let reject!: (error: Error) => void;
  sendMessage.mockImplementationOnce(() => new Promise((_resolve, onReject) => { reject = onReject; }));
  select(); await vi.advanceTimersByTimeAsync(500);
  selected = 'world'; select(); await vi.advanceTimersByTimeAsync(200);
  reject(new Error('temporary error')); await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(sendMessage.mock.calls[1]?.[0].text).toBe('world');
});

it('runtime.id 消失时取消已排队的防抖，不尝试发送消息', async () => {
  select(); runtime.id = undefined;
  await vi.advanceTimersByTimeAsync(1000);
  expect(sendMessage).not.toHaveBeenCalled(); expect(controller.signal.aborted).toBe(true);
});
it('尚未到防抖时间就失效时，立即移除监听和计时器', async () => {
  select(); controller.abort();
  await vi.advanceTimersByTimeAsync(1000);
  expect(sendMessage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
