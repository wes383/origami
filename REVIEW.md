# Origami PDF 阅读器 — 项目评审与改进建议

> 评审日期：2026-09-01 ｜ 代码基线：git log 最新 `1c41e62 feat: add print and page rotation`

---

## 一、项目画像

### 技术栈
| 层 | 选型 | 备注 |
|---|---|---|
| 桌面壳 | Tauri 2（Rust 侧仅 19 行 lib.rs） | 无边框窗口 + `tauri-plugin-frame`（本地 patch） |
| 前端 | React 19 + TypeScript 5.8 + Vite 7 | `strict` + `noUnusedLocals` 全开 |
| PDF 引擎 | pdf.js 6.2（**纯前端渲染**） | worker 通过 `?url` 引入 |
| 样式 | 手写 CSS（2482 行 global.css） | CSS 变量 + `data-theme` 切换 |
| 状态 | 全部 `useState` + `useRef`，无状态库 | 持久化走 localStorage |

### 已实现能力（13 次提交积累）
打开/拖放、最近文件、缩放（fit-width / fit-page / 自定义 25–500%）、单双页、滚动/翻页两种模式、
页面旋转、目录树（自动展开当前章节）、缩略图懒渲染、全文查找 + 归一化高亮、页码范围打印、
10 语言 i18n、明暗/跟随系统主题、**AI 划词翻译**（OpenAI 兼容、多模型档案）、Wikipedia 名词解释、
文本层选区、Windows 11 Snap Layout。

### 代码质量总评：**良好，明显高于同类个人项目**
值得肯定的具体做法：

- **意图与状态解耦**：`jumpTarget` / `focusMatchId` 是"待执行的意图"，执行完由子组件回调清空，
  避免了"父组件 state 一变就触发滚动，与滚动又反过来改 state"的经典死循环（`App.tsx:45-46`）。
- **滚动动画自研缓动**：`PdfViewer.tsx:210-257` 每帧重算终点，解决懒渲染回填高度导致"落到目标页前一两页"。
- **注释解释 Why 而非 What**：大量「为什么这么写」（如 `PdfPage` 里 dpr transform 的 1/dpr² 陷阱）。
- **边界处理扎实**：`suppressTrackRef`、`INTENT_WINDOW` 防触摸板惯性翻页、`endOfContent` 空白选区补丁。

### 结构性风险
1. **`App.tsx` 已成"上帝组件"**：601 行、30+ 个 `useState`，同时承担文件生命周期、缩放计算、
   搜索编排、打印、侧边栏、键盘。新增任何一个功能都会继续往里加 state。
2. **状态全在内存**：关闭文档即丢失，无任何偏好/进度持久化（除最近文件、AI 配置、主题、语言）。
3. **工程化缺位**：无 ESLint（代码里已有 `eslint-disable` 注释但没装）、无 Prettier、无测试、无 CI、无 release 流程。

---

## 二、建议修改（Bug 与体验修正）

### P0 — 明确缺陷，建议尽快修

#### 1. 翻页模式 → 滚动模式切换会丢失阅读位置
`App.tsx:529`
```tsx
key={`${fileName}-${pageLayout}-${flipMode}`}
```
`flipMode` 进 key 会导致整个 `PdfViewer` 重挂载。从 paged（第 137 页）切到 scroll 时：
新实例渲染全部页但 `scrollTop = 0`，`currentPage` 仍是 137 → **视图在第 1 页、页码显示 137**，
随后 IntersectionObserver 立刻上报 page 1 并把 `currentPage` 改成 1，阅读位置彻底丢失。
> 建议：key 只保留 `fileName`；切换时补一次 `setJumpTarget(currentPage)`，让既有的滚动动画接管定位。

#### 2. 在 `setState` updater 里执行副作用（StrictMode 下会跑两次）
`App.tsx:127-130` 与 `171-174`
```tsx
setPdf((prev) => { void prev?.destroy(); return opened; });   // ← updater 内的副作用
```
`main.tsx` 开了 `React.StrictMode`，updater 会被调用两次 → `task.destroy()` 执行两次。
虽然 pdf.js 的 destroy 大概率幂等，但这是 React 明令禁止的反模式。
> 建议：把旧文档存 `useRef`，在 `loadFile` / `closeFile` 的函数体里显式 destroy。

