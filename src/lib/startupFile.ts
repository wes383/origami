/** 启动文件处理：双击 PDF / "打开方式" 启动时接收文件路径（Rust 侧 single-instance 支撑） */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 取走「本次启动命令行里带的 PDF 路径」（双击文件进入时非空，只会返回一次） */
export async function takeStartupFile(): Promise<string | null> {
  try {
    const path = await invoke<string | null>("take_startup_file");
    return path && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * 监听后续实例的打开文件请求（单实例：双击 PDF 时由已运行窗口接收）。
 * 返回取消监听的函数。
 */
export async function onOpenFile(
  handler: (path: string) => void
): Promise<UnlistenFn> {
  return listen<string>("open-file", (event) => {
    if (event.payload) handler(event.payload);
  });
}
