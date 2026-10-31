# 插件直连端到端测试

运行真实 Content Script、Background、配置界面、分析编排、校验、缓存与 React 面板。**不启动 Java 后端，不需要真实密钥。** Playwright 拦截两个官方 API 域名并返回测试数据，DNS 规则也禁止这两个域名落到真实外网。

## 执行

```bash
cd extension
npm ci
npm run build
npm run e2e
# 额外检查 31 秒长响应：
E2E_SLOW=1 npm run e2e
```

macOS 安装 Google Chrome 时默认选用本机 Chrome；其他系统有 Chrome 时可指定 `E2E_BROWSER=chrome`；CI 使用 Playwright Chromium。两种浏览器均通过 CDP `Extensions.loadUnpacked` 加载扩展并使用独立临时 profile，确保后续 `Extensions.uninstall` 可卸载同一类测试扩展。不要改回 `--load-extension`，该方式加载的扩展不能由此卸载接口卸载。

CI 浏览器的本地复现方式：

```bash
npx playwright install chromium
E2E_BROWSER=chromium npm run e2e
```

## 覆盖

- 未配置密钥仍能划词预览，但不发分析请求。
- 错误密钥提示；测试连接只读模型列表、不发选区、不自动保存。
- 保存后清空输入框、刷新面板仍显示脱敏配置状态。
- 无后端划词分析、中文查词、词典未命中 AI 兜底、结构失败译文降级。
- 句子原文朗读、异步英文音色加载、英美音选择、语速及偏好继承、停止和切页取消；词典音频失败回退所选音色。语音引擎被测试替身替换，不播放真实声音，也不验证主观音质。
- 标签页隔离、导航/关闭清理、上游失败重试、旧响应不覆盖新选区。
- 模型修改清空旧结果，下一请求使用新配置；清除配置同时清除缓存。
- 可选 31 秒长响应验证 Worker 活动维持与长文本请求超时。
- 在独立 Chrome/Chromium 配置中卸载并重新加载临时测试扩展，使旧网页上下文失效；旧网页划词不抛未捕获异常，刷新后新 Content Script 恢复选区上报。
- 原生标签页面板：A 打开后保存 contextId，切到 B/新标签页、单独开关 B、创建独立窗口后，A 的 contextId 仍保留；未打开的 B/新页面没有面板上下文。核对默认面板禁用和各页独立配置，不通过关闭整窗面板模拟切页。
- 绑定面板文档：A 分析并启动模拟朗读后切到 B，确认朗读取消；B 划词后 A 的结果仍保留且不显示 B 的单词，返回 A 后原结果仍在。界面检查使用与原生面板相同的 ?tabId 绑定地址；实例保留另由原生 SIDE_PANEL 上下文验证。菜单并发初始化与 lastError 在单测中覆盖。
- 通过临时测试浏览器 CDP 直接检查原生侧边栏 DOM：同一网页依次选择单词、句子、单词，确认顶部预览连续更新。该项不使用扩展标签页面板代替原生侧边栏。

分析面板文档在扩展标签页运行（400px 宽）；独立打开策略另有原生 SIDE_PANEL 上下文测试，使用当前测试浏览器的 open/close、getContexts 和标签页配置 API。自动化未覆盖原生右键点击、原生容器布局或真实声音。本轮发布前仍需手动验收 Chrome；Edge 适配与验收延期，不作为本轮发布条件。

测试仅监听 8123 作为网页 fixture，端口占用会失败，不会停止其他服务。结束自动关闭测试浏览器和 fixture 服务。

官方依据：[Playwright Service Worker 请求拦截](https://playwright.dev/docs/service-workers)、[CDP 扩展加载接口](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-loadUnpacked)。
