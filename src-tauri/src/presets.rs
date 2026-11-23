//! 素材库：内置或用户导入的成品提示词库。
//!
//! 查找顺序是：环境变量 → 用户素材库（`%APPDATA%\绘话\presets`）→
//! 安装包内置资源（`resources/presets`）。开源版不打包内置资源，
//! 用户可以用「导入素材库」把自己的目录装进来（格式见 docs/LIBRARY_FORMAT.md）。
//!
//! 这里负责：解析目录、按示例图推断比例、把预设装成「风格」、以及
//! 调用 DeepSeek 把提示词适配到当前生图引擎。收藏与最近使用落在
//! `%APPDATA%\绘话\presets-state.json`，不修改只读的出厂数据。

use crate::catalog;
use crate::config;
use crate::deepseek;
use crate::paths;
use crate::styles::{self, Recommended, SampleInput, StyleInput};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;
#[cfg(not(feature = "open"))]
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const STATE_FILE: &str = "presets-state.json";
const FOLDER: &str = "presets";
static IMPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Default, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct Meta {
    source: String,
    scraped_at: String,
    count: usize,
    license: String,
}

#[derive(Clone, Debug, Deserialize, Default, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub name_en: String,
    pub icon: String,
    pub count: u32,
}

#[derive(Clone, Debug, Deserialize, Default, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct RawPreset {
    id: String,
    file_id: String,
    cat: String,
    title: String,
    title_en: String,
    prompt: String,
    prompt_en: String,
    params: BTreeMap<String, String>,
    vars: String,
    vars_en: String,
    model: String,
    desc: String,
    desc_en: String,
    index: u32,
    image: Option<String>,
}

#[derive(Debug, Deserialize, Default, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct RawFile {
    meta: Meta,
    categories: Vec<Category>,
    presets: Vec<RawPreset>,
}

struct Preset {
    raw: RawPreset,
    ratio: String,
    width: u32,
    height: u32,
    thumb_url: String,
    preview_url: String,
    preview_path: Option<PathBuf>,
    needs_reference: bool,
}

struct Library {
    root: PathBuf,
    origin: String,
    meta: Meta,
    categories: Vec<Category>,
    presets: Vec<Preset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryView {
    id: String,
    name: String,
    name_en: String,
    count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetView {
    id: String,
    file_id: String,
    cat: String,
    title: String,
    title_en: String,
    prompt: String,
    prompt_en: String,
    params: BTreeMap<String, String>,
    vars: String,
    vars_en: String,
    model: String,
    desc: String,
    desc_en: String,
    ratio: String,
    width: u32,
    height: u32,
    thumb: String,
    preview: String,
    needs_reference: bool,
    favorite: bool,
    used_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogView {
    available: bool,
    error: Option<String>,
    root: String,
    origin: String,
    user_root: String,
    source: String,
    scraped_at: String,
    license: String,
    count: usize,
    categories: Vec<CategoryView>,
    presets: Vec<PresetView>,
    favorites: Vec<String>,
    recent: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recent {
    pub id: String,
    pub at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StateFile {
    version: u32,
    favorites: Vec<String>,
    recent: Vec<Recent>,
}

fn state_path() -> PathBuf {
    paths::dirs().root.join(STATE_FILE)
}

fn load_state() -> StateFile {
    paths::read_json(&state_path()).unwrap_or_default()
}

fn save_state(state: &StateFile) -> Result<(), String> {
    let _ = paths::ensure_dirs();
    paths::write_json(&state_path(), state)
}

/// 用户导入的素材库目录；开源版没有内置资源时，这就是唯一的来源。
pub fn user_root() -> PathBuf {
    paths::dirs().root.join(FOLDER)
}

fn origin_of(root: &Path) -> String {
    if root == user_root() {
        return "user".into();
    }
    if let Ok(value) = std::env::var("HUIHUA_PRESETS_DIR") {
        if PathBuf::from(value) == root {
            return "env".into();
        }
    }
    "builtin".into()
}

/// 素材库的候选位置：环境变量 → 用户导入 → 内置资源 → exe 同级 → 开发目录。
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    if let Ok(value) = std::env::var("HUIHUA_PRESETS_DIR") {
        let path = PathBuf::from(value);
        if path.join("presets.json").exists() {
            return Ok(path);
        }
    }
    // 用户导入的素材库优先。完整版里导入自己的库会覆盖内置库，
    // 想回到内置库时在界面上点「移除素材库」即可。
    let user = user_root();
    if user.join("presets.json").exists() {
        return Ok(user);
    }
    // 开源版不认安装目录里的内置资源：即使机器上残留了完整版的
    // resources\presets，也只从用户库或环境变量读取，避免版权素材被误带出来。
    #[cfg(not(feature = "open"))]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(dir) = app.path().resource_dir() {
            candidates.push(dir.join("resources").join(FOLDER));
            candidates.push(dir.join(FOLDER));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("resources").join(FOLDER));
                candidates.push(dir.join(FOLDER));
            }
        }
        for path in candidates {
            if path.join("presets.json").exists() {
                return Ok(path);
            }
        }
    }
    // 开发期回退到源码目录里的 resources/presets。必须只在 debug 构建里编译：
    // env!("CARGO_MANIFEST_DIR") 会把开发机的绝对路径直接写进二进制。
    #[cfg(all(debug_assertions, not(feature = "open")))]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(FOLDER);
        if dev.join("presets.json").exists() {
            return Ok(dev);
        }
    }
    Err("还没有素材库。点「导入素材库」选择按格式整理好的文件夹，或把素材库放到数据目录的 presets 下。".into())
}

