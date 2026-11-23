use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const APP_FOLDER: &str = "绘话";

#[derive(Clone, Debug)]
pub struct Dirs {
    pub root: PathBuf,
    pub images: PathBuf,
    pub thumbs: PathBuf,
    pub styles: PathBuf,
    pub logs: PathBuf,
    pub temp: PathBuf,
    pub config: PathBuf,
    pub gallery: PathBuf,
}

pub fn dirs() -> Dirs {
    let root = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| dirs::data_dir())
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_FOLDER);
    Dirs {
        images: root.join("images"),
        thumbs: root.join("thumbs"),
        styles: root.join("styles"),
        logs: root.join("logs"),
        temp: root.join("temp"),
        config: root.join("config.json"),
        gallery: root.join("gallery.json"),
        root,
    }
}

pub fn ensure_dirs() -> std::io::Result<()> {
    let d = dirs();
    for path in [&d.root, &d.images, &d.thumbs, &d.styles, &d.logs, &d.temp] {
        fs::create_dir_all(path)?;
    }
    Ok(())
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!(
        "tmp-{}",
        std::process::id()
    ));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn safe_id(id: &str) -> String {
    let mut out = String::new();
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    if out.is_empty() {
        "item".to_string()
    } else {
        out
    }
}

pub fn data_url(path: &Path) -> String {
    format!(
        "http://asset.localhost/{}",
        urlencoding::encode(&path.to_string_lossy())
    )
}

pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        _ => "image/png",
    }
}

/// Inline a local image as a `data:` URL. Used as a fallback when the WebView
/// refuses to load `http://asset.localhost/...` (for example when the asset
/// protocol scope does not cover the data folder).
pub fn inline_data_url(path: &Path, bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{};base64,{}",
        mime_for(path),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub fn month_folder() -> String {
    chrono::Local::now().format("%Y-%m").to_string()
}

pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}
