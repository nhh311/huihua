use crate::paths;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 多个生成任务可能同时落盘（并行工坊/生图），gallery.json 的读改写需要串行化，
/// 否则后完成的那个任务会把前一个任务的条目覆盖掉。
static GALLERY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GalleryItem {
    pub id: String,
    pub file: String,
    pub thumb: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: String,
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub seed: Option<i64>,
    pub session_id: String,
    pub style_id: Option<String>,
    pub count_index: u32,
    pub url: String,
    pub thumb_url: String,
}

impl Default for GalleryItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            file: String::new(),
            thumb: None,
            width: None,
            height: None,
            created_at: String::new(),
            prompt: String::new(),
            provider: String::new(),
            model: String::new(),
            ratio: String::new(),
            resolution: String::new(),
            seed: None,
            session_id: String::new(),
            style_id: None,
            count_index: 0,
            url: String::new(),
            thumb_url: String::new(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct NewImage {
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub seed: Option<i64>,
    pub session_id: String,
    pub style_id: Option<String>,
    pub count_index: u32,
    pub mime: String,
}

#[derive(Serialize, Deserialize, Default)]
struct GalleryFile {
    #[serde(default)]
    items: Vec<GalleryItem>,
}

/// 回收站里的条目：图片、缩略图和原始索引一起挪进 trash/gallery/<id>/，
/// 还原时按 meta 里的相对路径放回去，不用猜文件名。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashMeta {
    pub deleted_at: String,
    pub item: GalleryItem,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub deleted_at: String,
    pub item: GalleryItem,
    pub image_url: String,
    pub thumb_url: String,
}

fn trash_root() -> PathBuf {
    paths::dirs().root.join("trash").join("gallery")
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if to.exists() {
        let _ = fs::remove_file(to);
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(from, to).map_err(|e| e.to_string())?;
            fs::remove_file(from).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

fn ext_of(rel: &str) -> String {
    Path::new(rel)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("png")
        .to_string()
}

fn image_in(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_string();
        if name.starts_with("image.") {
            return Some(path);
        }
    }
    None
}

fn thumb_in(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_string();
        if name.starts_with("thumb.") {
            return Some(path);
        }
    }
    None
}

fn old_enough_to_purge(deleted_at: &str) -> bool {
    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(deleted_at) else {
        return false;
    };
    chrono::Local::now().signed_duration_since(parsed).num_days() >= 30
}

fn gallery_path() -> PathBuf {
    paths::dirs().gallery
}

fn load() -> GalleryFile {
    paths::read_json::<GalleryFile>(&gallery_path()).unwrap_or_default()
}

fn save(data: &GalleryFile) -> Result<(), String> {
    paths::write_json(&gallery_path(), data)
}

fn public(mut item: GalleryItem) -> GalleryItem {
    let root = paths::dirs().root;
    item.url = paths::data_url(&root.join(&item.file));
    item.thumb_url = match &item.thumb {
        Some(thumb) => paths::data_url(&root.join(thumb)),
        None => item.url.clone(),
    };
    item
}

fn ext_for(mime: &str) -> &'static str {
    if mime.contains("jpeg") || mime.contains("jpg") {
        ".jpg"
    } else if mime.contains("webp") {
        ".webp"
    } else if mime.contains("gif") {
        ".gif"
    } else {
        ".png"
    }
}

fn make_thumb(buffer: &[u8], id: &str) -> Option<(String, u32, u32)> {
    let image = image::load_from_memory(buffer).ok()?;
    let (width, height) = (image.width(), image.height());
    let target_width = width.min(520).max(1);
    let target_height = ((height as f64) * (target_width as f64) / (width as f64)).max(1.0) as u32;
    let thumb = image.resize(target_width, target_height, FilterType::Triangle);
    let out = paths::dirs().thumbs.join(format!("{}.jpg", id));
    let mut file = fs::File::create(&out).ok()?;
    let mut encoder = JpegEncoder::new_with_quality(&mut file, 82);
    encoder.encode_image(&thumb).ok()?;
    Some((
        format!("thumbs/{}.jpg", id),
        width,
        height,
    ))
}

pub fn list() -> Vec<GalleryItem> {
    let _guard = GALLERY_LOCK.lock().ok();
    let mut data = load();
    let root = paths::dirs().root;
    let before = data.items.len();
    data.items.retain(|item| root.join(&item.file).exists());
    if data.items.len() != before {
        let _ = save(&data);
    }
    let mut items: Vec<GalleryItem> = data.items.into_iter().map(public).collect();
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    items
}

pub fn get(id: &str) -> Option<GalleryItem> {
    let safe = paths::safe_id(id);
    load().items.into_iter().find(|item| item.id == safe)
}

pub fn file_for(id: &str, thumb: bool) -> Option<PathBuf> {
    let item = get(id)?;
    let rel = if thumb {
        item.thumb.as_deref().unwrap_or(&item.file)
    } else {
        &item.file
    };
    let root = paths::dirs().root;
    let full = root.join(rel);
    if !full.starts_with(&root) || !full.exists() {
        return None;
    }
    Some(full)
}

/// Read a stored image and return it as a `data:` URL. This is the fallback the
/// renderer uses when `<img src="http://asset.localhost/...">` fails to load.
pub fn inline(id: &str, thumb: bool) -> Result<String, String> {
    let full = file_for(id, thumb).ok_or_else(|| "作品不存在".to_string())?;
    let bytes = fs::read(&full).map_err(|e| e.to_string())?;
    Ok(paths::inline_data_url(&full, &bytes))
}