fn safe_relative(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() || value.contains("..") || value.starts_with('/') || value.starts_with('\\') {
        return None;
    }
    Some(PathBuf::from(value.replace('\\', "/")))
}

fn nearest_ratio(width: u32, height: u32) -> String {
    if width == 0 || height == 0 {
        return "1:1".into();
    }
    let actual = width as f64 / height as f64;
    let mut best = "1:1".to_string();
    let mut best_gap = f64::MAX;
    for ratio in catalog::RATIOS {
        let Some((left, right)) = ratio.split_once(':') else {
            continue;
        };
        let target = left.parse::<f64>().unwrap_or(1.0) / right.parse::<f64>().unwrap_or(1.0);
        let gap = (actual / target).ln().abs();
        if gap < best_gap {
            best_gap = gap;
            best = ratio.to_string();
        }
    }
    best
}

fn needs_reference(prompt: &str, prompt_en: &str) -> bool {
    const ZH: [&str; 12] = [
        "附件",
        "上传的图",
        "上传图片",
        "参考图",
        "这张图",
        "该图",
        "原图",
        "图中",
        "图片中",
        "照片中",
        "把这张",
        "输入图",
    ];
    const EN: [&str; 8] = [
        "attached image",
        "uploaded image",
        "reference image",
        "this image",
        "input image",
        "the image provided",
        "given image",
        "attached photo",
    ];
    if ZH.iter().any(|key| prompt.contains(key)) {
        return true;
    }
    let lower = prompt_en.to_lowercase();
    EN.iter().any(|key| lower.contains(key))
}

fn load(app: &AppHandle) -> Result<Library, String> {
    let root = root(app)?;
    let buffer = std::fs::read(root.join("presets.json"))
        .map_err(|error| format!("预设数据读取失败：{error}"))?;
    build(&root, &buffer)
}

fn build(root: &Path, buffer: &[u8]) -> Result<Library, String> {
    let root = root.to_path_buf();
    let file: RawFile =
        serde_json::from_slice(buffer).map_err(|error| format!("预设数据解析失败：{error}"))?;
    let presets = file
        .presets
        .into_iter()
        .map(|raw| {
            let mut width = 0;
            let mut height = 0;
            let mut thumb_url = String::new();
            let mut preview_url = String::new();
            let mut preview_path = None;
            if let Some(relative) = raw.image.as_deref().and_then(safe_relative) {
                let thumb = root.join("thumb").join(&relative);
                let preview = root.join("preview").join(&relative);
                if preview.exists() {
                    if let Ok((w, h)) = image::image_dimensions(&preview) {
                        width = w;
                        height = h;
                    }
                    preview_url = paths::data_url(&preview);
                    preview_path = Some(preview);
                }
                if thumb.exists() {
                    thumb_url = paths::data_url(&thumb);
                } else if !preview_url.is_empty() {
                    thumb_url = preview_url.clone();
                }
            }
            let ratio = nearest_ratio(width, height);
            let needs = needs_reference(&raw.prompt, &raw.prompt_en);
            Preset {
                raw,
                ratio,
                width,
                height,
                thumb_url,
                preview_url,
                preview_path,
                needs_reference: needs,
            }
        })
        .collect();
    let origin = origin_of(&root);
    Ok(Library {
        root,
        origin,
        meta: file.meta,
        categories: file.categories,
        presets,
    })
}

