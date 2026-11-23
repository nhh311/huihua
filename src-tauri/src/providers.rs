use crate::catalog;
use crate::config;
use crate::gallery::{self, NewImage};
use crate::planner::Plan;
use base64::Engine;
use reqwest::RequestBuilder;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{watch, Mutex};

#[derive(Default)]
pub struct GenerateState {
    active: Mutex<HashMap<String, watch::Sender<bool>>>,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(620))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn normalize_base(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn v1(base: &str) -> String {
    let base = normalize_base(base);
    if base.to_ascii_lowercase().ends_with("/v1") {
        base
    } else {
        format!("{}/v1", base)
    }
}

fn base_for(config: &config::Config, provider: &str, override_base: Option<&str>) -> String {
    let configured = match provider {
        "seedream" => &config.providers.seedream.base_url,
        "minimax" => &config.providers.minimax.base_url,
        "hunyuan" => &config.providers.hunyuan.base_url,
        _ => "",
    };
    normalize_base(override_base.unwrap_or(configured))
}

fn key_for(config: &config::Config, provider: &str, override_key: Option<&str>) -> String {
    if let Some(key) = override_key.map(str::trim).filter(|x| !x.is_empty()) {
        return key.to_string();
    }
    config::key_of(config, provider)
}

fn error_text(text: &str, status: u16) -> String {
    if let Ok(body) = serde_json::from_str::<Value>(text) {
        if let Some(message) = body
            .get("error")
            .and_then(|x| x.get("message"))
            .and_then(Value::as_str)
        {
            return message.to_string();
        }
        if let Some(message) = body.get("message").and_then(Value::as_str) {
            return message.to_string();
        }
        if let Some(message) = body
            .get("base_resp")
            .and_then(|x| x.get("status_msg"))
            .and_then(Value::as_str)
        {
            return message.to_string();
        }
        if let Some(message) = body.get("error_msg").and_then(Value::as_str) {
            return message.to_string();
        }
    }
    if text.trim().is_empty() {
        format!("HTTP {}", status)
    } else {
        text.to_string()
    }
}

fn cancelled() -> String {
    "已取消".into()
}

async fn send_cancellable(
    request: RequestBuilder,
    cancel: &mut watch::Receiver<bool>,
) -> Result<reqwest::Response, String> {
    if *cancel.borrow() {
        return Err(cancelled());
    }
    tokio::select! {
        result = request.send() => result.map_err(|e| e.to_string()),
        _ = cancel.changed() => Err(cancelled()),
    }
}

async fn post_json(
    url: &str,
    key: &str,
    body: &Value,
    timeout: Duration,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Value, String> {
    let mut last_error = String::new();
    for attempt in 0..2 {
        if *cancel.borrow() {
            return Err(cancelled());
        }
        let request = client()
            .post(url)
            .bearer_auth(key)
            .timeout(timeout)
            .json(body);
        let response = send_cancellable(request, cancel).await?;
        let status = response.status();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            return serde_json::from_str(&text)
                .map_err(|_| "服务返回的不是 JSON".to_string());
        }
        last_error = error_text(&text, status.as_u16());
        let retryable = status.as_u16() == 429 || status.is_server_error();
        if !retryable || attempt == 1 {
            return Err(last_error);
        }
        tokio::time::sleep(Duration::from_millis(900)).await;
    }
    Err(last_error)
}

fn mini_max_body(model: &catalog::ModelView, plan: &Plan, refs: &[String]) -> Value {
    let count = plan.count.clamp(1, model.count_max.max(1));
    let ratio = if model.ratios.iter().any(|x| x == &plan.ratio) {
        plan.ratio.clone()
    } else {
        model.default_ratio.clone()
    };
    let area = if model.resolutions.iter().any(|x| x == &plan.resolution) {
        plan.resolution.clone()
    } else {
        model.default_resolution.clone()
    };
    let mut body = json!({
        "model": model.id,
        "prompt": plan.prompt,
        "n": count,
        "aspect_ratio": ratio,
        "area": area,
        "response_format": "url",
        "output_format": "png",
    });
    if !refs.is_empty() {
        let images: Vec<Value> = refs
            .iter()
            .map(|url| json!({ "image_url": url }))
            .collect();
        body["images"] = Value::Array(images);
    }
    body
}

fn seedream_body(model: &catalog::ModelView, plan: &Plan, refs: &[String]) -> Value {
    let max_area = if model.id.contains("5-5") {
        4_624_220.0
    } else {
        16_777_216.0
    };
    let size = catalog::size_for("seedream", &plan.ratio, &plan.resolution, Some(max_area));
    let mut body = json!({
        "model": model.id,
        "prompt": plan.prompt,
        "size": size.size,
        "response_format": "url",
        "watermark": false,
    });
    if !model.id.contains("5-5") {
        body["sequential_image_generation"] = json!("disabled");
    }
    if !refs.is_empty() {
        body["image"] = Value::Array(refs.iter().map(|x| json!(x)).collect());
    }
    body
}

fn hunyuan_body(model: &catalog::ModelView, plan: &Plan, refs: &[String]) -> Value {
    let mut content = vec![json!({ "type": "text", "text": plan.prompt })];
    for url in refs {
        content.push(json!({ "type": "image_url", "image_url": { "url": url } }));
    }
    let size = catalog::size_for("hunyuan", &plan.ratio, &plan.resolution, None);
    let mut body = json!({
        "model": model.id,
        "messages": [{ "role": "user", "content": content }],
        "size": size.size,
    });
    if let Some(seed) = plan.seed {
        if seed >= 0 {
            body["seed"] = json!(seed);
        }
    }
    body
}

fn urls_from_minimax(value: &Value) -> Result<Vec<String>, String> {
    if let Some(base) = value.get("base_resp") {
        let code = base
            .get("status_code")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if code != 0 {
            return Err(base
                .get("status_msg")
                .and_then(Value::as_str)
                .unwrap_or("MiniMax 返回错误")
                .to_string());
        }
    }
    let mut out = Vec::new();
    if let Some(data) = value.get("data") {
        let list = if let Some(array) = data.as_array() {
            array.clone()
        } else if let Some(array) = data.get("image_urls").and_then(Value::as_array) {
            array.clone()
        } else if let Some(array) = data.get("images").and_then(Value::as_array) {
            array.clone()
        } else {
            Vec::new()
        };
        for entry in list {
            if let Some(url) = entry.as_str() {
                out.push(url.to_string());
            } else if let Some(url) = entry.get("url").and_then(Value::as_str) {
                out.push(url.to_string());
            } else if let Some(url) = entry.get("image_url").and_then(Value::as_str) {
                out.push(url.to_string());
            } else if let Some(b64) = entry.get("b64_json").and_then(Value::as_str) {
                out.push(format!("data:image/png;base64,{}", b64));
            }
        }
    }
    if out.is_empty() {
        return Err(value
            .get("error")
            .and_then(|x| x.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("MiniMax 没有返回图片")
            .to_string());
    }
    Ok(out)
}

fn urls_from_seedream(value: &Value) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    if let Some(list) = value.get("data").and_then(Value::as_array) {
        for entry in list {
            if let Some(url) = entry.get("url").and_then(Value::as_str) {
                out.push(url.to_string());
            } else if let Some(b64) = entry.get("b64_json").and_then(Value::as_str) {
                out.push(format!("data:image/png;base64,{}", b64));
            }
        }
    }
    if out.is_empty() {
        return Err(value
            .get("error")
            .and_then(|x| x.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Seedream 没有返回图片")
            .to_string());
    }
    Ok(out)
}

fn url_from_hunyuan(value: &Value) -> Result<String, String> {
    if value.get("error").is_some() && !value["error"].is_null() {
        return Err(value["error"]
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("混元返回错误")
            .to_string());
    }
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|x| x.first());
    if let Some(choice) = choice {
        if choice.get("finish_reason").and_then(Value::as_str) == Some("error") {
            return Err(value
                .get("error")
                .and_then(|x| x.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("混元生成失败")
                .to_string());
        }
        if let Some(url) = choice
            .get("delta")
            .and_then(|x| x.get("image"))
            .and_then(|x| x.get("url"))
            .and_then(Value::as_str)
        {
            return Ok(url.to_string());
        }
    }
    Err("混元没有返回图片".into())
}

async fn download_image(
    url: &str,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(Vec<u8>, String), String> {
    if let Some(rest) = url.strip_prefix("data:") {
        let (head, body) = rest.split_once(',').ok_or_else(|| "图片 data URL 格式不正确".to_string())?;
        let mime = head
            .split(';')
            .next()
            .unwrap_or("image/png")
            .to_string();
        let bytes = if head.ends_with(";base64") {
            base64::engine::general_purpose::STANDARD
                .decode(body)
                .map_err(|_| "图片 base64 解码失败".to_string())?
        } else {
            body.as_bytes().to_vec()
        };
        return Ok((bytes, mime));
    }
    let request = client().get(url);
    let response = send_cancellable(request, cancel).await?;
    if !response.status().is_success() {
        return Err(format!("图片下载失败：HTTP {}", response.status().as_u16()));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok((bytes, mime))
}

fn emit(app: &AppHandle, request_id: &str, mut payload: Value) {
    if let Some(object) = payload.as_object_mut() {
        object.insert("requestId".into(), json!(request_id));
    }
    let _ = app.emit("generate:event", payload);
}

async fn save_image(
    app: &AppHandle,
    request_id: &str,
    plan: &Plan,
    session_id: &str,
    index: u32,
    url: &str,
    cancel: &mut watch::Receiver<bool>,
) -> Result<gallery::GalleryItem, String> {
    let (buffer, mime) = download_image(url, cancel).await?;
    let item = gallery::add_buffer(
        &buffer,
        NewImage {
            prompt: plan.prompt.clone(),
            provider: plan.provider.clone(),
            model: plan.model.clone(),
            ratio: plan.ratio.clone(),
            resolution: plan.resolution.clone(),
            seed: plan.seed,
            session_id: session_id.to_string(),
            style_id: plan.style_id.clone(),
            count_index: index,
            mime,
        },
    )?;
    emit(app, request_id, json!({ "type": "image", "item": item }));
    Ok(item)
}

pub async fn generate(
    app: AppHandle,
    state: State<'_, GenerateState>,
    request_id: String,
    plan: Plan,
    refs: Vec<String>,
    session_id: String,
) -> Result<Value, String> {
    let config = config::load();
    let model = catalog::find(&config, &plan.provider, &plan.model)
        .ok_or_else(|| "这个模型不在当前模型目录里，请重新选择".to_string())?;
    let key = config::key_of(&config, &plan.provider);
    if key.is_empty() {
        return Err(format!(
            "还没有填写 {} 的 API Key",
            config::provider_name(&plan.provider)
        ));
    }
    let base = base_for(&config, &plan.provider, None);
    let mut clean_refs: Vec<String> = refs
        .into_iter()
        .filter(|x| x.len() > 20)
        .collect();
    if clean_refs.len() > model.ref_max as usize {
        clean_refs.truncate(model.ref_max as usize);
        emit(
            &app,
            &request_id,
            json!({
                "type": "warning",
                "message": format!("{} 最多接收 {} 张参考图，已忽略多出的部分", model.name, model.ref_max)
            }),
        );
    }

    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    state.active.lock().await.insert(request_id.clone(), cancel_tx);
    let result = run_generate(
        &app,
        &request_id,
        &plan,
        &model,
        &base,
        &key,
        &clean_refs,
        &session_id,
        &mut cancel_rx,
    )
    .await;
    state.active.lock().await.remove(&request_id);
    result
}

#[allow(clippy::too_many_arguments)]
async fn run_generate(
    app: &AppHandle,
    request_id: &str,
    plan: &Plan,
    model: &catalog::ModelView,
    base: &str,
    key: &str,
    refs: &[String],
    session_id: &str,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Value, String> {
    let total = plan.count.clamp(1, model.count_max.min(4));
    let mut saved: Vec<gallery::GalleryItem> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let timeout = Duration::from_secs(if plan.provider == "minimax" { 600 } else { 300 });

    let outcome: Result<(), String> = async {
        if plan.provider == "minimax" {
            let body = mini_max_body(model, plan, refs);
            let value = post_json(
                &format!("{}/v1/images/{}", normalize_base(base), if refs.is_empty() { "generations" } else { "edits" }),
                key,
                &body,
                timeout,
                cancel,
            )
            .await?;
            let urls = urls_from_minimax(&value)?;
            let actual = urls.len().min(total as usize);
            if actual < total as usize {
                emit(
                    app,
                    request_id,
                    json!({
                        "type": "warning",
                        "message": format!("MiniMax 只返回了 {} 张，少于请求的 {} 张", actual, total)
                    }),
                );
            }
            for (index, url) in urls.iter().take(actual).enumerate() {
                match save_image(app, request_id, plan, session_id, index as u32, url, cancel).await {
                    Ok(item) => {
                        saved.push(item);
                        emit(
                            app,
                            request_id,
                            json!({ "type": "progress", "done": saved.len(), "total": total }),
                        );
                    }
                    Err(error) => {
                        errors.push(error.clone());
                        emit(
                            app,
                            request_id,
                            json!({ "type": "warning", "message": format!("第 {} 张保存失败：{}", index + 1, error) }),
                        );
                    }
                }
            }
        } else if plan.provider == "seedream" {
            let body = seedream_body(model, plan, refs);
            for index in 0..total {
                if *cancel.borrow() {
                    return Err(cancelled());
                }
                let value = post_json(
                    &format!("{}/images/generations", normalize_base(base)),
                    key,
                    &body,
                    timeout,
                    cancel,
                )
                .await?;
                let urls = urls_from_seedream(&value)?;
                match save_image(app, request_id, plan, session_id, index, &urls[0], cancel).await {
                    Ok(item) => {
                        saved.push(item);
                        emit(
                            app,
                            request_id,
                            json!({ "type": "progress", "done": saved.len(), "total": total }),
                        );
                    }
                    Err(error) => {
                        errors.push(error.clone());
                        emit(
                            app,
                            request_id,
                            json!({ "type": "warning", "message": format!("第 {} 张生成失败：{}", index + 1, error) }),
                        );
                    }
                }
            }
        } else {
            let body = hunyuan_body(model, plan, refs);
            for index in 0..total {
                if *cancel.borrow() {
                    return Err(cancelled());
                }
                let value = post_json(
                    &format!("{}/wand/hunyuan-image/v35-generation", v1(base)),
                    key,
                    &body,
                    timeout,
                    cancel,
                )
                .await?;
                let url = url_from_hunyuan(&value)?;
                match save_image(app, request_id, plan, session_id, index, &url, cancel).await {
                    Ok(item) => {
                        saved.push(item);
                        emit(
                            app,
                            request_id,
                            json!({ "type": "progress", "done": saved.len(), "total": total }),
                        );
                    }
                    Err(error) => {
                        errors.push(error.clone());
                        emit(
                            app,
                            request_id,
                            json!({ "type": "warning", "message": format!("第 {} 张生成失败：{}", index + 1, error) }),
                        );
                    }
                }
            }
        }
        Ok(())
    }
    .await;

    if let Err(error) = outcome {
        if error == cancelled() {
            emit(app, request_id, json!({ "type": "aborted" }));
            return Ok(json!({ "aborted": true, "results": saved, "errors": errors }));
        }
        return Err(error);
    }
    if saved.is_empty() {
        return Err(errors
            .first()
            .cloned()
            .unwrap_or_else(|| "没有生成出任何图片".into()));
    }
    emit(
        app,
        request_id,
        json!({
            "type": "done",
            "succeeded": saved.len(),
            "failed": errors.len(),
            "total": total
        }),
    );
    Ok(json!({ "aborted": false, "results": saved, "errors": errors }))
}

pub async fn abort(state: State<'_, GenerateState>, request_id: String) -> Result<bool, String> {
    let guard = state.active.lock().await;
    if let Some(sender) = guard.get(&request_id) {
        let _ = sender.send(true);
        Ok(true)
    } else {
        Ok(false)
    }
}

pub async fn probe(
    provider: String,
    key: Option<String>,
    base_url: Option<String>,
) -> Result<Value, String> {
    let config = config::load();
    let key = key_for(&config, &provider, key.as_deref());
    if key.is_empty() {
        return Err("请先填写 API Key".into());
    }
    let base = base_for(&config, &provider, base_url.as_deref());
    let client = client();
    let (url, auth) = match provider.as_str() {
        "seedream" => (format!("{}/models", normalize_base(&base)), key),
        "minimax" => (format!("{}/models", v1(&base)), key),
        "hunyuan" => (format!("{}/models", v1(&base)), key),
        _ => return Err("不认识的供应商".into()),
    };
    let response = client
        .get(url)
        .bearer_auth(auth)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(error_text(&text, status.as_u16()));
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|_| "模型列表不是 JSON".to_string())?;
    let list = value
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut models = Vec::new();
    for entry in list {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let domain = entry
            .get("domain")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let task_type = entry
            .get("task_type")
            .map(|x| {
                x.as_array()
                    .map(|list| {
                        list.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("/")
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        let image_model = match provider.as_str() {
            "seedream" => {
                domain == "ImageGeneration"
                    || task_type.to_ascii_lowercase().contains("imagegeneration")
                    || id.to_ascii_lowercase().contains("seedream")
            }
            "minimax" => id.to_ascii_lowercase().contains("image"),
            _ => id.to_ascii_lowercase().contains("image"),
        };
        if !image_model {
            continue;
        }
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(&id)
            .to_string();
        let status = entry
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let desc = [domain, task_type, status.clone()]
            .into_iter()
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        models.push(json!({
            "id": id,
            "name": name,
            "status": status,
            "desc": desc,
            "provider": provider,
        }));
    }
    let note = if models.is_empty() {
        match provider.as_str() {
            "seedream" => "Ark 没有返回生图模型；可以使用内置模型或手动添加 ID。",
            "minimax" => "MiniMax 的 /v1/models 不区分模态，也没有返回生图模型；请使用内置模型或手动添加 ID。Key 已验证可用。",
            _ => "TokenHub 没有返回生图模型；可以使用内置模型或手动添加 ID。",
        }
    } else {
        ""
    };
    Ok(json!({
        "provider": provider,
        "baseUrl": base,
        "models": models,
        "note": note,
    }))
}
