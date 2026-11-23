use crate::paths;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recommended {
    pub provider: String,
    pub ratio: String,
    pub resolution: String,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Style {
    pub id: String,
    pub name: String,
    pub description: String,
    /// image = 图片技能；asset = 插画素材技能；preset = 预设库装进来的。
    pub kind: Option<String>,
    pub prompt: String,
    /// 来源标识（如 `preset:<id>`）。同一来源再次安装时更新原风格，而不是多出一份。
    pub source_id: Option<String>,
    /// 极详细的完整规格（Markdown），只给用户看和后续迭代用，不直接进生图请求。
    pub spec: Option<String>,
    pub recommended: Option<Recommended>,
    pub samples: Vec<String>,
    pub sample_urls: Vec<String>,
    pub cover_url: Option<String>,
    pub builtin: bool,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SampleInput {
    #[serde(default)]
    pub data_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleInput {
    pub name: String,
    pub description: String,
    pub kind: Option<String>,
    pub prompt: String,
    pub spec: Option<String>,
    pub recommended: Option<Recommended>,
    pub samples: Vec<SampleInput>,
    pub source_id: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StyleMeta {
    version: u32,
    id: String,
    name: String,
    description: String,
    kind: Option<String>,
    prompt: String,
    spec: Option<String>,
    recommended: Option<Recommended>,
    samples: Vec<String>,
    created_at: Option<String>,
    source_id: Option<String>,
}

fn builtin() -> Vec<Style> {
    let entries = [
        (
            "builtin-cinematic-night",
            "电影感夜景",
            "霓虹、体积光、浅景深，适合城市与人物夜景",
            "电影感夜景，低照度霓虹光影，体积光穿过空气，浅景深，35mm 电影镜头，细腻胶片颗粒，高对比，冷暖光源对撞，画面有故事感",
            "16:9",
        ),
        (
            "builtin-japanese-illustration",
            "日系插画",
            "干净线稿、柔和赛璐璐、通透自然光",
            "日系动画插画，干净利落的线稿，柔和的赛璐璐上色，通透的高光与空气感，细腻的背景层次，自然光，治愈系配色，构图舒展",
            "3:4",
        ),
        (
            "builtin-product-photo",
            "产品摄影",
            "柔光箱、轮廓光、无缝背景，适合商品与静物",
            "商业产品摄影，柔光箱主光，克制的轮廓光，无缝纯色背景，微距级材质细节，高级质感，干净构图，真实阴影，广告级锐度",
            "1:1",
        ),
    ];
    entries
        .iter()
        .map(|(id, name, description, prompt, ratio)| Style {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            kind: Some("image".into()),
            prompt: prompt.to_string(),
            source_id: None,
            spec: None,
            recommended: Some(Recommended {
                provider: "seedream".into(),
                ratio: ratio.to_string(),
                resolution: "2K".into(),
                count: 1,
            }),
            samples: vec![],
            sample_urls: vec![],
            cover_url: None,
            builtin: true,
            created_at: None,
        })
        .collect()
}

fn clean(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

fn normalize_kind(value: Option<String>) -> Option<String> {
    match value.as_deref().map(str::trim) {
        Some("asset") => Some("asset".into()),
        Some("image") => Some("image".into()),
        Some("preset") => Some("preset".into()),
        _ => None,
    }
}

fn normalize_recommended(value: Option<Recommended>) -> Option<Recommended> {
    let value = value?;
    if !["seedream", "minimax", "hunyuan"].contains(&value.provider.as_str()) {
        return None;
    }
    Some(Recommended {
        provider: value.provider,
        ratio: if crate::catalog::RATIOS.contains(&value.ratio.as_str()) {
            value.ratio
        } else {
            "1:1".into()
        },
        resolution: if ["1K", "1.5K", "2K", "4K"].contains(&value.resolution.as_str()) {
            value.resolution
        } else {
            "2K".into()
        },
        count: value.count.clamp(1, 4),
    })
}

fn safe_file(file: &str) -> String {
    let cleaned: String = file
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "sample.png".into()
    } else {
        cleaned
    }
}

fn sample_path(id: &str, file: &str) -> PathBuf {
    paths::dirs()
        .styles
        .join(paths::safe_id(id))
        .join("samples")
        .join(safe_file(file))
}

fn load_user(id: &str) -> Option<Style> {
    let safe = paths::safe_id(id);
    let dir = paths::dirs().styles.join(&safe);
    let meta: StyleMeta = paths::read_json(&dir.join("style.json"))?;
    let samples: Vec<String> = meta
        .samples
        .into_iter()
        .filter(|file| sample_path(&safe, file).exists())
        .collect();
    let sample_urls: Vec<String> = samples
        .iter()
        .map(|file| paths::data_url(&sample_path(&safe, file)))
        .collect();
    Some(Style {
        id: safe,
        name: if meta.name.trim().is_empty() {
            "未命名风格".into()
        } else {
            clean(&meta.name, 40)
        },
        description: clean(&meta.description, 300),
        kind: normalize_kind(meta.kind),
        prompt: clean(&meta.prompt, 8000),
        spec: meta
            .spec
            .map(|value| clean(&value, 20000))
            .filter(|value| !value.is_empty()),
        recommended: normalize_recommended(meta.recommended),
        cover_url: sample_urls.first().cloned(),
        samples,
        sample_urls,
        builtin: false,
        created_at: meta.created_at,
        source_id: meta.source_id,
    })
}

pub fn list() -> Vec<Style> {
    let _ = paths::ensure_dirs();
    let mut out = builtin();
    if let Ok(entries) = fs::read_dir(paths::dirs().styles) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            if let Some(name) = entry.file_name().to_str() {
                if let Some(style) = load_user(name) {
                    out.push(style);
                }
            }
        }
    }
    out
}

fn find_by_source(source: &str) -> Option<String> {
    let entries = fs::read_dir(paths::dirs().styles).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(meta) = paths::read_json::<StyleMeta>(&path.join("style.json")) else {
            continue;
        };
        if meta.source_id.as_deref() == Some(source) {
            return Some(paths::safe_id(&name));
        }
    }
    None
}

pub fn get(id: &str) -> Option<Style> {
    if id.trim().is_empty() {
        return None;
    }
    if let Some(style) = builtin().into_iter().find(|x| x.id == id) {
        return Some(style);
    }
    load_user(id)
}

fn decode_data_url(value: &str) -> Result<(Vec<u8>, String, &'static str), String> {
    let value = value.trim();
    if !value.starts_with("data:") {
        return Err("示例图格式不正确".into());
    }
    let Some((head, body)) = value.split_once(',') else {
        return Err("示例图格式不正确".into());
    };
    let is_base64 = head.ends_with(";base64");
    let mime = head
        .trim_start_matches("data:")
        .trim_end_matches(";base64")
        .split(';')
        .next()
        .unwrap_or("image/png")
        .to_string();
    let buffer = if is_base64 {
        base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|_| "示例图 base64 解码失败".to_string())?
    } else {
        body.as_bytes().to_vec()
    };
    if buffer.len() > 12 * 1024 * 1024 {
        return Err("单张示例图不能超过 12MB".into());
    }
    let ext = if mime.contains("jpeg") {
        ".jpg"
    } else if mime.contains("webp") {
        ".webp"
    } else if mime.contains("gif") {
        ".gif"
    } else {
        ".png"
    };
    Ok((buffer, mime, ext))
}