#### 3. 单页模式存在双层嵌套 + `data-page` 重复
`PdfViewer.tsx:377-386`（scroll + single 分支）
```tsx
<div className="pdf-slot" ref={registerPage} data-page={i+1}>   {/* 外层也注册 */}
  {renderPage(i + 1, ...)}   {/* 内层 div.pdf-pair-page 又注册同一个 page */}
</div>
```
同一个 Map key 被覆写；`querySelector('[data-page="N"]')`（跳转/定位用）命中文档顺序靠前的外层，
与 IO 观察的内层不是同一元素，滚动定位会差一个 margin。
> 建议：single 分支直接渲染 `<PdfPage>`（与 paged + single 分支一致），不要走 `renderPage` 包装。

#### 4. fit 按钮首次点击语义错位
`App.tsx:264-280` `toggleFit`：初始 `fitIntent = "fit-width"`、`scaleMode = "fit-width"`，
但按钮 **图标/ tooltip 显示的是"适应宽度"**。用户看到"适应宽度"按钮，点一下的语义却是
"锁定当前适应宽度倍率并切换到 custom"，按钮才变成"适应页面"。第一次点击的预期与结果不符。
> 建议：改为两个独立按钮（适应宽度 / 适应页面），或首次点击直接应用对方模式而非锁定当前值。

#### 5. 加密 PDF 直接报"文件无效"
`lib/pdf.ts:16` `getDocument({ data })` 未传 `password` / `onPassword`。
带密码的 PDF 只会落到 `catch → errorInvalid`，用户无从得知"这是加密文档、需要输密码"。
> 建议：传入 `onPassword` 回调，弹一个密码输入框（最多重试 3 次）。

#### 6. 打印：大文档内存风险 + 进度回调没接
- `lib/print.ts:35-62`：所有页先 `toDataURL("image/jpeg")` 全部塞进 DOM 再 `window.print()`。
  100 页 × 2x 位图可轻松突破数百 MB，WebView2 有 OOM 风险。
- `printDocument(doc, pages, onProgress)` 支持进度回调，`App.tsx:407` 没传 → 长时间只有个 spinner。
> 建议：接上 `onProgress` 显示 `12/100`；改成分批追加 / 降低 `PRINT_SCALE` / 直接把 canvas 放进打印 DOM（不转 dataURL）。

### P1 — 体验层面

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| 7 | 全局禁用右键菜单，选中文本后只能靠气泡复制 | `App.tsx:196-200` | 改为**自定义右键菜单**（复制 / 翻译 / Wikipedia / 查找），禁用原生菜单即可 |
| 8 | 关闭文档后重开从第 1 页开始，缩放与布局也不记忆 | — | 按文件路径哈希持久化 `{page, scale, scaleMode, layout, flipMode}` |
| 9 | 大文档搜索无进度、无取消按钮，`getTextContent` 每页重跑无缓存 | `lib/search.ts` | 显示「已扫描 23/480 页」+ 停止按钮；页面文本做 LRU 缓存供搜索与 AI 上下文复用 |
| 10 | 无页面渲染缓存，翻回上一页要重渲染，paged 模式翻页有闪烁 | `PdfPage.tsx` | 维护 LRU（约 8 页）缓存已渲染 canvas，命中时跳过 render |
| 11 | 响应式断点分散硬编码：App 720px、Toolbar 560px、CSS 媒体查询各写各的 | `App.tsx:31`、`Toolbar.tsx:26` | 统一收敛到 CSS 变量或 `const BREAKPOINTS` 常量 |
| 12 | `PdfPage` 未 `memo`，`highlights` 每次 render 生成新数组 → 全量页重渲染 | `PdfViewer.tsx:330` | `React.memo(PdfPage)` + `useMemo` 缓存 highlights 数组 |
| 13 | 缩略图每次打开文档全部重渲染 | `Sidebar.tsx` | 复用文本/位图缓存，或按文档指纹落盘 |
| 14 | `closeFile` 未重置 `jumpTarget`、`fitScale`、`fitPageScale` | `App.tsx:170-192` | 补齐，避免下次打开文档瞬间被旧意图带偏 |

### P2 — 工程与安全

