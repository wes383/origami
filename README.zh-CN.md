# Origami

简洁的桌面 PDF 阅读器，基于 Tauri v2 + React + TypeScript 构建，专为 Windows 平台做适配。

[English](README.md) | 简体中文

## 功能特性

- **阅读**：翻页导航、滚轮缩放、适应宽度/页面、单双页布局、滚动/翻页模式、旋转
- **导航**：目录大纲、页面缩略图、全文搜索
- **翻译**：选中文本后通过 AI 翻译或 Wikipedia 查词，结果显示在右侧面板
- **其他**：文件属性、打印、最近文件、浅色/深色主题、10 种界面语言、快捷键、全屏

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面外壳 | Tauri v2 (Rust) |
| 前端 | React 19 + TypeScript + Vite |
| PDF 渲染 | pdfjs-dist v6 |
| 包管理 | pnpm |

## 开发

前置要求：Node.js 22+、pnpm 9+、Rust stable（含 MSVC 工具链）。

```bash
pnpm install      # 安装依赖
pnpm tauri dev    # 启动开发模式（热更新）
```

## 构建

```bash
pnpm tauri build  # 产物位于 src-tauri/target/release/bundle/ 下
```
