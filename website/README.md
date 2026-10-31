# WestieLens 静态介绍网站

独立的中英文 HTML/CSS/JS 网站，用于功能展示、安装教程、隐私说明和安装/源码下载。没有账号、Key 输入或模型调用，不需要 Java。原创网站代码同项目采用 GPL-3.0-only。

## 语言与页面

- 中文首页 `/`，英文首页 `/en/`，中文保持默认。
- 中文隐私说明 `/privacy.html`，英文隐私说明 `/en/privacy.html`。
- 通过页头语言链接明确切换，不读取浏览器语言强制跳转，也不保存语言 Cookie。
- 两种语言共用 CSS、交互脚本、五张真实截图及固定版本的安装/源码包。`locales.js` 只提供英文交互文案，密钥和模型调用逻辑仍在插件中。
- 英文页明确：插件面向中文用户，界面与学习解释为中文；网站双语不改变插件本身。

## 构建

Node.js 22+，不需要 npm 安装。仓库根目录的 release/ 应包含固定版本 0.1.0-beta.1 的已验证 Chrome ZIP、对应源码 ZIP 和 SHA256SUMS。首发源码包对应同名 Git 标签，不随介绍网站修改而替换成其他插件版本源码。构建会在复制前校验两份附件的 SHA-256。

```bash
node website/build.mjs
```

其他附件位置可通过 WESTIELENS_RELEASE_DIR 环境变量指定。缺少附件或校验不通过时构建失败，避免发布空下载入口。dist/ 为生成目录，不提交 Git。

## 预览

```bash
cd website/dist
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 http://127.0.0.1:4173。静态服务器不应用 Cloudflare 的 _headers，仅部署后生效。

## Cloudflare Pages 免费静态部署

在自己的 Cloudflare 账户中创建 Pages 直接上传项目，上传 dist/ 的内容，或将该目录内容压缩后上传。ZIP 根目录应直接包含 index.html，不包含外层 dist/。使用平台分配的 pages.dev 默认地址，不需要配置 IP、端口、Java 或模型密钥。

也可使用官方 Wrangler：

```bash
npx wrangler login
npx wrangler pages deploy website/dist --project-name westielens --branch main
```

需要先存在同名 Pages 项目；操作前确认是自己的目标账户。不要将 OAuth 凭据、API Token 或 .wrangler 状态加入 Git。不添加 Pages Functions，不开通 Containers 或付费套餐。直接上传项目以后不能直接切换成 Git 集成项目，如需切换需另建项目。

## 内容与边界

- 使用项目自己的西高地图标；展示用户提供的五张实际使用截图，原图不改写。图片支持切换、弹窗放大和打开原图；阅读截图标注原网站来源。
- 截图切换和图片查看只加载本站图片，不调用模型服务。复制按钮仅复制扩展管理页地址。
- 不使用第三方字体、CDN、广告或统计脚本。托管平台处理访问信息的说明见 privacy.html。
- 插件尚未上架 Chrome Web Store，用户需手动安装并配置自己的 DeepSeek Key，调用费用由用户承担。
- 页面提供同一版本的安装包与对应源码，随站附带 GPLv3、NOTICE 和第三方声明。

## 本轮验收

- 首屏明确 Chrome 英文阅读插件；主按钮和导航直接下载 WestieLens 插件 ZIP，安装教程另设入口。
- 三个核心场景：阅读现场、单词释义、句子分析。缩略图仅通过 CSS 展示局部，五份原始截图保持不变，仍可放大查看。
- 四步图文教程：下载解压、加载到 Chrome、配置 DeepSeek Key、划词分析；右键与配置截图在教程中展示。
- 调整字号、间距、圆角及手机布局，移除重复功能介绍。没有 Token/充值/可用次数估算。
- 已验证三种场景切换与大图/Esc 关闭，四步教程在 320/390/768/1280px 下无横向溢出，下载文件校验匹配。
- 当前仅本地验收，未提交或推送网站代码、未部署 Cloudflare；须等用户验收后继续发布。

双语验收：中英首页、隐私页和动态截图/复制提示均可切换；英文四步教程在 320/390/768/1280px 下无横向溢出，隐私页在 320/390/768px 下无横向溢出，中文交互回归正常。当前仍待用户验收，未部署。
