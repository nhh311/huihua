use crate::{catalog, config, deepseek, gallery, paths, planner, providers, styles, workshop};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 有任务在跑时标记一下，窗口关闭会被拦下来交给前端询问。
#[tauri::command]
pub fn app_set_busy(state: State<'_, crate::BusyState>, busy: bool) {
    state
        .0
        .store(busy, std::sync::atomic::Ordering::Relaxed);
}

/// 藏到托盘，任务继续在后台跑。
#[tauri::command]
pub fn app_hide_to_tray(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "窗口不存在".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

/// 直接退出（仅用于用户明确选择「退出并中断」时）。
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}
use tokio::sync::Mutex;

#[derive(Default)]
pub struct ChatState {
    active: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

fn open_path(path: &std::path::Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_info() -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "electron": "Tauri 2",
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "dataDir": paths::dirs().root.to_string_lossy(),
    })
}

#[tauri::command]
pub fn app_open_data_dir() -> Result<(), String> {
    open_path(&paths::dirs().root)
}

#[tauri::command]
pub fn app_show_item(path: String) -> Result<(), String> {
    Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_open_external(url: String) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn config_get() -> Value {
    config::sanitize(&config::load())
}

#[tauri::command]
pub fn config_update(patch: Value) -> Result<Value, String> {
    let mut current = config::load();
    config::update(&mut current, &patch)?;
    Ok(config::sanitize(&current))
}

#[tauri::command]
pub fn config_reset() -> Result<Value, String> {
    Ok(config::sanitize(&config::reset()?))
}

#[tauri::command]
pub async fn config_test(
    provider: String,
    key: Option<String>,
    base_url: Option<String>,
) -> Result<Value, String> {
    let config = config::load();
    if provider == "deepseek" {
        let key = key
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .unwrap_or_else(|| config.deepseek.key.clone());
        if key.is_empty() {
            return Err("请先填写 DeepSeek API Key".into());
        }
        let base = base_url
            .filter(|x| !x.trim().is_empty())
            .unwrap_or_else(|| config.deepseek.base_url.clone());
        deepseek::verify_key(&key, &base).await?;
        return Ok(json!({ "ok": true }));
    }
    providers::probe(provider, key, base_url).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn chat_start(
    app: AppHandle,
    state: State<'_, ChatState>,
    request_id: String,
    body: Value,
) -> Result<Value, String> {
    let config = config::load();
    let key = config::key_of(&config, "deepseek");
    if key.is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let base = config::base_of(&config, "deepseek");
    let mut body = body;
    if let Some(object) = body.as_object_mut() {
        // The renderer only sends conversation content; the model and thinking
        // settings are fixed by the desktop app (DeepSeek Flash + deep thinking).
        object.insert("model".into(), json!("deepseek-flash"));
        object.insert("thinking".into(), json!({ "type": "enabled" }));
        object.insert("output_config".into(), json!({ "effort": deepseek::EFFORT_HIGH }));
    } else {
        return Err("请求内容格式不正确".into());
    }
    let app_handle = app.clone();
    let id = request_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut stream = Box::pin(deepseek::stream_chat(&key, &base, &body, tx));
        let mut result: Option<Result<(), String>> = None;
        let emit = |mut payload: Value| {
            if let Some(object) = payload.as_object_mut() {
                object.insert("requestId".into(), json!(id.clone()));
            }
            let _ = app_handle.emit("chat:event", payload);
        };
        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(event) => emit(event),
                        None => break,
                    }
                }
                outcome = &mut stream => {
                    result = Some(outcome);
                    break;
                }
            }
        }
        while let Ok(event) = rx.try_recv() {
            emit(event);
        }
        if let Some(Err(error)) = result {
            emit(json!({ "type": "error", "message": error }));
        }
    });
    state.active.lock().await.insert(request_id, handle);
    Ok(json!({ "started": true }))
}

