use tauri_plugin_frame::FramePluginBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            FramePluginBuilder::new()
                .auto_titlebar(true)   // 自动应用到所有窗口
                .snap_overlay(true)    // Windows 11 Snap Layout
                .titlebar_height(52)   // 与前端工具栏等高，hover 背景覆盖整行
                .button_width(46)      // Win11 标准按钮宽度
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