fn view(library: &Library, state: &StateFile) -> CatalogView {
    let recents: BTreeMap<&str, &str> = state
        .recent
        .iter()
        .map(|item| (item.id.as_str(), item.at.as_str()))
        .collect();
    CatalogView {
        available: true,
        error: None,
        root: library.root.to_string_lossy().to_string(),
        origin: library.origin.clone(),
        user_root: user_root().to_string_lossy().to_string(),
        source: library.meta.source.clone(),
        scraped_at: library.meta.scraped_at.clone(),
        license: library.meta.license.clone(),
        count: library.presets.len(),
        categories: library
            .categories
            .iter()
            .map(|category| CategoryView {
                id: category.id.clone(),
                name: category.name.clone(),
                name_en: category.name_en.clone(),
                count: category.count,
            })
            .collect(),
        presets: library
            .presets
            .iter()
            .map(|preset| PresetView {
                id: preset.raw.id.clone(),
                file_id: preset.raw.file_id.clone(),
                cat: preset.raw.cat.clone(),
                title: preset.raw.title.clone(),
                title_en: preset.raw.title_en.clone(),
                prompt: preset.raw.prompt.clone(),
                prompt_en: preset.raw.prompt_en.clone(),
                params: preset.raw.params.clone(),
                vars: preset.raw.vars.clone(),
                vars_en: preset.raw.vars_en.clone(),
                model: preset.raw.model.clone(),
                desc: preset.raw.desc.clone(),
                desc_en: preset.raw.desc_en.clone(),
                ratio: preset.ratio.clone(),
                width: preset.width,
                height: preset.height,
                thumb: preset.thumb_url.clone(),
                preview: preset.preview_url.clone(),
                needs_reference: preset.needs_reference,
                favorite: state.favorites.iter().any(|id| id == &preset.raw.id),
                used_at: recents.get(preset.raw.id.as_str()).map(|at| at.to_string()),
            })
            .collect(),
        favorites: state.favorites.clone(),
        recent: state.recent.iter().map(|item| item.id.clone()).collect(),
    }
}

fn empty(message: &str) -> CatalogView {
    CatalogView {
        available: false,
        error: Some(message.to_string()),
        root: String::new(),
        origin: String::new(),
        user_root: user_root().to_string_lossy().to_string(),
        source: String::new(),
        scraped_at: String::new(),
        license: String::new(),
        count: 0,
        categories: Vec::new(),
        presets: Vec::new(),
        favorites: Vec::new(),
        recent: Vec::new(),
    }
}

#[tauri::command]
pub fn presets_catalog(app: AppHandle) -> CatalogView {
    let state = load_state();
    match load(&app) {
        Ok(library) => view(&library, &state),
        Err(error) => {
            eprintln!("[绘话] 预设库不可用: {error}");
            empty(&error)
        }
    }
}

#[tauri::command]
pub fn presets_favorite(id: String, on: bool) -> Result<Value, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("预设 ID 为空".into());
    }
    let mut state = load_state();
    state.favorites.retain(|item| item != &id);
    if on {
        state.favorites.insert(0, id.clone());
    }
    state.favorites.truncate(200);
    save_state(&state)?;
    Ok(json!({ "id": id, "favorite": on, "favorites": state.favorites }))
}

#[tauri::command]
pub fn presets_use(id: String) -> Result<Value, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("预设 ID 为空".into());
    }
    let mut state = load_state();
    state.recent.retain(|item| item.id != id);
    state.recent.insert(
        0,
        Recent {
            id,
            at: paths::now_iso(),
        },
    );
    state.recent.truncate(48);
    save_state(&state)?;
    Ok(json!({ "ok": true }))
}

fn category_name(library: &Library, id: &str) -> String {
    library
        .categories
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.name.clone())
        .unwrap_or_else(|| id.to_string())
}