#[tauri::command]
pub async fn chat_abort(
    app: AppHandle,
    state: State<'_, ChatState>,
    request_id: String,
) -> Result<bool, String> {
    let handle = state.active.lock().await.remove(&request_id);
    if let Some(handle) = handle {
        handle.abort();
        let _ = app.emit(
            "chat:event",
            json!({ "requestId": request_id, "type": "aborted" }),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn workshop_start(
    app: AppHandle,
    state: State<'_, ChatState>,
    request_id: String,
    body: Value,
    stage: Option<String>,
) -> Result<Value, String> {
    let config = config::load();
    let key = config::key_of(&config, "deepseek");
    if key.is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let base = config::base_of(&config, "deepseek");
    let stage_kind = stage.unwrap_or_else(|| "analysis".into());
    let (system, default_tokens) = match stage_kind.as_str() {
        "spec" => (workshop::SPEC_PROMPT, 12000),
        "compile" => (workshop::COMPILE_PROMPT, 4000),
        _ => (workshop::SYSTEM_PROMPT, 8000),
    };
    let mut body = body;
    if let Some(object) = body.as_object_mut() {
        // 创意工坊固定 DeepSeek Flash + 深度思考 max，前端不能覆盖。
        object.insert("model".into(), json!("deepseek-flash"));
        object.insert("thinking".into(), json!({ "type": "enabled" }));
        object.insert(
            "output_config".into(),
            json!({ "effort": deepseek::EFFORT_MAX }),
        );
        object.insert("system".into(), json!(system));
        object.entry("max_tokens").or_insert(json!(default_tokens));
    } else {
        return Err("请求内容格式不正确".into());
    }
    let app_handle = app.clone();
    let id = request_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut stream = Box::pin(deepseek::stream_chat(&key, &base, &body, tx));
        let mut result: Option<Result<(), String>> = None;
        let emit = |mut payload: Value| {
            if let Some(object) = payload.as_object_mut() {
                object.insert("requestId".into(), json!(id.clone()));
            }
            let _ = app_handle.emit("workshop:event", payload);
        };
        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(event) => emit(event),
                        None => break,
                    }
                }
                outcome = &mut stream => {
                    result = Some(outcome);
                    break;
                }
            }
        }
        while let Ok(event) = rx.try_recv() {
            emit(event);
        }
        if let Some(Err(error)) = result {
            emit(json!({ "type": "error", "message": error }));
        }
    });
    state.active.lock().await.insert(request_id, handle);
    Ok(json!({ "started": true }))
}

#[tauri::command]
pub async fn workshop_abort(
    app: AppHandle,
    state: State<'_, ChatState>,
    request_id: String,
) -> Result<bool, String> {
    let handle = state.active.lock().await.remove(&request_id);
    if let Some(handle) = handle {
        handle.abort();
        let _ = app.emit(
            "workshop:event",
            json!({ "requestId": request_id, "type": "aborted" }),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn chat_upload(
    name: String,
    mime: String,
    buffer: Vec<u8>,
    purpose: Option<String>,
) -> Result<Value, String> {
    let config = config::load();
    let key = config::key_of(&config, "deepseek");
    if key.is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let base = config::base_of(&config, "deepseek");
    deepseek::upload_file(&key, &base, buffer, &name, &mime, purpose).await
}

const TITLE_SYSTEM: &str = "你是会话标题助手。根据给出的对话内容，用不超过 14 个汉字概括这次对话主要想做什么，只输出标题本身：不要引号、不要书名号、不要结尾标点、不要解释。";

fn clean_title(text: &str) -> String {
    let trimmed = text
        .trim()
        .trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\'' | '“' | '”' | '‘' | '’' | '「' | '」' | '『' | '』' | '《' | '》'
            )
        })
        .trim_end_matches(|c: char| matches!(c, '。' | '．' | '.' | '！' | '!' | '？' | '?'))
        .trim();
    let line = trimmed.lines().next().unwrap_or("").trim();
    let cleaned: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() > 18 {
        cleaned.chars().take(18).collect()
    } else {
        cleaned
    }
}

#[tauri::command]
pub async fn chat_title(messages: Value) -> Result<String, String> {
    let config = config::load();
    let key = config::key_of(&config, "deepseek");
    if key.is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let base = config::base_of(&config, "deepseek");
    let text = deepseek::complete_text(&key, &base, TITLE_SYSTEM, messages, 48, false, deepseek::EFFORT_HIGH).await?;
    let title = clean_title(&text);
    if title.is_empty() {
        return Err("没有拿到标题".into());
    }
    Ok(title)
}

#[tauri::command]
pub fn models_catalog() -> Vec<catalog::ProviderView> {
    catalog::list(&config::load())
}

#[tauri::command]
pub fn models_all() -> Vec<catalog::ProviderView> {
    catalog::all(&config::load())
}

#[tauri::command]
pub async fn models_probe(
    provider: String,
    key: Option<String>,
    base_url: Option<String>,
) -> Result<Value, String> {
    providers::probe(provider, key, base_url).await
}

