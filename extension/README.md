# WestieLens 扩展

WXT + React + TypeScript。用户在侧边栏配置 DeepSeek API Key，Background 直接调用官方模型和词典，不依赖本地 Java 后端。

```bash
npm ci
npm run dev
# 或构建后手动加载 .output/chrome-mv3
npm run build
```

使用 Chrome 的开发者模式加载构建目录，点击扩展图标 → 配置 AI → 测试连接 → 保存配置 → 网页划词 → 点击分析。本轮仅支持和验收 Chrome；Edge 适配暂缓。

```bash
npm test
npm run compile
npm run e2e
```

完整说明见[项目 README](../README.md)、[当前开发规格](../docs/开发说明书.md)、[v1.0 验收清单](../docs/v1.0验收清单.md)、[E2E](e2e/README.md)。

本版本原创代码采用 [GPL-3.0-only](../LICENSE)。打包时自动附带 GPLv3 正文、原项目 NOTICE 和部分第三方声明，界面“关于与开源许可”可查看。分发安装包应同时提供对应源码，见[许可说明](../docs/许可证与分发.md)。
