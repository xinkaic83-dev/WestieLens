# 西高地白梗标识

2026-10-28 按用户最新要求改为西高地白梗头像：白色毛发与立耳，淡绿色圆形底，底形外透明，无文字。

- `westie-master.png`：当前标识，通过内置 imagegen 生成的原始 PNG，1254×1254，保留透明通道。未使用第三方参考图片。
- `../../public/icon/`：由原图等比缩小的 16、32、48、96、128 像素 PNG，替换原有模板图标。
- 扩展清单显式配置管理页图标和工具栏图标；侧边栏标题与 favicon 使用同一套文件。

原图作为项目设计源文件保存，不被界面直接引用。生成小图使用 macOS 自带的 sips：

```bash
cd extension
for size in 16 32 48 96 128; do
  sips -z "$size" "$size" assets/branding/westie-master.png --out "public/icon/$size.png"
done
```

后续调整图案时保留透明背景，并检查工具栏小尺寸和深浅背景的辨识度。标识变更不代表产品工作名已完成发布前核查。