fn data_url_of(path: &Path) -> Result<String, String> {
    let buffer = std::fs::read(path).map_err(|error| format!("示例图读取失败：{error}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(buffer);
    let mime = paths::mime_for(path);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
pub fn presets_install(
    app: AppHandle,
    id: String,
    provider: String,
    model: String,
    ratio: String,
    resolution: String,
    prompt: Option<String>,
    count: Option<u32>,
) -> Result<styles::Style, String> {
    let library = load(&app)?;
    let preset = library
        .presets
        .iter()
        .find(|item| item.raw.id == id)
        .ok_or_else(|| "预设不存在".to_string())?;
    let category = category_name(&library, &preset.raw.cat);
    let final_prompt = prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| preset.raw.prompt.clone());
    if final_prompt.trim().is_empty() {
        return Err("这条预设没有提示词".into());
    }
    let vars = if preset.raw.vars.trim().is_empty() {
        "无".to_string()
    } else {
        preset.raw.vars.clone()
    };
    let spec = format!(
        "# {title}\n\n- 来源：预设库 · {source} · `{id}`\n- 分类：{category}\n- 原推荐模型：{original_model}\n- 变量：{vars}\n- 适配参数：{provider} / {target_model} / {ratio} / {resolution} / {count} 张\n- 示例图：{width}×{height}（推断比例 {preset_ratio}）\n\n## 原始提示词\n\n{prompt}\n\n## English\n\n{prompt_en}\n\n## 使用建议\n\n1. 这条预设来自社区实战提示词，主体描述已经很完整；需要改主体时只替换括号里的变量，不要整段重写。\n2. 如果要做同系列作品，固定「风格、光线、构图」三段，只换主体与场景。\n3. 需要参考图的预设（图中出现「附件 / 这张图」等字样）必须先上传图片，否则模型会自行编造主体。\n4. 想要更稳定的成片，建议沿用当前选择的比例 {ratio}（示例图为 {preset_ratio}）。\n",
        title = preset.raw.title,
        source = library.meta.source,
        id = preset.raw.id,
        category = category,
        original_model = preset.raw.model,
        vars = vars,
        provider = provider,
        target_model = model,
        ratio = ratio,
        resolution = resolution,
        count = count.unwrap_or(1),
        width = preset.width,
        height = preset.height,
        preset_ratio = preset.ratio,
        prompt = preset.raw.prompt,
        prompt_en = preset.raw.prompt_en,
    );
    let samples = match preset.preview_path.as_deref() {
        Some(path) if path.exists() => vec![SampleInput {
            data_url: data_url_of(path)?,
        }],
        _ => Vec::new(),
    };
    // 原站的描述常常是一整段示例文案，直接塞进风格卡片会把列表撑爆，只留一句。
    let short_desc: String = preset.raw.desc.trim().chars().take(60).collect();
    styles::save(StyleInput {
        name: preset.raw.title.clone(),
        description: if short_desc.is_empty() {
            format!("预设库 · {category}")
        } else {
            format!("预设库 · {category} · {short_desc}")
        },
        kind: Some("preset".into()),
        prompt: final_prompt,
        spec: Some(spec),
        recommended: Some(Recommended {
            provider,
            ratio,
            resolution,
            count: count.unwrap_or(1).clamp(1, 4),
        }),
        samples,
        source_id: Some(format!("preset:{id}")),
    })
}

const ADAPT_SYSTEM: &str = r#"你是「绘话」的生图提示词适配器。用户从预设库选了一条原本写给别的模型的提示词，现在要交给新的生图引擎。请把它改写成更适合新引擎的中文提示词。

规则：
1. 保留主体、数量、风格、构图、光线、材质、文字内容与所有关键细节；只改表达方式，不要删减信息，也不要新增原提示词里没有的具体对象。
2. 引擎偏好见下方说明，按它的长处调整句式与信息顺序。
3. 去掉只属于原模型的写法：参数串（如 --ar 16:9、--style）、权重语法（如 (word:1.2)、::）、negative prompt、nano banana 之类字样，改成自然语言。
4. 提示词里如果还有中文变量占位符（如 {风格}），原样保留，不要替换或删除。
5. 原文如果需要参考图（如「附件中的图片」），保留这个说法。
6. 只输出 JSON：{"prompt":"改写后的提示词","note":"一句话说明改了什么，不超过 40 字"}。不要输出任何解释或代码块外的文字。"#;

fn engine_hint(provider: &str) -> &'static str {
    match provider {
        "minimax" => "MiniMax：细节与指令跟随强，支持高分辨率。把提示词拆成「主体 / 环境 / 光线 / 材质 / 镜头 / 文字」短句，文字内容要写清原文与位置。",
        "hunyuan" => "混元：中文语义与东方审美强。用连贯的自然语言叙事描述，少堆砌英文技术词，色彩与氛围写具体。",
        _ => "Seedream：中文语义与版面能力强，擅长海报、信息图和中文字。用自然语言分句描述，明确主体数量、位置、画面比例与文字内容，避免英文权重语法。",
    }
}

fn extract_json(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Value>(&text[start..=end]).ok()
}

#[tauri::command]
pub async fn presets_adapt(
    provider: String,
    model: String,
    prompt: String,
    title: Option<String>,
    original_model: Option<String>,
) -> Result<Value, String> {
    let config = config::load();
    let key = config::key_of(&config, "deepseek");
    if key.trim().is_empty() {
        return Err("先配置 DeepSeek API Key 再适配提示词".into());
    }
    let base = config::base_of(&config, "deepseek");
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("提示词是空的".into());
    }
    let provider_name = if provider.trim().is_empty() {
        "seedream".to_string()
    } else {
        provider.trim().to_string()
    };
    let user = format!(
        "原模型：{}\n新引擎：{}（{}）\n预设标题：{}\n\n原提示词：\n{}\n\n引擎说明：{}",
        original_model
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "未知".into()),
        provider_name,
        model,
        title.unwrap_or_else(|| "未命名".into()),
        prompt,
        engine_hint(&provider_name),
    );
    let messages = json!([{ "role": "user", "content": [{ "type": "text", "text": user }] }]);
    let text = deepseek::complete_text(
        &key,
        &base,
        ADAPT_SYSTEM,
        messages,
        1800,
        true,
        deepseek::EFFORT_HIGH,
    )
    .await?;
    if let Some(value) = extract_json(&text) {
        let prompt = value
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if !prompt.is_empty() {
            return Ok(json!({
                "prompt": prompt,
                "note": value
                    .get("note")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            }));
        }
    }
    let fallback = text.trim().to_string();
    if fallback.is_empty() {
        return Err("模型没有返回内容".into());
    }
    Ok(json!({
        "prompt": fallback,
        "note": "模型没有按 JSON 返回，已直接采用原文".to_string(),
    }))
}