pub fn save(input: StyleInput) -> Result<Style, String> {
    let _ = paths::ensure_dirs();
    let name = clean(&input.name, 40);
    let prompt = clean(&input.prompt, 8000);
    if name.is_empty() {
        return Err("请给风格起个名字".into());
    }
    if prompt.is_empty() {
        return Err("风格提示词不能为空".into());
    }
    let source_id = input
        .source_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| clean(value, 120));
    // 同一个来源（比如同一条预设）再次安装时复用原来的 id，
    // 覆盖旧目录，避免风格列表里堆出重复项。
    let id = source_id
        .as_deref()
        .and_then(find_by_source)
        .unwrap_or_else(|| {
            format!(
                "style-{}-{}",
                chrono::Local::now().timestamp_millis(),
                &uuid::Uuid::new_v4().to_string()[..6]
            )
        });
    let dir = paths::dirs().styles.join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let samples_dir = dir.join("samples");
    fs::create_dir_all(&samples_dir).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for (index, sample) in input.samples.iter().take(3).enumerate() {
        if sample.data_url.trim().is_empty() {
            continue;
        }
        let (buffer, _mime, ext) = decode_data_url(&sample.data_url)?;
        let file = format!("sample-{}{}", index + 1, ext);
        fs::write(samples_dir.join(&file), buffer).map_err(|e| e.to_string())?;
        files.push(file);
    }
    let meta = StyleMeta {
        version: 1,
        id: id.clone(),
        name,
        description: clean(&input.description, 300),
        kind: normalize_kind(input.kind),
        prompt,
        spec: input
            .spec
            .map(|value| clean(&value, 20000))
            .filter(|value| !value.is_empty()),
        recommended: normalize_recommended(input.recommended),
        samples: files,
        created_at: Some(paths::now_iso()),
        source_id,
    };
    paths::write_json(&dir.join("style.json"), &meta)?;
    get(&id).ok_or_else(|| "风格保存失败".into())
}

pub fn remove(id: &str) -> Result<bool, String> {
    let Some(style) = get(id) else {
        return Ok(false);
    };
    if style.builtin {
        return Ok(false);
    }
    let dir = paths::dirs().styles.join(paths::safe_id(id));
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(true)
}