pub fn add_buffer(buffer: &[u8], meta: NewImage) -> Result<GalleryItem, String> {
    let _guard = GALLERY_LOCK.lock().map_err(|e| e.to_string())?;
    paths::ensure_dirs().map_err(|e| e.to_string())?;
    let mut data = load();
    let id = format!(
        "{}-{}",
        chrono::Local::now().timestamp_millis(),
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let ext = ext_for(&meta.mime);
    let dir = paths::dirs().images.join(paths::month_folder());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{}{}", id, ext));
    fs::write(&file, buffer).map_err(|e| e.to_string())?;
    let thumb = make_thumb(buffer, &id);
    let item = GalleryItem {
        id: id.clone(),
        file: file
            .strip_prefix(&paths::dirs().root)
            .map(|x| x.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| file.to_string_lossy().to_string()),
        thumb: thumb.as_ref().map(|x| x.0.clone()),
        width: thumb.as_ref().map(|x| x.1),
        height: thumb.as_ref().map(|x| x.2),
        created_at: paths::now_iso(),
        prompt: meta.prompt,
        provider: meta.provider,
        model: meta.model,
        ratio: meta.ratio,
        resolution: meta.resolution,
        seed: meta.seed,
        session_id: meta.session_id,
        style_id: meta.style_id,
        count_index: meta.count_index,
        url: String::new(),
        thumb_url: String::new(),
    };
    data.items.push(item.clone());
    save(&data)?;
    Ok(public(item))
}

/// 删除作品 = 移进应用内回收站（不是直接抹掉），可从「最近删除」还原。
pub fn remove(id: &str) -> Result<bool, String> {
    let _guard = GALLERY_LOCK.lock().map_err(|e| e.to_string())?;
    let safe = paths::safe_id(id);
    let mut data = load();
    let Some(index) = data.items.iter().position(|item| item.id == safe) else {
        return Ok(false);
    };
    let item = data.items.remove(index);
    save(&data)?;

    let dir = trash_root().join(&safe);
    if let Err(error) = move_into_trash(&item, &dir) {
        data.items.insert(index, item);
        let _ = save(&data);
        return Err(error);
    }
    Ok(true)
}

fn move_into_trash(item: &GalleryItem, dir: &Path) -> Result<(), String> {
    let root = paths::dirs().root;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let source = root.join(&item.file);
    if !source.exists() {
        return Err("图片文件已经不在了，无法移进回收站".into());
    }
    move_file(&source, &dir.join(format!("image.{}", ext_of(&item.file))))?;
    if let Some(thumb) = &item.thumb {
        let thumb_source = root.join(thumb);
        if thumb_source.exists() {
            move_file(&thumb_source, &dir.join(format!("thumb.{}", ext_of(thumb))))?;
        }
    }
    let meta = TrashMeta {
        deleted_at: paths::now_iso(),
        item: item.clone(),
    };
    paths::write_json(&dir.join("meta.json"), &meta)
}

pub fn trash_list() -> Vec<TrashEntry> {
    let _guard = GALLERY_LOCK.lock().ok();
    let root = trash_root();
    let mut out: Vec<TrashEntry> = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(meta) = paths::read_json::<TrashMeta>(&dir.join("meta.json")) else {
            continue;
        };
        if old_enough_to_purge(&meta.deleted_at) {
            let _ = fs::remove_dir_all(&dir);
            continue;
        }
        let Some(image) = image_in(&dir) else {
            let _ = fs::remove_dir_all(&dir);
            continue;
        };
        let thumb = thumb_in(&dir).unwrap_or_else(|| image.clone());
        out.push(TrashEntry {
            id: meta.item.id.clone(),
            deleted_at: meta.deleted_at.clone(),
            image_url: paths::data_url(&image),
            thumb_url: paths::data_url(&thumb),
            item: meta.item,
        });
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    out
}

pub fn restore(id: &str) -> Result<GalleryItem, String> {
    let _guard = GALLERY_LOCK.lock().map_err(|e| e.to_string())?;
    let safe = paths::safe_id(id);
    let dir = trash_root().join(&safe);
    let meta = paths::read_json::<TrashMeta>(&dir.join("meta.json"))
        .ok_or_else(|| "最近删除里没有这张图".to_string())?;
    let root = paths::dirs().root;
    let some_image = image_in(&dir).ok_or_else(|| "回收站里的原图不见了".to_string())?;

    let mut item = meta.item;
    item.url.clear();
    item.thumb_url.clear();
    move_file(&some_image, &root.join(&item.file))?;
    if let Some(thumb) = &item.thumb {
        if let Some(source) = thumb_in(&dir) {
            move_file(&source, &root.join(thumb))?;
        }
    }

    let mut data = load();
    if !data.items.iter().any(|x| x.id == item.id) {
        data.items.push(item.clone());
    }
    save(&data)?;
    let _ = fs::remove_dir_all(&dir);
    Ok(public(item))
}

pub fn purge(id: &str) -> Result<bool, String> {
    let _guard = GALLERY_LOCK.lock().map_err(|e| e.to_string())?;
    let dir = trash_root().join(paths::safe_id(id));
    if !dir.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn empty_trash() -> Result<u32, String> {
    let _guard = GALLERY_LOCK.lock().map_err(|e| e.to_string())?;
    let root = trash_root();
    if !root.exists() {
        return Ok(0);
    }
    let mut removed = 0;
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let dir = entry.path();
        if dir.is_dir() && fs::remove_dir_all(&dir).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn export_to(id: &str, destination: &str) -> Result<String, String> {
    let item = get(id).ok_or_else(|| "作品不存在".to_string())?;
    let source = paths::dirs().root.join(&item.file);
    if !source.exists() {
        return Err("图片文件已被移动或删除".into());
    }
    let dest = Path::new(destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&source, dest).map_err(|e| e.to_string())?;
    Ok(destination.to_string())
}