const MAX_PRESETS: usize = 5000;
const MAX_FILES: usize = 6000;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MEDIA_BYTES: u64 = 40 * 1024 * 1024;

/// 选中目录本身有 presets.json 就用它，否则接受「只有一层子目录」的解压结果。
fn resolve_library_root(source: &Path) -> Result<PathBuf, String> {
    if source.join("presets.json").is_file() {
        return Ok(source.to_path_buf());
    }
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(source) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("presets.json").is_file() {
                found.push(path);
            }
        }
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err("这个文件夹里没有 presets.json。请选择素材库的根目录，或解压后只有一层子文件夹的目录。".into()),
        _ => Err("这个文件夹里有多个素材库，请直接选择包含 presets.json 的那一层。".into()),
    }
}

fn is_media(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.rsplit('.').next().unwrap_or(""),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp"
    ) || matches!(lower.rsplit('.').next().unwrap_or(""), "md" | "txt")
}

#[derive(Default)]
struct CopyStats {
    files: usize,
    bytes: u64,
}

fn copy_library_files(source: &Path, target: &Path, stats: &mut CopyStats) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|error| format!("创建目录失败：{error}"))?;
    let entries = std::fs::read_dir(source).map_err(|error| format!("读取目录失败：{error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "presets.json" || name.starts_with('.') || name == "Thumbs.db" || name == "desktop.ini"
        {
            continue;
        }
        let dest = target.join(&name);
        if path.is_dir() {
            copy_library_files(&path, &dest, stats)?;
            continue;
        }
        if !path.is_file() || !is_media(&name) {
            continue;
        }
        let len = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if len > MAX_MEDIA_BYTES {
            return Err(format!("{name} 太大了（超过 40MB），请先压缩图片"));
        }
        stats.files += 1;
        stats.bytes += len;
        if stats.files > MAX_FILES {
            return Err(format!("文件太多（超过 {MAX_FILES} 个），请精简素材库"));
        }
        if stats.bytes > MAX_TOTAL_BYTES {
            return Err("素材库总大小超过 512MB，请先压缩图片".into());
        }
        std::fs::copy(&path, &dest).map_err(|error| format!("复制 {name} 失败：{error}"))?;
    }
    Ok(())
}

