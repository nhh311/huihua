use crate::config::{Config, CustomModel};
use serde::Serialize;

pub const RATIOS: [&str; 7] = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
pub const RESOLUTIONS_1: [&str; 3] = ["1K", "1.5K", "2K"];
pub const RESOLUTIONS_4K: [&str; 3] = ["1K", "2K", "4K"];
pub const PROVIDER_ORDER: [&str; 3] = ["seedream", "minimax", "hunyuan"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelView {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub provider: String,
    pub resolutions: Vec<String>,
    pub ratios: Vec<String>,
    pub default_resolution: String,
    pub default_ratio: String,
    pub count_max: u32,
    pub ref_max: u32,
    pub seed: bool,
    pub negative: bool,
    pub watermark: bool,
    pub edit: bool,
    pub builtin: bool,
    pub adapted: bool,
    pub aspect_hint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub base_url: String,
    pub default_model: String,
    pub has_key: bool,
    pub models: Vec<ModelView>,
}

#[derive(Clone, Debug)]
pub struct Size {
    pub width: u32,
    pub height: u32,
    pub size: String,
}

pub fn provider_meta(id: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match id {
        "seedream" => (
            "Seedream",
            "火山方舟",
            "https://ark.cn-beijing.volces.com/api/v3",
            "doubao-seedream-5-5-261028",
        ),
        "minimax" => (
            "MiniMax",
            "稀宇科技",
            "https://api.minimax.cn",
            "MiniMax-H3-Image",
        ),
        _ => (
            "混元",
            "腾讯 TokenHub",
            "https://tokenhub.tencentmaas.com",
            "hy-image-v3.5-preview",
        ),
    }
}

fn text(value: &str) -> String {
    value.to_string()
}

fn base_model(
    provider: &str,
    id: &str,
    name: &str,
    desc: &str,
    resolutions: &[&str],
    ref_max: u32,
    seed: bool,
) -> ModelView {
    let default_resolution = resolutions.first().unwrap_or(&"2K").to_string();
    let size = size_for(provider, "1:1", &default_resolution, None);
    ModelView {
        id: text(id),
        name: text(name),
        desc: text(desc),
        provider: text(provider),
        resolutions: resolutions.iter().map(|x| text(x)).collect(),
        ratios: RATIOS.iter().map(|x| text(x)).collect(),
        default_resolution,
        default_ratio: "1:1".into(),
        count_max: 4,
        ref_max,
        seed,
        negative: false,
        watermark: false,
        edit: true,
        builtin: true,
        adapted: true,
        aspect_hint: format!("{}×{}", size.width, size.height),
        enabled: None,
        hidden: None,
    }
}

fn builtin_models(provider: &str) -> Vec<ModelView> {
    match provider {
        "seedream" => vec![
            base_model(
                provider,
                "doubao-seedream-5-5-261028",
                "Seedream 5.5",
                "最新旗舰，原生 RGBA，多轮编辑",
                &RESOLUTIONS_1,
                10,
                false,
            ),
            base_model(
                provider,
                "doubao-seedream-5-0-pro-260628",
                "Seedream 5.0 Pro",
                "高质量，支持 4K",
                &RESOLUTIONS_4K,
                10,
                false,
            ),
            base_model(
                provider,
                "doubao-seedream-5-0-flash-260915",
                "Seedream 5.0 Flash",
                "速度优先",
                &RESOLUTIONS_4K,
                10,
                false,
            ),
        ],
        "minimax" => vec![
            base_model(
                provider,
                "MiniMax-H3-Image",
                "H3 Image",
                "最新旗舰，最高 4K",
                &RESOLUTIONS_4K,
                16,
                false,
            ),
            base_model(
                provider,
                "MiniMax-H3-Image-Highspeed",
                "H3 Image 高速版",
                "速度优先，参数同旗舰",
                &RESOLUTIONS_4K,
                16,
                false,
            ),
        ],
        _ => vec![base_model(
            provider,
            "hy-image-v3.5-preview",
            "混元图像 3.5",
            "Preview，唯一可新接入版本",
            &RESOLUTIONS_1,
            5,
            true,
        )],
    }
}

fn hidden(config: &Config, id: &str) -> bool {
    config.models.hidden.iter().any(|x| x == id)
}

fn enabled_for(config: &Config, provider: &str, id: &str) -> bool {
    if hidden(config, id) {
        return false;
    }
    match config.models.enabled.get(provider) {
        Some(list) if !list.is_empty() => list.iter().any(|x| x == id),
        _ => true,
    }
}

fn custom_for<'a>(config: &'a Config, provider: &str) -> Vec<&'a CustomModel> {
    config
        .models
        .custom
        .iter()
        .filter(|item| item.provider == provider && !item.id.trim().is_empty())
        .collect()
}