| # | 问题 | 建议 |
|---|---|---|
| 15 | API Key 明文存 localStorage，且 `csp: null`（`tauri.conf.json:26`） | Key 用 `tauri-plugin-stronghold` 或经 Rust 侧加密存储；CSP 至少设 `connect-src 'self' ipc: asset: https:` |
| 16 | 无 ESLint / Prettier / CI / 测试 | 先加 ESLint（代码里已有 disable 注释说明作者有此意识），再上 `tauri-action` 自动打包 |
| 17 | `recent.ts:43` `clearRecent` 是死代码（无调用方） | 删掉，或在 EmptyState 补「清空全部最近记录」按钮 |
| 18 | `withGlobalTauri: true` 长期保留会增加攻击面 | 若无需全局注入，建议关闭并显式 import |
| 19 | 拖放只取 `paths[0]`，多文件静默丢弃 | 提示"一次只能打开一个文件" |
| 20 | i18n 靠 `Record<LangKeys, string>` 类型保证完整性（这点很好），但缺运行时兜底告警 | dev 环境检测缺失 key 并 `console.warn` |

---

## 三、新功能建议

按「价值 × 成本」排序，分三档：

### 第一档：高价值 / 低成本（1～2 周可全部落地）

1. **文件关联 + 命令行打开**（**最高优先级**）
   用 `tauri-plugin-single-instance` + `tauri-plugin-cli` + `bundle.fileAssociations`，
   支持「双击 PDF 直接打开」「设为默认阅读器」「已运行时复用窗口」。
   **没有它，Origami 永远只是个不能当主力阅读器的应用。**
2. **阅读进度与偏好记忆** — 见 P1-8。
3. **自定义右键菜单** — 见 P1-7，替换当前的全局禁用。
4. **PDF 内部链接跳转** — `page.getAnnotations()` 取 `LinkAnnotation`，渲染透明热区。
   论文参考文献、目录内链、外部 URL 都能点，教科书级刚需。
5. **加密 PDF 密码框** — 见 P0-5。
6. **目录过滤框** — 上百条的教材目录加个搜索框即可（`Sidebar.tsx`）。
7. **窗口尺寸/位置记忆** — `tauri-plugin-window-state`，20 行代码。
8. **快捷键体系** — 目前只有 Ctrl+F / Ctrl+P / 方向键，缺：`Ctrl+0/+=/-`、`Ctrl+/-`、`F` 全屏、
   `Ctrl+D` 书签、`?` 快捷键帮助面板。

### 第二档：差异化（延续你已有的 AI 方向）

9. **AI 侧栏面板**（而非只有浮层）：整页 / 整章摘要、术语表生成、针对当前页的问答（多轮）。
   复用 `aiTranslate.ts` 的 profile 体系与 `buildContext` 逻辑，成本可控。
10. **流式输出**：当前 `stream: false`，长句翻译要干等。改 SSE 解析后逐字上屏，体感提升巨大。
11. **AI 结果缓存**：同一词/同一句不重复计费，落 localStorage 或侧车文件。
12. **摘录 / 生词本**：划词后一键存入，可导出 Markdown 或 Anki 卡片。
13. **翻译结果固定在侧栏**：当前卡片一点击外部就消失，做长文档精读时很憋屈。

### 第三档：重型功能（需先完成架构重构）

14. **标注系统**：高亮 / 下划线 / 便签，JSON 侧车文件存储，与 Sidebar 整合。
15. **多标签页 / 多文档并排**。
16. **TTS 朗读**（Web Speech API 起步，后续可接云端）。
17. **导出**：页面转 PNG / 整篇文本导出。
18. **阅读主题**：护眼米黄、夜间反色（把白皮书反转成黑底白字，长文阅读刚需）。

---

## 四、建议落地顺序

**批次一（短期，修缺陷 + 体验补课）**
> P0 的 6 个缺陷 → 阅读进度记忆 → 文件关联/命令行 → 自定义右键菜单 → 窗口状态记忆

**批次二（中期，重构 + 差异化）**
> 先做架构重构（见下）→ AI 侧栏 → 流式输出 → 内部链接跳转 → 目录过滤 → 快捷键面板

**批次三（长期）**
> 标注系统 → 多标签 → TTS → 导出 → 阅读主题

### 附：为第三档准备的架构重构

`App.tsx` 现在 30+ state 已经到临界点，建议在做标注/多文档之前先抽出三个 hook：

```
src/hooks/
  useDocument.ts    // 文件生命周期：loadFile / closeFile / outline / numPages / 进度持久化
  useZoom.ts        // scaleMode / scale / fit 计算 / container 尺寸上报
  useSearch.ts      // 查询、结果集、activeMatch、进度与取消
```

`App.tsx` 退化成纯编排层，预计能从 601 行降到 250 行左右。这一步做完，第三档功能的边际成本会显著下降。