#[tauri::command]
pub async fn planner_plan(input: planner::PlannerInput) -> Result<Value, String> {
    let plan = planner::plan(input).await?;
    Ok(json!({ "plan": plan }))
}

#[tauri::command]
pub async fn generate_start(
    app: AppHandle,
    state: State<'_, providers::GenerateState>,
    request_id: String,
    plan: planner::Plan,
    refs: Vec<String>,
    session_id: String,
) -> Result<Value, String> {
    providers::generate(app, state, request_id, plan, refs, session_id).await
}

#[tauri::command]
pub async fn generate_abort(
    state: State<'_, providers::GenerateState>,
    request_id: String,
) -> Result<bool, String> {
    providers::abort(state, request_id).await
}

#[tauri::command]
pub fn styles_list() -> Vec<styles::Style> {
    styles::list()
}

#[tauri::command]
pub fn styles_get(id: String) -> Option<styles::Style> {
    styles::get(&id)
}

#[tauri::command]
pub fn styles_save(input: styles::StyleInput) -> Result<styles::Style, String> {
    styles::save(input)
}

#[tauri::command]
pub fn styles_delete(id: String) -> Result<bool, String> {
    styles::remove(&id)
}

#[tauri::command]
pub fn gallery_list() -> Vec<gallery::GalleryItem> {
    gallery::list()
}

#[tauri::command]
pub fn gallery_remove(id: String) -> Result<bool, String> {
    gallery::remove(&id)
}

#[tauri::command]
pub fn gallery_trash() -> Vec<gallery::TrashEntry> {
    gallery::trash_list()
}

#[tauri::command]
pub fn gallery_restore(id: String) -> Result<gallery::GalleryItem, String> {
    gallery::restore(&id)
}

#[tauri::command]
pub fn gallery_purge(id: String) -> Result<bool, String> {
    gallery::purge(&id)
}

#[tauri::command]
pub fn gallery_empty_trash() -> Result<u32, String> {
    gallery::empty_trash()
}

/// 导出原图：弹系统保存对话框，用户选完才写文件；取消就什么都不做。
#[tauri::command]
pub fn gallery_export_as(app: AppHandle, id: String) -> Result<Value, String> {
    let item = gallery::get(&id).ok_or_else(|| "作品不存在".to_string())?;
    let ext = std::path::Path::new(&item.file)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("png")
        .to_string();
    let name = format!("绘话-{}.{}", item.id, ext);
    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("图片", &[ext.as_str()])
        .blocking_save_file()
    else {
        return Ok(json!({ "canceled": true }));
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let written = gallery::export_to(&id, &path.to_string_lossy())?;
    Ok(json!({ "canceled": false, "path": written }))
}

/// 导出 JSON 备份也走系统对话框，避免 WebView 的 <a download> 落到未知目录。
#[tauri::command]
pub fn save_text_file(app: AppHandle, name: String, content: String) -> Result<Value, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(json!({ "canceled": true }));
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(json!({ "canceled": false, "path": path.to_string_lossy() }))
}

/// 兼容旧调用：仍然直接导出到「下载」目录，但文件名带时间，避免覆盖。
#[tauri::command]
pub fn gallery_export(app: AppHandle, id: String) -> Result<Value, String> {
    let item = gallery::get(&id).ok_or_else(|| "作品不存在".to_string())?;
    let ext = std::path::Path::new(&item.file)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("png");
    let name = format!("绘话-{}.{}", item.id, ext);
    let dir = dirs::download_dir()
        .or_else(|| dirs::picture_dir())
        .unwrap_or_else(|| paths::dirs().root);
    let destination = dir.join(name);
    let path = gallery::export_to(&id, &destination.to_string_lossy())?;
    let _ = app;
    Ok(json!({ "path": path }))
}

#[tauri::command]
pub fn gallery_reveal(id: String) -> Result<(), String> {
    let path = gallery::file_for(&id, false).ok_or_else(|| "作品不存在".to_string())?;
    Command::new("explorer")
        .arg(format!("/select,{}", path.to_string_lossy()))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Fallback for the WebView: return the stored image as a `data:` URL when the
/// asset protocol cannot serve it.
#[tauri::command]
pub fn gallery_preview(id: String, thumb: Option<bool>) -> Result<String, String> {
    gallery::inline(&id, thumb.unwrap_or(true))
}