/// 校验 + 归一化：补 id/title/cat、去掉找不到图的 image、重算分类计数。
fn normalize_library(source: &Path) -> Result<(RawFile, usize, usize), String> {
    let buffer = std::fs::read(source.join("presets.json"))
        .map_err(|error| format!("读不到 presets.json：{error}"))?;
    if buffer.len() > 16 * 1024 * 1024 {
        return Err("presets.json 超过 16MB，请拆分素材库".into());
    }
    let mut file: RawFile =
        serde_json::from_slice(&buffer).map_err(|error| format!("presets.json 解析失败：{error}"))?;
    if file.presets.is_empty() {
        return Err("素材库里至少有 1 条预设".into());
    }
    if file.presets.len() > MAX_PRESETS {
        return Err(format!("预设太多（超过 {MAX_PRESETS} 条），请拆分素材库"));
    }

    let mut ids = std::collections::HashSet::new();
    let mut images = 0usize;
    let mut missing = 0usize;
    for preset in &mut file.presets {
        let id = preset.id.trim().to_string();
        if id.is_empty() {
            return Err("有预设缺少 id".into());
        }
        if !ids.insert(id.clone()) {
            return Err(format!("预设 id 重复：{id}"));
        }
        preset.id = id;
        if preset.file_id.trim().is_empty() {
            preset.file_id = preset.id.clone();
        }
        if preset.title.trim().is_empty() {
            preset.title = "未命名".into();
        }
        if preset.cat.trim().is_empty() {
            preset.cat = "uncategorized".into();
        }
        if preset.prompt.trim().is_empty() {
            return Err(format!("预设 {} 没有提示词", preset.id));
        }
        if let Some(relative) = preset.image.clone() {
            let valid = safe_relative(&relative)
                .map(|path| source.join("preview").join(path).is_file())
                .unwrap_or(false);
            if valid {
                images += 1;
            } else {
                preset.image = None;
                missing += 1;
            }
        }
    }

    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for preset in &file.presets {
        *counts.entry(preset.cat.clone()).or_insert(0) += 1;
    }
    let mut seen = std::collections::HashSet::new();
    let mut categories = Vec::new();
    for mut category in std::mem::take(&mut file.categories) {
        category.id = category.id.trim().to_string();
        if category.id.is_empty() || !seen.insert(category.id.clone()) {
            continue;
        }
        if category.name.trim().is_empty() {
            category.name = category.id.clone();
        }
        category.count = counts.get(&category.id).copied().unwrap_or(0);
        categories.push(category);
    }
    for (id, count) in counts {
        if seen.insert(id.clone()) {
            categories.push(Category {
                name: id.clone(),
                name_en: id.clone(),
                icon: String::new(),
                count,
                id,
            });
        }
    }
    file.categories = categories;
    file.meta.count = file.presets.len();
    if file.meta.source.trim().is_empty() {
        file.meta.source = "本地素材库".into();
    }
    if file.meta.scraped_at.trim().is_empty() {
        file.meta.scraped_at = paths::now_iso();
    }
    if file.meta.license.trim().is_empty() {
        file.meta.license = "用户导入，请自行确认素材授权".into();
    }
    Ok((file, images, missing))
}

