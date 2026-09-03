import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * pdf.js 需要 4 类「运行时按需 fetch」的辅助资源，Vite 不会自动打包它们：
 *   - wasm/            CCITT(G4 传真) / JBIG2 / JPX 图像解码器 + qcms 色彩变换
 *   - cmaps/           CJK 预定义编码（UniGB-UCS2-H 等）的字形映射
 *   - standard_fonts/  非嵌入的标准字体（宋体 / SimSun 等）替换字形
 *   - iccs/            CMYK 的 ICC 色彩配置
 *
 * worker 内部按 `${wasmUrl}${filename}` 拼接后 fetch，默认 wasmUrl 为 null，
 * 会退化成相对 worker 脚本的路径 —— 打包后即 dist/jbig2.wasm，文件并不存在。
 * 后果是扫描版 PDF（CCITT / JPX）与中文非嵌入字体 PDF 整页空白，而 Chrome
 * 内置的 PDFium 有原生解码器，所以同一个文件在浏览器里显示正常。
 *
 * 这里在 dev / build 前把它们同步到 public/pdfjs/，由 Vite 原样提供；
 * 实际 URL 前缀在 src/lib/pdf.ts 里通过 wasmUrl 等选项告知 pdf.js。
 */
const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"] as const;

/** 定位 pdfjs-dist 包目录（pnpm 链接 / 直接安装两种布局都要覆盖） */
function resolvePdfjsDist(): string {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve("pdfjs-dist/package.json"));
  } catch {
    const fallback = resolve(root, "node_modules/pdfjs-dist");
    if (!existsSync(fallback)) {
      throw new Error("找不到 pdfjs-dist，请先安装依赖");
    }
    return fallback;
  }
}

function pdfjsAssets(): Plugin {
  const outDir = join(root, "public/pdfjs");

  const sync = () => {
    const srcDir = resolvePdfjsDist();
    mkdirSync(outDir, { recursive: true });
    for (const dir of PDFJS_ASSET_DIRS) {
      cpSync(join(srcDir, dir), join(outDir, dir), { recursive: true });
    }
  };

  return {
    name: "pdfjs-assets",
    // 用 config 钩子：早于 dev server 的 publicDir 静态中间件创建，
    // 保证 dev 下首次请求即可命中，无需重启
    config() {
      sync();
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