fn custom_entry(provider: &str, custom: &CustomModel, base: &ModelView) -> ModelView {
    let resolutions: Vec<String> = custom
        .resolutions
        .clone()
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| base.resolutions.clone());
    let default_resolution = resolutions.first().cloned().unwrap_or_else(|| "2K".into());
    ModelView {
        id: custom.id.clone(),
        name: if custom.name.trim().is_empty() {
            custom.id.clone()
        } else {
            custom.name.clone()
        },
        desc: if custom.desc.trim().is_empty() {
            "手动添加的模型".into()
        } else {
            custom.desc.clone()
        },
        provider: provider.to_string(),
        resolutions,
        ratios: RATIOS.iter().map(|x| text(x)).collect(),
        default_resolution,
        default_ratio: "1:1".into(),
        count_max: 4,
        ref_max: base.ref_max,
        seed: provider == "hunyuan",
        negative: false,
        watermark: false,
        edit: true,
        builtin: false,
        adapted: false,
        aspect_hint: String::new(),
        enabled: None,
        hidden: None,
    }
}

pub fn list(config: &Config) -> Vec<ProviderView> {
    PROVIDER_ORDER
        .iter()
        .map(|provider| {
            let (name, subtitle, default_base, default_model) = provider_meta(provider);
            let builtin = builtin_models(provider);
            let base = builtin.first().cloned();
            let mut models = Vec::new();
            for model in builtin {
                if enabled_for(config, provider, &model.id) {
                    models.push(model);
                }
            }
            for custom in custom_for(config, provider) {
                if let Some(base) = base.as_ref() {
                    if enabled_for(config, provider, &custom.id) {
                        models.push(custom_entry(provider, custom, base));
                    }
                }
            }
            let base_url = match *provider {
                "seedream" => &config.providers.seedream.base_url,
                "minimax" => &config.providers.minimax.base_url,
                _ => &config.providers.hunyuan.base_url,
            };
            let has_key = match *provider {
                "seedream" => !config.providers.seedream.key.trim().is_empty(),
                "minimax" => !config.providers.minimax.key.trim().is_empty(),
                _ => !config.providers.hunyuan.key.trim().is_empty(),
            };
            ProviderView {
                id: provider.to_string(),
                name: name.into(),
                subtitle: subtitle.into(),
                base_url: if base_url.trim().is_empty() {
                    default_base.into()
                } else {
                    base_url.trim().trim_end_matches('/').into()
                },
                default_model: default_model.into(),
                has_key,
                models,
            }
        })
        .collect()
}

