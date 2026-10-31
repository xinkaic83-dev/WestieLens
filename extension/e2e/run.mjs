/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/**
 * 端到端链路（说明书 §12.2 v1.0 DoD）：
 *   网页选区 → 侧边栏预览 → 点击"分析" → 展示结果
 *
 * 与单测的区别：这里全部跑真实组件——真实 Content Script 注入、真实 Background
 * Service Worker 消息路由、真实插件直连编排（校验/解析/缓存），
 * 只把外部 DeepSeek 与词典替换成本地 stub（见 stub-server.mjs）。
 *
 * 前置：
 *   1. npm install（会装 @playwright/test）
 *   2. npx playwright install chromium
 * 运行：npm run e2e
 *
 * 优先使用本机 Chrome，否则用 Playwright Chromium；两者均通过 CDP 加载扩展。
 */

import { chromium, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub-server.mjs';

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STUB_PORT = 8123;
const EXT_OUTPUT = path.join(EXT_DIR, '.output', 'chrome-mv3');

const SENTENCE = 'Although it was raining, we decided to go out.';

async function main() {
  if (!exists(EXT_OUTPUT)) {
    throw new Error(`未找到扩展产物：${EXT_OUTPUT}\n先执行：npm run build`);
  }

  const stub = await startStub(STUB_PORT);
  let context;
  try {

    // 两种浏览器均通过 CDP 安装扩展，使后续卸载/重装测试使用相同的安装类型。
    // --load-extension 加载的扩展不能由 Extensions.uninstall 卸载。
    // 始终使用临时 profile；CI 或未安装 Chrome 时用 Playwright Chromium。
    const chromeAvailable = exists('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    const useChrome = process.env.E2E_BROWSER === 'chrome'
      || (process.env.E2E_BROWSER !== 'chromium' && chromeAvailable);
    const isolatedNetwork = ['--no-proxy-server', '--host-resolver-rules=MAP api.deepseek.com ~NOTFOUND,MAP api.dictionaryapi.dev ~NOTFOUND'];
    context = await chromium.launchPersistentContext('', {
      headless: true, channel: useChrome ? 'chrome' : 'chromium',
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', ...isolatedNetwork],
    });
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: EXT_OUTPUT });
    await cdp.detach();
    console.log(`测试浏览器：${useChrome ? 'Google Chrome（CDP）' : 'Playwright Chromium'}`);

    // 拦截真实生产扩展发出的官方请求，绝不向真实服务发送测试密钥。
    await context.route('https://api.deepseek.com/**', fulfillUpstream);
    await context.route('https://api.dictionaryapi.dev/**', fulfillUpstream);
    async function fulfillUpstream(route) {
      const request = route.request();
      const result = await stub.handleUpstream(request.url(), request.postData() ?? '', request.headers().authorization);
      await route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
    }

    const extensionId = await waitForExtensionId(context);

    // ① 网页选区：Content Script 捕获后由 Background 写入 storage.session
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${STUB_PORT}/`);
    await page.evaluate(() => {
      const target = document.querySelector('#sentence');
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    // 500ms 防抖 + 消息往返，留足余量
    await new Promise((r) => setTimeout(r, 1500));

    // ② 侧边栏预览
    // 以非活动扩展标签页承载同一面板文档，避免测试页抢占网页活动标签页。
    const worker = context.serviceWorkers()[0];
    const panelPromise = context.waitForEvent('page');
    await worker.evaluate((url) => chrome.tabs.create({ url, active: false }), `chrome-extension://${extensionId}/sidepanel.html`);
    const panel = await panelPromise;
    await panel.waitForLoadState();
    await panel.setViewportSize({ width: 400, height: 900 });
    // 分发包的许可正文与仓库一致，界面可访问来源与许可。
    await panel.getByText('关于与开源许可', { exact: true }).click();
    await expect(panel.getByText('原项目维护者：xinkaic83-dev。', { exact: false })).toBeVisible();
    const notices = await panel.evaluate(async () => Promise.all(
      ['/LICENSE.txt', '/NOTICE', '/THIRD_PARTY_NOTICES.txt'].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('打包许可文件不可读取');
        return response.text();
      }),
    ));
    assert.equal(notices[0], readFileSync(path.join(EXT_DIR, '..', 'LICENSE'), 'utf8'));
    assert.ok(notices[1].includes('xinkaic83-dev'));
    assert.ok(notices[2].includes('Meta Platforms'));
    await panel.getByText('关于与开源许可', { exact: true }).click();
    await panel.addInitScript(installSpeechFixture);
    await panel.evaluate(installSpeechFixture);
    await panel.getByText(SENTENCE, { exact: false }).first().waitFor({ timeout: 15_000 });

    // 首次未配置可以预览，但不会发出分析请求。
    await expect(panel.getByText('尚未配置 API Key', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    assert.equal(stub.scenario.modelCalls, 0);
    await panel.getByLabel('API Key', { exact: true }).fill('invalid-test-key');
    await panel.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('API Key 无效');
    await panel.getByLabel('API Key', { exact: true }).fill('e2e-test-key');
    await panel.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(panel.getByText('连接成功，当前模型可用。')).toBeVisible();
    if (process.env.E2E_SCREENSHOT === '1') await panel.screenshot({ path: '/private/tmp/readwise-ai-settings.png', fullPage: true });
    assert.equal(stub.scenario.modelCalls, 0, '连接测试不得发送选区或调用模型生成');
    await panel.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(panel.getByText('配置已保存，可以开始分析。')).toBeVisible();
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveValue('');
    // 重新打开面板仍只收到脱敏状态，浏览器会话内配置保留。
    await panel.reload();
    await expect(panel.getByText('已配置 · deepseek-flash', { exact: true })).toBeVisible();

    // ③ 点击分析 → ④ 展示结果
    // exact 必须打开：模式切换按钮"句子分析"也含"分析"二字，会命中多个元素
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await panel.getByText('原文 / 译文').waitFor({ timeout: 30_000 });
    await panel.getByText('虽然当时正在下雨，我们还是决定出门。').waitFor({ timeout: 30_000 });

    // 英文音色异步加载：不退回中文默认声线；选择英音、慢速后朗读原文。
    await expect(panel.getByRole('button', { name: '播放英文朗读', exact: true })).toBeDisabled();
    await panel.evaluate(() => {
      window.__speechMock.voices = [
        { name: 'Chinese', lang: 'zh-CN', voiceURI: 'Chinese', localService: true, default: true },
        { name: 'Samantha Enhanced', lang: 'en-US', voiceURI: 'Samantha', localService: true, default: false },
        { name: 'Daniel', lang: 'en-GB', voiceURI: 'Daniel', localService: true, default: false },
      ];
      speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
    await panel.getByLabel('口音', { exact: true }).selectOption('en-GB');
    await panel.getByLabel('语速', { exact: true }).selectOption('0.9');
    await panel.getByLabel('音色', { exact: true }).selectOption('Daniel');
    await panel.getByRole('button', { name: '播放英文朗读', exact: true }).click();
    await expect(panel.getByRole('button', { name: '停止朗读', exact: true })).toBeVisible();
    assert.deepEqual(await panel.evaluate(() => window.__speechMock.calls.at(-1)), {
      text: SENTENCE, lang: 'en-GB', rate: 0.9, voiceURI: 'Daniel',
    });
    await panel.getByRole('button', { name: '停止朗读', exact: true }).click();
    await expect(panel.getByRole('button', { name: '播放英文朗读', exact: true })).toBeVisible();
    if (process.env.E2E_SCREENSHOT === '1') await panel.screenshot({ path: '/private/tmp/readwise-sentence-reader.png', fullPage: true });

    const clauseVisible = await panel.getByText('让步状语从句').first().isVisible();
    assert.equal(clauseVisible, true, '应展示从句标签');

    // 结构片段经过插件侧一致性校验
    await panel.getByText('过去进行时').first().waitFor({ timeout: 10_000 });

    // ⑤ 第二个标签页没有选区时必须清空；返回第一页应恢复其选区。
    const second = await context.newPage();
    await second.goto(`http://127.0.0.1:${STUB_PORT}/?second`);
    await expect(panel.getByText('在网页中选中英文单词或句子，这里会显示预览。')).toBeVisible();
    await page.bringToFront();
    await expect(panel.getByText(SENTENCE, { exact: false }).first()).toBeVisible();
    await second.bringToFront();
    await selectText(second, '#word');
    await expect(panel.getByText('development', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await expect(panel.getByText('发展；开发')).toBeVisible();
    // 单词继承同一口音/语速；词典音频失败时用所选音色，不播放真实声音。
    await expect(panel.getByLabel('口音', { exact: true })).toHaveValue('en-GB');
    await expect(panel.getByLabel('语速', { exact: true })).toHaveValue('0.9');
    await panel.getByLabel('口音', { exact: true }).selectOption('en-US');
    await panel.getByLabel('来源', { exact: true }).selectOption('dictionary');
    await panel.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new Error('test missing audio')); });
    await panel.getByRole('button', { name: '播放英文朗读', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: '词典录音不可用' })).toBeVisible();
    assert.equal(await panel.evaluate(() => window.__speechMock.calls.at(-1).text), 'development');
    assert.equal(await panel.evaluate(() => window.__speechMock.calls.at(-1).voiceURI), 'Samantha');
    const cancelCount = await panel.evaluate(() => window.__speechMock.cancelled);

    // ⑥ 导航清除旧选区，不把上一文档带到新页面。
    await second.goto(`http://127.0.0.1:${STUB_PORT}/?navigated`);
    await expect.poll(() => panel.evaluate(() => window.__speechMock.cancelled)).toBeGreaterThan(cancelCount);
    await expect(panel.getByText('在网页中选中英文单词或句子，这里会显示预览。')).toBeVisible();
    await page.bringToFront();
    await expect(panel.getByText(SENTENCE, { exact: false }).first()).toBeVisible();

    // ⑦ 新的未缓存句子触发上游失败，错误卡可重试，恢复后成功。
    await page.evaluate(() => { document.querySelector('#sentence').textContent = 'Although it was raining, we decided to go out!'; });
    await selectText(page, '#sentence');
    await expect(panel.getByText('Although it was raining, we decided to go out!', { exact: true })).toBeVisible();
    stub.scenario.modelStatus = 503;
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await expect(panel.getByRole('button', { name: '重新尝试', exact: true })).toBeVisible();
    stub.scenario.modelStatus = 200;
    await panel.getByRole('button', { name: '重新尝试', exact: true }).click();
    await expect(panel.getByText('原文 / 译文')).toBeVisible();

    // ⑧ 慢响应期间选中新词：旧请求结束也不能覆盖新预览。
    await page.evaluate(() => { document.querySelector('#sentence').textContent = 'Although it was raining, we decided to go out?'; });
    await selectText(page, '#sentence');
    await expect(panel.getByText('Although it was raining, we decided to go out?', { exact: true })).toBeVisible();
    stub.scenario.delayMs = 1800;
    const calls = stub.scenario.modelCalls;
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await expect.poll(() => stub.scenario.modelCalls).toBeGreaterThan(calls);
    await selectText(page, '#word');
    await expect(panel.getByText('development', { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await expect(panel.getByText('development', { exact: true })).toBeVisible();
    await expect(panel.getByText('原文 / 译文')).toHaveCount(0);
    stub.scenario.delayMs = 0;

    // 词典未命中仍可通过 AI 查词；结构失败返回翻译降级。
    stub.scenario.dictionaryStatus = 404;
    await page.evaluate(() => { document.querySelector('#word').textContent = 'fallback'; });
    await selectText(page, '#word');
    await expect(panel.getByText('fallback', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await expect(panel.getByText('词典未命中，释义由 AI 兜底生成，仅供参考。')).toBeVisible();
    stub.scenario.dictionaryStatus = 200;
    stub.scenario.badStructure = true;
    await page.evaluate(() => { document.querySelector('#sentence').textContent = 'Although it was raining, we decided to go out;'; });
    await selectText(page, '#sentence');
    await expect(panel.getByText('Although it was raining, we decided to go out;', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await expect(panel.getByText('虽然当时正在下雨，我们还是决定出门。')).toBeVisible();
    await expect(panel.getByText('让步状语从句', { exact: true })).toHaveCount(0);
    stub.scenario.badStructure = false;

    // 保存新模型会清空旧结果，下一请求使用新模型。
    await panel.getByRole('button', { name: '配置 AI', exact: true }).click();
    await panel.getByLabel('模型', { exact: true }).selectOption('deepseek-v4-pro');
    await panel.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(panel.getByText('已配置 · deepseek-v4-pro', { exact: true })).toBeVisible();
    await expect(panel.getByText('原文 / 译文')).toHaveCount(0);
    await panel.getByRole('button', { name: '收起配置', exact: true }).click();
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    await expect(panel.getByText('让步状语从句', { exact: true })).toBeVisible();

    // 可选真实慢请求：验证旧的 20s 总超时已解除，Worker 等待期间可保活。
    if (process.env.E2E_SLOW === '1') {
      await page.evaluate(() => { document.querySelector('#sentence').textContent = 'Although it was raining, we decided to go out...'; });
      await selectText(page, '#sentence');
      await expect(panel.getByText('Although it was raining, we decided to go out...', { exact: true })).toBeVisible();
      stub.scenario.delayMs = 31_000;
      // 短文本单次读取仍为 15 秒，下面测试用插件长超时：原文填充到 >100 字符。
      const longText = 'Although it was raining, we decided to go out. Although it was raining, we decided to go out again.';
      await page.evaluate((text) => { document.querySelector('#sentence').textContent = text + ' Today.'; }, longText);
      await selectText(page, '#sentence');
      await expect(panel.getByText(longText + ' Today.', { exact: true })).toBeVisible();
      await panel.getByRole('button', { name: '分析', exact: true }).click();
      await panel.getByText('原文 / 译文').waitFor({ timeout: 50_000 });
      stub.scenario.delayMs = 0;
      console.log('✅ 31 秒长响应验证通过');
    }

    // 清除配置同时移除缓存，再分析引导配置且不发请求。
    await panel.getByRole('button', { name: '配置 AI', exact: true }).click();
    await panel.getByRole('button', { name: '清除配置', exact: true }).click();
    await expect(panel.getByText('尚未配置 API Key', { exact: true })).toBeVisible();
    const requestsBeforeClear = stub.scenario.modelCalls;
    await panel.getByRole('button', { name: '分析', exact: true }).click();
    assert.equal(stub.scenario.modelCalls, requestsBeforeClear);
    const cleared = await worker.evaluate(async () => ({
      configured: !!(await chrome.storage.local.get('aiSettings')).aiSettings,
      cache: (await chrome.storage.session.get('aiResultCache')).aiResultCache,
    }));
    assert.equal(cleared.configured, false); assert.equal(cleared.cache, undefined);

    // ⑨ 关闭活动标签页后清除其选区记录。
    const closedTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    await page.close();
    await expect.poll(() => worker.evaluate(async (id) => (await chrome.storage.session.get(`latestSelection:${id}`))[`latestSelection:${id}`] ?? null, closedTabId)).toBeNull();

    // 替换临时测试扩展使旧上下文失效，刷新后新脚本恢复工作。
    const reloadErrors = [];
    second.on('pageerror', (error) => reloadErrors.push(error.message));
    const panelClosed = panel.waitForEvent('close');
    const reloadCdp = await context.browser().newBrowserCDPSession();
    await reloadCdp.send('Extensions.uninstall', { id: extensionId });
    await panelClosed;
    await second.bringToFront();
    await selectText(second, '#word');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.deepEqual(reloadErrors, [], '重载后旧网页划词不得抛出未捕获的 context invalidated');
    // 重新安装同一构建，模拟更新后的新实例；不复用旧 Worker。
    const replacement = await reloadCdp.send('Extensions.loadUnpacked', { path: EXT_OUTPUT });
    await reloadCdp.detach();
    await second.reload();
    await selectText(second, '#word');
    // 旧 Worker 调试句柄会永久失效，用新扩展页面验证当前扩展实例。
    const recoveryPanel = await context.newPage();
    await recoveryPanel.goto(`chrome-extension://${replacement.id}/sidepanel.html`);
    await second.bringToFront();
    await expect.poll(() => recoveryPanel.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return (await chrome.storage.session.get(`latestSelection:${tab.id}`))[`latestSelection:${tab.id}`]?.text;
    })).toBe('development');
    assert.deepEqual(reloadErrors, [], '刷新后新划词脚本正常工作');
    console.log('✅ 上下文失效清理与网页刷新恢复通过');

    await verifyNewWindowPanel(recoveryPanel);

    console.log('✅ E2E 通过（无 Java 后端）：配置/连接测试/清除、划词分析、查词、标签页隔离、失败重试、旧响应隔离');
  } finally {
    if (context) await context.close();
    stub.close();
  }
}

// 原生标签页面板：切页时保留原实例，未打开的其他页没有面板。
async function verifyNewWindowPanel(control) {
  const windowId = await control.evaluate(async () => (await chrome.windows.getCurrent()).id);
  const ids = [];
  let otherWindow;
  let boundDocument;
  const createTab = async (active, url) => {
    const id = await control.evaluate(async ({ windowId, active, url }) =>
      (await chrome.tabs.create({ windowId, active, ...(url ? { url } : {}) })).id, { windowId, active, url });
    ids.push(id);
    await expect.poll(() => control.evaluate((tabId) => chrome.sidePanel.getOptions({ tabId }), id))
      .toEqual({ tabId: id, path: `sidepanel.html?tabId=${id}`, enabled: true });
    return id;
  };
  const contexts = (id) => control.evaluate(async (tabId) =>
    (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }))
      .filter((item) => item.documentUrl.endsWith(`/sidepanel.html?tabId=${tabId}`))
      .map((item) => item.contextId), id);
  const activate = (id) => control.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), id);
  try {
    await expect.poll(() => control.evaluate(() => chrome.sidePanel.getOptions({}))).toMatchObject({ enabled: false });
    const a = await createTab(true, `http://127.0.0.1:${STUB_PORT}/?panel-a`);
    const b = await createTab(false, `http://127.0.0.1:${STUB_PORT}/?panel-b`);
    await control.evaluate((tabId) => chrome.sidePanel.open({ tabId }), a);
    await expect.poll(() => contexts(a)).toHaveLength(1);
    const original = await contexts(a);
    await activate(b);
    await expect.poll(() => contexts(b)).toHaveLength(0);
    assert.deepEqual(await contexts(a), original, '切到 B 不能关闭 A 的原生面板实例');
    await activate(a);
    assert.deepEqual(await contexts(a), original, '返回 A 保留原面板实例');
    const c = await createTab(true); // 浏览器默认新标签页，覆盖加号/Command+T。
    assert.deepEqual(await contexts(a), original, '新标签页不能关闭 A');
    await expect.poll(() => contexts(c)).toHaveLength(0);
    await activate(b);
    await control.evaluate((tabId) => chrome.sidePanel.open({ tabId }), b);
    await expect.poll(() => contexts(b)).toHaveLength(1);
    await control.evaluate((tabId) => chrome.sidePanel.close({ tabId }), b);
    await expect.poll(() => contexts(b)).toHaveLength(0);
    await activate(a);
    assert.deepEqual(await contexts(a), original, '关闭 B 不影响 A');

    // 使用同一绑定 URL 的面板文档检查 React 状态，不依赖 Playwright 是否暴露原生面板 Page。
    const extensionBase = `chrome-extension://${new URL(control.url()).host}`;
    boundDocument = await control.context().newPage();
    await boundDocument.addInitScript(installSpeechFixture);
    await boundDocument.goto(`${extensionBase}/sidepanel.html?tabId=${a}`);
    await control.evaluate(() => chrome.runtime.sendMessage({ type: 'save-ai-settings', apiKey: 'e2e-test-key', model: 'deepseek-flash' }));
    await expect(boundDocument.getByText('已配置 · deepseek-flash', { exact: true })).toBeVisible();
    const articleA = control.context().pages().find((page) => page.url().endsWith('?panel-a'));
    const articleB = control.context().pages().find((page) => page.url().endsWith('?panel-b'));
    assert.ok(articleA && articleB);
    const nativePanel = await inspectNativePanel(control.context(), a);
    try {
      // 直接读取真实原生面板 DOM，覆盖同一页连续划词，不用扩展标签页代替。
      for (const [selector, text] of [['#word', 'development'], ['#sentence', SENTENCE], ['#word', 'development']]) {
        await selectText(articleA, selector);
        await expect.poll(() => nativePanel.text()).toContain(text);
      }
    } finally { await nativePanel.detach(); }
    await selectText(articleA, '#sentence');
    await expect(boundDocument.getByText(SENTENCE, { exact: true })).toBeVisible();
    await boundDocument.getByRole('button', { name: '分析', exact: true }).click();
    await expect(boundDocument.getByText('让步状语从句', { exact: true })).toBeVisible();
    await boundDocument.evaluate(() => {
      window.__speechMock.voices = [{ name: 'Samantha', lang: 'en-US', voiceURI: 'Samantha', localService: true, default: true }];
      speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
    await boundDocument.getByRole('button', { name: '播放英文朗读', exact: true }).click();
    const cancelled = await boundDocument.evaluate(() => window.__speechMock.cancelled);
    await activate(b);
    await expect.poll(() => boundDocument.evaluate(() => window.__speechMock.cancelled)).toBeGreaterThan(cancelled);
    await selectText(articleB, '#word');
    await expect.poll(() => control.evaluate(async (windowId) =>
      (await chrome.runtime.sendMessage({ type: 'get-latest-selection', windowId })).selection?.text, windowId)).toBe('development');
    await expect(boundDocument.getByText('让步状语从句', { exact: true })).toBeVisible();
    await expect(boundDocument.getByText('development', { exact: true })).toHaveCount(0);
    await activate(a);
    await expect(boundDocument.getByText('让步状语从句', { exact: true })).toBeVisible();
    otherWindow = await control.evaluate(async (url) =>
      (await chrome.windows.create({ url, type: 'normal' })).id, `http://127.0.0.1:${STUB_PORT}/?panel-window`);
    assert.deepEqual(await contexts(a), original, '新建窗口不影响 A');
    console.log('✅ 标签页面板：A 实例/分析结果保留，B/新标签页默认收起，B 独立开关，新窗口不关闭 A');
  } finally {
    if (boundDocument) await boundDocument.close();
    if (ids.length) await control.evaluate((tabIds) => chrome.tabs.remove(tabIds), ids);
    if (otherWindow !== undefined) await control.evaluate((id) => chrome.windows.remove(id), otherWindow);
  }
}

// Playwright 不暴露原生面板的 Page，使用临时测试浏览器的 CDP target 检查真实 DOM。
async function inspectNativePanel(context, tabId) {
  const cdp = await context.browser().newBrowserCDPSession();
  const target = (await cdp.send('Target.getTargets')).targetInfos.find((item) =>
    item.url.endsWith(`/sidepanel.html?tabId=${tabId}`));
  assert.ok(target, '应找到原生侧边栏 target');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let nextId = 0;
  return {
    async text() {
      const id = ++nextId;
      const response = new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener); };
        const listener = (event) => {
          if (event.sessionId !== sessionId) return;
          const message = JSON.parse(event.message);
          if (message.id !== id) return;
          cleanup();
          if (message.error || message.result?.exceptionDetails) reject(new Error('读取原生面板 DOM 失败'));
          else resolve(message.result.result.value);
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error('读取原生面板超时')); }, 5000);
        cdp.on('Target.receivedMessageFromTarget', listener);
      });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate',
        params: { expression: 'document.body.innerText', returnByValue: true } }) });
      return response;
    },
    async detach() { await cdp.send('Target.detachFromTarget', { sessionId }); await cdp.detach(); },
  };
}

// 仅测试浏览器 API 调用与状态，声音由用户设备决定；不播放真实音频。
function installSpeechFixture() {
  const state = { voices: [], calls: [], cancelled: 0, current: null };
  const synth = new EventTarget();
  synth.getVoices = () => state.voices;
  synth.speak = (item) => {
    state.calls.push({ text: item.text, lang: item.lang, rate: item.rate, voiceURI: item.voice?.voiceURI });
    state.current = item;
    queueMicrotask(() => item.onstart?.());
  };
  synth.cancel = () => { state.cancelled++; state.current = null; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  window.__speechMock = state;
}

async function selectText(page, selector) {
  await page.evaluate((selector) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

async function waitForExtensionId(context, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      const match = /chrome-extension:\/\/([a-z]+)\//.exec(worker.url());
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('未能获取扩展 ID：扩展未成功加载（确认已 npm run build，且未在其他 Chrome 中占用同一目录）');
}

function exists(p) {
  return existsSync(p);
}

main().catch((e) => {
  console.error('❌ E2E 失败：', e.stack ?? e.message);
  process.exit(1);
});
