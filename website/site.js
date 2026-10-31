/* SPDX-License-Identifier: GPL-3.0-only */
import { englishContent } from "/locales.js";
const isEnglish = document.documentElement.lang.startsWith("en");
const shots = {
  reading: {
    file: 'reading-sentence.png', width: 3420, height: 1904, layout: 'wide',
    label: '阅读现场', kicker: '01 / 在原网页里学习',
    title: '原文在左边，理解在手边。',
    alt: 'News in Levels 真实阅读现场：左侧选中英文句子，右侧 WestieLens 展示对应译文、朗读与句子成分',
    description: '在 News in Levels 选中一句英文，右侧就能查看译文、朗读和句子分析。原文留在视线里，阅读可以接着往下走。',
    points: ['划词后，侧边栏更新选区预览。', '点击“分析”，再生成对应结果。', '回到原标签页，保留已打开的面板和结果。'],
  },
  sentence: {
    file: 'sentence-detail.png', width: 984, height: 1900, layout: 'portrait',
    label: '句子分析', kicker: '03 / 不只翻译，也看结构',
    title: '这句话，为什么这样写？',
    alt: '真实句子分析详情：Canada makes a big sea park，展示中文译文、朗读、主语 Canada、谓语 makes、宾语和目的状语及语法解释',
    description: '从 Canada makes a big sea park 这句新闻原文出发，先读译文，再把主语、谓语、宾语和目的状语逐项看清。',
    points: ['对照原文和中文译文，不脱离语境。', '查看句子主干、成分及其作用。', '解释 to save 的目的用法和一般现在时。'],
  },
  word: {
    file: 'reading-word.png', width: 3420, height: 1904, layout: 'wide',
    label: '单词释义', kicker: '02 / 在上下文里认识生词',
    title: '遇到 substance，顺手查一下。',
    alt: '真实查词截图：网页选中 substance，WestieLens 展示英美音标、中文名词释义和英文朗读设置',
    description: '读到不熟悉的单词，选中后切到“查词/短语”。释义、英美音标和朗读都在侧边栏，不必离开文章。',
    points: ['查看中文释义和词性。', '对照英美 IPA，听听实际发音。', '可以选择口音、语速与可用英文音色。'],
  },
  context: {
    file: 'context-menu.png', width: 1584, height: 1768, layout: 'portrait',
    label: '右键入口', kicker: '04 / 从选中的词直接开始',
    title: '选中，右键，打开伴读。',
    alt: 'Chrome 实际右键菜单：选中 substance 后出现“用 WestieLens 分析 substance”的菜单项',
    description: '不用先找工具栏图标。在网页中选中英文，右键选择“用 WestieLens 分析…”，即可打开当前页的侧边栏。',
    points: ['单词和句子都可以从右键入口打开。', '侧边栏打开后先显示选区预览。', '点击面板里的“分析”，再生成结果。'],
  },
  settings: {
    file: 'ai-settings.png', width: 946, height: 1904, layout: 'portrait',
    label: '配置 AI', kicker: '05 / 使用自己的 DeepSeek 账户',
    title: '填好 Key，就能开始。',
    alt: '插件实际首次配置界面：空 API Key 输入框、模型选择、测试连接与保存配置，以及密钥本地保存提示',
    description: '在插件侧边栏中填写自己的 DeepSeek API Key，测试连接后保存。不需要 Java，也不需要购买服务器；网站不会要求你提交 Key。',
    points: ['测试连接可以刷新账号可用模型。', 'Key 保存在浏览器本地，不进行同步。', 'API 调用费用由你自己的 DeepSeek 账户承担。'],
  },
};

if (isEnglish) {
  for (const [id, copy] of Object.entries(englishContent.shots)) {
    if (Object.hasOwn(shots, id)) Object.assign(shots[id], copy);
  }
}
const dialog = document.getElementById('image-dialog');
function openShot(id) {
  if (!Object.hasOwn(shots, id)) return;
  const shot = shots[id];
  const image = document.getElementById('image-dialog-image');
  image.src = `/assets/${shot.file}`;
  image.alt = shot.alt;
  image.width = shot.width;
  image.height = shot.height;
  dialog.dataset.layout = shot.layout;
  document.getElementById('image-dialog-title').textContent = shot.label;
  document.getElementById('image-original').href = image.src;
  dialog.showModal();
  dialog.querySelector('.image-dialog-body').scrollTop = 0;
}

document.querySelectorAll('[data-open-shot]').forEach(button => {
  button.addEventListener('click', () => openShot(button.dataset.openShot));
});
document.getElementById('image-dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

document.querySelectorAll('[data-shot]').forEach(button => {
  button.addEventListener('click', () => {
    const id = button.dataset.shot;
    if (!Object.hasOwn(shots, id)) return;
    const shot = shots[id];
    document.querySelectorAll('[data-shot]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const image = document.getElementById('gallery-image');
    image.src = `/assets/${shot.file}`;
    image.alt = shot.alt;
    image.width = shot.width;
    image.height = shot.height;
    document.getElementById('screenshot-panel').dataset.layout = id;
    document.getElementById('reading-pair').hidden = id !== 'reading';
    document.getElementById('gallery-crop').hidden = id === 'reading';
    const open = document.getElementById('gallery-open');
    open.dataset.openShot = id;
    open.setAttribute('aria-label', isEnglish ? `View full ${shot.label.toLowerCase()} screenshot` : `放大查看${shot.label}截图`);
    document.getElementById('shot-kicker').textContent = shot.kicker;
    document.getElementById('shot-title').textContent = shot.title;
    document.getElementById('shot-description').textContent = shot.description;
    document.getElementById('shot-points').replaceChildren(...shot.points.map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
  });
});

document.querySelectorAll('[data-guide]').forEach(button => {
  button.addEventListener('click', () => {
    const panel = document.getElementById(`guide-${button.dataset.guide}`);
    if (!panel) return;
    document.querySelectorAll('[data-guide]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('.guide-panel').forEach(item => { item.hidden = item !== panel; });
  });
});

document.getElementById('copy-extensions')?.addEventListener('click', async () => {
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText('chrome://extensions');
    status.textContent = isEnglish ? englishContent.copySuccess : '已复制，粘贴到 Chrome 地址栏即可。';
  } catch {
    status.textContent = isEnglish ? englishContent.copyFallback : '请手动复制：chrome://extensions';
  }
});
