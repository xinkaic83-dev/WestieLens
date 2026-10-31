/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      // 从仓库根目录复制，避免打包后的许可文本与源码仓库漂移。
      for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt']) {
        files.push({
          absoluteSrc: fileURLToPath(new URL(`../${name}`, import.meta.url)),
          relativeDest: name === 'LICENSE' ? 'LICENSE.txt' : name,
        });
      }
    },
  },
  manifest: {
    name: 'WestieLens',
    description: '英文阅读辅助：划词翻译、句子成分分析、语法讲解与单词音标',
    icons: {
      16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png',
      96: 'icon/96.png', 128: 'icon/128.png',
    },
    action: {
      default_title: 'WestieLens',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
    },
    // 最小权限集合（§4.1.1）；未使用 chrome.scripting，故不加 scripting
    // contextMenus 用于 §4.1.2 的 v0.2 右键菜单增强
    permissions: ['sidePanel', 'activeTab', 'storage', 'contextMenus'],
    // 只允许两个官方 API；不接受消息或配置指定自定义请求地址。
    host_permissions: ['https://api.deepseek.com/*', 'https://api.dictionaryapi.dev/*'],
    minimum_chrome_version: '114',
  },
  vite: () => ({
    // Tailwind CSS 4 经 @tailwindcss/vite 集成（§3.1）；Vite 8 底层为 Rolldown，
    // 不要沿用 Rollup 的 manualChunks 配置
    plugins: [tailwindcss()],
  }),
});
