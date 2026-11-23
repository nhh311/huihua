use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

pub const FILES_BETA: &str = "files-api-2025-04-14";

// 绘话的思考强度是有明确分工的，改这里之前先看调用方：
//   - 普通对话：high
//   - 生成图片前整理方案（planner）：必须 high
//   - 创意工坊做技能（workshop）：必须 max
pub const EFFORT_HIGH: &str = "high";
pub const EFFORT_MAX: &str = "max";

fn normalize_base(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub fn anthropic_base(base: &str) -> String {
    let base = normalize_base(base);
    if base.to_ascii_lowercase().ends_with("/anthropic/v1") {
        base
    } else {
        format!("{}/anthropic/v1", base)
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn error_text(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if let Ok(body) = serde_json::from_str::<Value>(&text) {
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
    }
    if text.trim().is_empty() {
        format!("HTTP {}", status.as_u16())
    } else {
        text
    }
}

fn uses_files(body: &Value) -> bool {
    body.get("messages")
        .and_then(Value::as_array)
        .map(|messages| {
            messages.iter().any(|message| {
                message
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|blocks| {
                        blocks.iter().any(|block| {
                            block
                                .get("source")
                                .and_then(|x| x.get("type"))
                                .and_then(Value::as_str)
                                == Some("file")
                        })
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn parse_block(block: &str) -> (String, String) {
    let mut event = "message".to_string();
    let mut data = String::new();
    for line in block.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    (event, data)
}

fn take_block(buffer: &mut Vec<u8>) -> Option<String> {
    let mut pos = None;
    let mut len = 0;
    let mut i = 0;
    while i + 1 < buffer.len() {
        if buffer[i] == b'\n' && buffer[i + 1] == b'\n' {
            pos = Some(i);
            len = 2;
            break;
        }
        if i + 3 < buffer.len()
            && buffer[i] == b'\r'
            && buffer[i + 1] == b'\n'
            && buffer[i + 2] == b'\r'
            && buffer[i + 3] == b'\n'
        {
            pos = Some(i);
            len = 4;
            break;
        }
        i += 1;
    }
    let pos = pos?;
    let block = String::from_utf8_lossy(&buffer[..pos]).to_string();
    buffer.drain(..pos + len);
    Some(block)
}

fn emit(tx: &UnboundedSender<Value>, event: Value) -> bool {
    tx.send(event).is_ok()
}

pub async fn stream_chat(
    key: &str,
    base: &str,
    body: &Value,
    tx: UnboundedSender<Value>,
) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let url = format!("{}/messages", anthropic_base(base));
    let mut payload = body.clone();
    if let Some(object) = payload.as_object_mut() {
        object.insert("stream".into(), Value::Bool(true));
    }
    let mut request = client()
        .post(url)
        .header("x-api-key", key)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "text/event-stream")
        .json(&payload);
    if uses_files(body) {
        request = request.header("anthropic-beta", FILES_BETA);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(error_text(response).await);
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !content_type.contains("text/event-stream") {
        return Err(error_text(response).await);
    }

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut saw_stop = false;
    let mut usage: Option<Value> = None;
    let mut stop_reason: Option<String> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.extend_from_slice(&chunk);
        while let Some(block) = take_block(&mut buffer) {
            if block.trim().is_empty() {
                continue;
            }
            let (event_name, data) = parse_block(&block);
            if data.is_empty() || event_name == "ping" {
                continue;
            }
            let payload: Value = match serde_json::from_str(&data) {
                Ok(value) => value,
                Err(_) => {
                    if event_name == "error" {
                        return Err(data);
                    }
                    continue;
                }
            };
            let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
            if kind == "error" || event_name == "error" {
                let message = payload
                    .get("error")
                    .and_then(|x| x.get("message"))
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("message").and_then(Value::as_str))
                    .unwrap_or("DeepSeek 返回错误");
                return Err(message.to_string());
            }
            match kind {
                "message_start" => {
                    if let Some(value) = payload
                        .get("message")
                        .and_then(|x| x.get("usage"))
                        .filter(|x| !x.is_null())
                    {
                        usage = Some(value.clone());
                    }
                    if !emit(&tx, json!({"type":"start"})) {
                        return Ok(());
                    }
                }
                "content_block_start" => {
                    if payload
                        .get("content_block")
                        .and_then(|x| x.get("type"))
                        .and_then(Value::as_str)
                        == Some("tool_use")
                    {
                        let name = payload
                            .get("content_block")
                            .and_then(|x| x.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        if !emit(&tx, json!({"type":"tool_start","name":name})) {
                            return Ok(());
                        }
                    }
                }
                "content_block_delta" => {
                    let delta = payload.get("delta").cloned().unwrap_or(Value::Null);
                    match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                        "text_delta" => {
                            let text = delta.get("text").and_then(Value::as_str).unwrap_or("");
                            if !emit(&tx, json!({"type":"text","text":text})) {
                                return Ok(());
                            }
                        }
                        "thinking_delta" => {
                            let text = delta
                                .get("thinking")
                                .and_then(Value::as_str)
                                .unwrap_or("");
                            if !emit(&tx, json!({"type":"thinking","text":text})) {
                                return Ok(());
                            }
                        }
                        "signature_delta" => {
                            let signature = delta
                                .get("signature")
                                .and_then(Value::as_str)
                                .unwrap_or("");
                            if !emit(&tx, json!({"type":"signature","signature":signature})) {
                                return Ok(());
                            }
                        }
                        _ => {}
                    }
                }
                "content_block_stop" => {
                    if !emit(&tx, json!({"type":"block_stop"})) {
                        return Ok(());
                    }
                }
                "message_delta" => {
                    if let Some(reason) = payload
                        .get("delta")
                        .and_then(|x| x.get("stop_reason"))
                        .and_then(Value::as_str)
                    {
                        stop_reason = Some(reason.to_string());
                    }
                    if let Some(value) = payload.get("usage").filter(|x| !x.is_null()) {
                        let mut merged = usage.take().unwrap_or_else(|| json!({}));
                        if let (Some(target), Some(source)) =
                            (merged.as_object_mut(), value.as_object())
                        {
                            for (key, value) in source {
                                target.insert(key.clone(), value.clone());
                            }
                        }
                        usage = Some(merged);
                    }
                }
                "message_stop" => {
                    saw_stop = true;
                    break;
                }
                _ => {}
            }
            if saw_stop {
                break;
            }
        }
        if saw_stop {
            break;
        }
    }

    if !saw_stop {
        return Err("连接提前结束，没有收到完整回复".into());
    }
    if let Some(usage) = usage {
        let _ = emit(&tx, json!({"type":"usage","usage":usage}));
    }
    let _ = emit(
        &tx,
        json!({"type":"done","stop_reason": stop_reason}),
    );
    Ok(())
}

pub async fn complete_text(
    key: &str,
    base: &str,
    system: &str,
    messages: Value,
    max_tokens: u32,
    thinking: bool,
    effort: &str,
) -> Result<String, String> {
    let mut body = json!({
        "model": "deepseek-flash",
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "thinking": if thinking { json!({"type":"enabled"}) } else { json!({"type":"disabled"}) },
    });
    if thinking {
        body["output_config"] = json!({ "effort": effort });
    }
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let task = tokio::spawn({
        let key = key.to_string();
        let base = base.to_string();
        async move { stream_chat(&key, &base, &body, tx).await }
    });
    let mut text = String::new();
    while let Some(event) = rx.recv().await {
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => text.push_str(event.get("text").and_then(Value::as_str).unwrap_or("")),
            "error" => {
                let message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("规划失败")
                    .to_string();
                return Err(message);
            }
            _ => {}
        }
    }
    task.await.map_err(|e| e.to_string())??;
    Ok(text.trim().to_string())
}

pub async fn upload_file(
    key: &str,
    base: &str,
    buffer: Vec<u8>,
    name: &str,
    mime: &str,
    purpose: Option<String>,
) -> Result<Value, String> {
    if key.trim().is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let mut form = reqwest::multipart::Form::new();
    if let Some(purpose) = purpose {
        form = form.text("purpose", purpose);
    }
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(name.to_string())
        .mime_str(if mime.is_empty() {
            "application/octet-stream"
        } else {
            mime
        })
        .map_err(|e| e.to_string())?;
    form = form.part("file", part);
    let response = client()
        .post(format!("{}/files", anthropic_base(base)))
        .header("x-api-key", key)
        .header("anthropic-beta", FILES_BETA)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(error_text(response).await);
    }
    response.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn verify_key(key: &str, base: &str) -> Result<bool, String> {
    let response = client()
        .get(format!("{}/models", normalize_base(base)))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(error_text(response).await);
    }
    Ok(true)
}
