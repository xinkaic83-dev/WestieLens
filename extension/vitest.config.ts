/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 纯函数 + 模拟浏览器 API 的 Background/请求边界测试；真实浏览器由 e2e 覆盖。
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