pub fn all(config: &Config) -> Vec<ProviderView> {
    PROVIDER_ORDER
        .iter()
        .map(|provider| {
            let (name, subtitle, default_base, default_model) = provider_meta(provider);
            let mut models = Vec::new();
            let builtin = builtin_models(provider);
            let base = builtin.first().cloned();
            for mut model in builtin {
                model.enabled = Some(enabled_for(config, provider, &model.id));
                model.hidden = Some(hidden(config, &model.id));
                models.push(model);
            }
            for custom in custom_for(config, provider) {
                if let Some(base) = base.as_ref() {
                    let mut model = custom_entry(provider, custom, base);
                    model.enabled = Some(enabled_for(config, provider, &custom.id));
                    model.hidden = Some(hidden(config, &custom.id));
                    models.push(model);
                }
            }
            let base_url = match *provider {
                "seedream" => &config.providers.seedream.base_url,
                "minimax" => &config.providers.minimax.base_url,
                _ => &config.providers.hunyuan.base_url,
            };
            let has_key = match *provider {
                "seedream" => !config.providers.seedream.key.trim().is_empty(),
                "minimax" => !config.providers.minimax.key.trim().is_empty(),
                _ => !config.providers.hunyuan.key.trim().is_empty(),
            };
            ProviderView {
                id: provider.to_string(),
                name: name.into(),
                subtitle: subtitle.into(),
                base_url: if base_url.trim().is_empty() {
                    default_base.into()
                } else {
                    base_url.trim().trim_end_matches('/').into()
                },
                default_model: default_model.into(),
                has_key,
                models,
            }
        })
        .collect()
}

pub fn find(config: &Config, provider: &str, model_id: &str) -> Option<ModelView> {
    if !PROVIDER_ORDER.contains(&provider) || !enabled_for(config, provider, model_id) {
        return None;
    }
    let builtin = builtin_models(provider);
    if let Some(model) = builtin.into_iter().find(|m| m.id == model_id) {
        return Some(model);
    }
    let base = builtin_models(provider).into_iter().next()?;
    custom_for(config, provider)
        .into_iter()
        .find(|m| m.id == model_id)
        .map(|m| custom_entry(provider, m, &base))
}

pub fn default_model(config: &Config, provider: &str) -> String {
    let (_, _, _, fallback) = provider_meta(provider);
    if find(config, provider, fallback).is_some() {
        return fallback.to_string();
    }
    builtin_models(provider)
        .into_iter()
        .find(|m| enabled_for(config, provider, &m.id))
        .map(|m| m.id)
        .unwrap_or_else(|| fallback.to_string())
}

pub fn ratio_numbers(ratio: &str) -> (f64, f64) {
    let mut parts = ratio.split(':');
    let w = parts.next().and_then(|x| x.parse::<f64>().ok()).unwrap_or(1.0);
    let h = parts.next().and_then(|x| x.parse::<f64>().ok()).unwrap_or(1.0);
    if w <= 0.0 || h <= 0.0 {
        (1.0, 1.0)
    } else {
        (w, h)
    }
}

fn align16(value: f64) -> u32 {
    ((value / 16.0).round() * 16.0).max(256.0) as u32
}

fn clamp_area(width: &mut f64, height: &mut f64, min: f64, max: f64) {
    let mut area = *width * *height;
    if area < min {
        let scale = (min / area).sqrt();
        *width *= scale;
        *height *= scale;
        area = min;
    }
    if area > max {
        let scale = (max / area).sqrt();
        *width *= scale;
        *height *= scale;
    }
}

pub fn size_for(provider: &str, ratio: &str, resolution: &str, max_area: Option<f64>) -> Size {
    let (rw, rh) = ratio_numbers(ratio);
    let target = match resolution {
        "1K" => 1024.0 * 1024.0,
        "1.5K" => 1536.0 * 1536.0,
        "2K" => 2048.0 * 2048.0,
        "4K" => 4096.0 * 4096.0,
        _ => 2048.0 * 2048.0,
    };
    let mut width = (target * rw / rh).sqrt();
    let mut height = width * (rh / rw);
    match provider {
        "seedream" => clamp_area(&mut width, &mut height, 921600.0, max_area.unwrap_or(4624220.0)),
        "hunyuan" => clamp_area(&mut width, &mut height, 0.0, 16777216.0),
        _ => clamp_area(&mut width, &mut height, 655360.0, 20000000.0),
    }
    let w = align16(width).min(8192);
    let h = align16(height).min(8192);
    Size {
        width: w,
        height: h,
        size: format!("{}x{}", w, h),
    }
}
