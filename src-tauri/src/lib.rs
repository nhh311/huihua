mod catalog;
mod commands;
mod config;
mod deepseek;
mod gallery;
mod paths;
mod planner;
mod presets;
mod providers;
mod styles;
mod workshop;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// 前端用它在「有任务在跑」时拦住窗口关闭，改成询问：托盘后台继续，还是退出并中断。
#[derive(Default)]
pub struct BusyState(AtomicBool);

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let _ = paths::ensure_dirs();
            // `$APPDATA`（appDataDir）指向 `%APPDATA%\com.huihua.desktop`，
            // 而图片实际存放在 `%APPDATA%\绘话`。配置里的 scope 用 `$DATA`
            // 指向 `%APPDATA%`；这里再把真实目录在运行时显式授权一次，
            // 避免 asset 协议因路径不在白名单里而拒绝加载图片。
            let root = paths::dirs().root;
            if let Err(error) = app.asset_protocol_scope().allow_directory(&root, true) {
                eprintln!("[绘话] 图片目录授权失败: {error}");
            }
            // 预设库的示例图随安装包分发，放在 install 目录下的 resources/presets。
            // 这里在运行时同样显式授权一次，避免 asset 协议拒绝读取。
            if let Ok(dir) = presets::root(app.handle()) {
                if let Err(error) = app.asset_protocol_scope().allow_directory(&dir, true) {
                    eprintln!("[绘话] 预设图目录授权失败: {error}");
                }
            }

            // 托盘：关窗口不退出，任务可以继续跑在后台。
            let show = MenuItemBuilder::with_id("show", "打开绘话").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出绘话").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            if let Some(icon) = app.default_window_icon().cloned() {
                let _tray = TrayIconBuilder::with_id("main")
                    .icon(icon)
                    .tooltip("绘话")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            // 有任务时先拦下关闭，让前端弹「保留后台 / 退出并中断」。
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let busy = handle.state::<BusyState>();
                        if busy.0.load(Ordering::Relaxed) {
                            api.prevent_close();
                            let _ = handle.emit("app:close-requested", ());
                        }
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::ChatState::default())
        .manage(providers::GenerateState::default())
        .manage(BusyState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_open_data_dir,
            commands::app_show_item,
            commands::app_open_external,
            commands::app_set_busy,
            commands::app_hide_to_tray,
            commands::app_quit,
            commands::config_get,
            commands::config_update,
            commands::config_reset,
            commands::config_test,
            commands::chat_start,
            commands::chat_abort,
            commands::chat_title,
            commands::chat_upload,
            commands::workshop_start,
            commands::workshop_abort,
            commands::models_catalog,
            commands::models_all,
            commands::models_probe,
            commands::planner_plan,
            commands::generate_start,
            commands::generate_abort,
            commands::styles_list,
            commands::styles_get,
            commands::styles_save,
            commands::styles_delete,
            presets::presets_catalog,
            presets::presets_favorite,
            presets::presets_use,
            presets::presets_install,
            presets::presets_adapt,
            presets::presets_import,
            presets::presets_remove_user,
            commands::gallery_list,
            commands::gallery_remove,
            commands::gallery_trash,
            commands::gallery_restore,
            commands::gallery_purge,
            commands::gallery_empty_trash,
            commands::gallery_export,
            commands::gallery_export_as,
            commands::save_text_file,
            commands::gallery_reveal,
            commands::gallery_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 绘话");
}
