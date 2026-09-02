use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_frame::FramePluginBuilder;

/** 首次启动时命令行里带的 PDF 路径（双击文件 / "打开方式"），前端就绪后取走一次 */
struct StartupFile(Mutex<Option<String>>);

/** 判断是否应作为待打开文档处理的命令行参数 */
fn is_pdf_arg(arg: &str) -> bool {
    !arg.starts_with('-') && arg.to_ascii_lowercase().ends_with(".pdf")
}

/** 前端就绪后调用：取走启动参数里的文件路径（只返回一次） */
#[tauri::command]
fn take_startup_file(state: tauri::State<'_, StartupFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 首个实例：直接读自己的命令行参数
    let startup_file = std::env::args().skip(1).find(|a| is_pdf_arg(a));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // 已在运行时：把后续实例的命令行参数转发给当前窗口后直接退出
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.iter().skip(1).find(|a| is_pdf_arg(a)) {
                let _ = app.emit("open-file", path.clone());
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .manage(StartupFile(Mutex::new(startup_file)))
        .plugin(
            FramePluginBuilder::new()
                .auto_titlebar(true) // 自动应用到所有窗口
                .snap_overlay(true) // Windows 11 Snap Layout
                .titlebar_height(52) // 与前端工具栏等高，hover 背景覆盖整行
                .button_width(46) // Win11 标准按钮宽度
                .build(),
        )
        .invoke_handler(tauri::generate_handler![take_startup_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