fn install_library(source: &Path, target: &Path) -> Result<(usize, usize, usize), String> {
    let source = resolve_library_root(source)?;
    let (library, images, missing) = normalize_library(&source)?;
    let parent = target
        .parent()
        .ok_or_else(|| "数据目录不可用".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| format!("创建数据目录失败：{error}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let staging = parent.join(format!("presets.importing-{stamp}"));
    let backup = parent.join(format!("presets.old-{stamp}"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|error| format!("创建临时目录失败：{error}"))?;

    let prepared = (|| -> Result<(), String> {
        let mut stats = CopyStats::default();
        copy_library_files(&source, &staging, &mut stats)?;
        let text = serde_json::to_vec_pretty(&library)
            .map_err(|error| format!("写 presets.json 失败：{error}"))?;
        std::fs::write(staging.join("presets.json"), text)
            .map_err(|error| format!("写入素材库失败：{error}"))?;
        Ok(())
    })();
    if let Err(error) = prepared {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }

    let had_old = target.exists();
    if had_old {
        if let Err(error) = std::fs::rename(target, &backup) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("替换旧素材库失败：{error}"));
        }
    }
    if let Err(error) = std::fs::rename(&staging, target) {
        if had_old {
            let _ = std::fs::rename(&backup, target);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("启用素材库失败：{error}"));
    }
    if had_old {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok((library.presets.len(), images, missing))
}

/// 选择文件夹导入素材库；取消时返回 null。
#[tauri::command]
pub fn presets_import(app: AppHandle) -> Result<Option<Value>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择素材库文件夹（里面要有 presets.json）")
        .blocking_pick_folder();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let source = picked
        .into_path()
        .map_err(|error| format!("读取选择的路径失败：{error}"))?;
    let _guard = IMPORT_LOCK
        .lock()
        .map_err(|_| "素材库正在被另一个操作占用".to_string())?;
    let (count, images, missing) = install_library(&source, &user_root())?;
    let catalog = presets_catalog(app);
    Ok(Some(json!({
        "count": count,
        "images": images,
        "missing": missing,
        "catalog": catalog,
    })))
}

/// 移除用户导入的素材库，回退到内置库（开源版则回到空状态）。
#[tauri::command]
pub fn presets_remove_user(app: AppHandle) -> Result<CatalogView, String> {
    let _guard = IMPORT_LOCK
        .lock()
        .map_err(|_| "素材库正在被另一个操作占用".to_string())?;
    let dir = user_root();
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|error| format!("移除素材库失败：{error}"))?;
    }
    Ok(presets_catalog(app))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn bundled() -> Library {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(FOLDER);
        let buffer = std::fs::read(root.join("presets.json")).expect("读不到 presets.json");
        build(&root, &buffer).expect("解析预设库失败")
    }

    #[test]
    fn bundled_library_is_complete() {
        let library = bundled();
        assert_eq!(library.presets.len(), 453);
        assert_eq!(library.categories.len(), 16);
        assert_eq!(library.meta.count, 453);

        let mut ids = HashSet::new();
        let mut with_image = 0;
        let mut needs = 0;
        for preset in &library.presets {
            assert!(ids.insert(preset.raw.id.clone()), "重复 id：{}", preset.raw.id);
            assert!(!preset.raw.prompt.trim().is_empty(), "空提示词：{}", preset.raw.id);
            assert!(
                catalog::RATIOS.contains(&preset.ratio.as_str()),
                "比例不在目录里：{} {}",
                preset.raw.id,
                preset.ratio
            );
            if preset.raw.image.is_some() {
                with_image += 1;
                assert!(!preset.preview_url.is_empty(), "缺示例图：{}", preset.raw.id);
                assert!(preset.width > 0 && preset.height > 0, "读不到尺寸：{}", preset.raw.id);
            }
            if preset.needs_reference {
                needs += 1;
            }
        }
        assert_eq!(with_image, 450, "有图的预设应为 450 条");
        assert!(needs > 0, "应当识别出需要参考图的预设");

        let declared: u32 = library.categories.iter().map(|item| item.count).sum();
        assert_eq!(declared as usize, library.presets.len(), "分类计数之和应等于总数");
    }

    #[test]
    fn ratios_snap_to_catalog() {
        assert_eq!(nearest_ratio(1024, 1024), "1:1");
        assert_eq!(nearest_ratio(1920, 1080), "16:9");
        assert_eq!(nearest_ratio(1080, 1920), "9:16");
        assert_eq!(nearest_ratio(800, 1200), "2:3");
        assert_eq!(nearest_ratio(1200, 800), "3:2");
        // 尺寸缺失时不 panic，退回方形
        assert_eq!(nearest_ratio(0, 0), "1:1");
    }

    #[test]
    fn reference_detection_covers_both_languages() {
        assert!(needs_reference("请把附件中的图片换成动漫截图", ""));
        assert!(needs_reference("", "turn this image into a poster"));
        assert!(needs_reference("参考图里的角色再画一张", ""));
        assert!(!needs_reference("雨夜霓虹街头，电影感构图", "rainy neon street at night"));
        assert!(!needs_reference("画一只橘猫", "draw an orange cat"));
    }

    #[test]
    fn rejects_unsafe_image_paths() {
        assert!(safe_relative("../etc/passwd").is_none());
        assert!(safe_relative("a/../../b").is_none());
        assert!(safe_relative("/abs/path.webp").is_none());
        assert!(safe_relative("\\abs\\path.webp").is_none());
        assert!(safe_relative("").is_none());
        assert!(safe_relative("nb_portrait/case1.webp").is_some());
    }

    fn scratch(name: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0);
        // 沙箱里系统临时目录可能不可写，放到 target 下，cargo 本来就能写。
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("presets-tests");
        let dir = base.join(format!("{name}-{}-{stamp}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_library(root: &Path, value: serde_json::Value) {
        std::fs::create_dir_all(root.join("preview")).unwrap();
        image::RgbImage::from_pixel(8, 6, image::Rgb([24, 92, 74]))
            .save(root.join("preview").join("cover.png"))
            .unwrap();
        std::fs::write(
            root.join("presets.json"),
            serde_json::to_vec_pretty(&value).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn imports_user_library_and_normalizes_counts() {
        let dir = scratch("import");
        let source = dir.join("source");
        write_library(
            &source,
            json!({
                "meta": { "source": "测试库" },
                "categories": [{ "id": "x", "name": "测试分类" }],
                "presets": [
                    { "id": "a", "cat": "x", "title": "A", "prompt": "画 {主题}" },
                    { "id": "b", "cat": "x", "title": "B", "prompt": "画一只猫", "image": "cover.png" },
                    { "id": "c", "cat": "y", "title": "C", "prompt": "画一只狗", "image": "missing.png" }
                ]
            }),
        );
        let target = dir.join("user").join("presets");
        let (count, images, missing) = install_library(&source, &target).unwrap();
        assert_eq!(count, 3);
        assert_eq!(images, 1);
        assert_eq!(missing, 1);

        let saved: Value =
            serde_json::from_slice(&std::fs::read(target.join("presets.json")).unwrap()).unwrap();
        assert_eq!(saved["meta"]["count"], 3);
        assert!(saved["meta"]["scrapedAt"].as_str().unwrap_or("").len() > 4);
        assert_eq!(saved["presets"][2]["image"], Value::Null);
        let categories = saved["categories"].as_array().unwrap();
        assert_eq!(categories.len(), 2);
        let x = categories.iter().find(|item| item["id"] == "x").unwrap();
        assert_eq!(x["count"], 2);
        assert!(target.join("preview").join("cover.png").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_template_library_imports() {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("library-template");
        assert!(
            source.join("presets.json").is_file(),
            "模板库不见了：{}",
            source.display()
        );
        let (file, images, missing) = normalize_library(&source).unwrap();
        assert_eq!(file.presets.len(), 2);
        assert_eq!(images, 2);
        assert_eq!(missing, 0);
        assert_eq!(file.meta.count, 2);
        let categories = &file.categories;
        assert_eq!(categories.len(), 2);
        assert_eq!(
            categories.iter().map(|item| item.count as usize).sum::<usize>(),
            2
        );

        let dir = scratch("template");
        let target = dir.join("user").join("presets");
        let (count, copied, missing_files) = install_library(&source, &target).unwrap();
        assert_eq!(count, 2);
        assert_eq!(copied, 2);
        assert_eq!(missing_files, 0);
        assert!(target.join("preview").join("poster-01.png").is_file());
        assert!(target.join("preview").join("poster-02.png").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replaces_previous_user_library() {
        let dir = scratch("replace");
        let first = dir.join("first");
        write_library(
            &first,
            json!({ "presets": [{ "id": "a", "cat": "x", "title": "A", "prompt": "一" }] }),
        );
        let second = dir.join("second");
        write_library(
            &second,
            json!({ "presets": [
                { "id": "b", "cat": "y", "title": "B", "prompt": "二" },
                { "id": "c", "cat": "y", "title": "C", "prompt": "三" }
            ] }),
        );
        let target = dir.join("user").join("presets");
        install_library(&first, &target).unwrap();
        install_library(&second, &target).unwrap();
        let saved: Value =
            serde_json::from_slice(&std::fs::read(target.join("presets.json")).unwrap()).unwrap();
        assert_eq!(saved["presets"].as_array().unwrap().len(), 2);
        assert!(saved["presets"][0]["id"] == "b");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_user_library() {
        let dir = scratch("invalid");
        let missing = dir.join("missing");
        std::fs::create_dir_all(&missing).unwrap();
        assert!(install_library(&missing, &dir.join("out")).is_err());

        let dup = dir.join("dup");
        write_library(
            &dup,
            json!({ "presets": [
                { "id": "same", "cat": "x", "title": "A", "prompt": "一" },
                { "id": "same", "cat": "x", "title": "B", "prompt": "二" }
            ] }),
        );
        assert!(install_library(&dup, &dir.join("out")).is_err());

        let empty = dir.join("empty");
        write_library(&empty, json!({ "presets": [{ "id": "a", "cat": "x", "title": "A", "prompt": "  " }] }));
        assert!(install_library(&empty, &dir.join("out")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
