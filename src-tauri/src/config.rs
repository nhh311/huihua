use crate::paths;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderConf {
    pub key: String,
    pub base_url: String,
}

impl Default for ProviderConf {
    fn default() -> Self {
        Self {
            key: String::new(),
            base_url: String::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeepSeekConf {
    pub key: String,
    pub base_url: String,
}

impl Default for DeepSeekConf {
    fn default() -> Self {
        Self {
            key: String::new(),
            base_url: "https://api.deepseek.com".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProvidersConf {
    pub minimax: ProviderConf,
    pub seedream: ProviderConf,
    pub hunyuan: ProviderConf,
}

impl Default for ProvidersConf {
    fn default() -> Self {
        Self {
            minimax: ProviderConf {
                key: String::new(),
                base_url: "https://api.minimax.cn".into(),
            },
            seedream: ProviderConf {
                key: String::new(),
                base_url: "https://ark.cn-beijing.volces.com/api/v3".into(),
            },
            hunyuan: ProviderConf {
                key: String::new(),
                base_url: "https://tokenhub.tencentmaas.com".into(),
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Defaults {
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub count: u32,
    pub style_id: Option<String>,
    pub search: bool,
    pub theme: String,
}

impl Default for Defaults {
    fn default() -> Self {
        Self {
            provider: "seedream".into(),
            model: "doubao-seedream-5-5-261028".into(),
            ratio: "1:1".into(),
            resolution: "2K".into(),
            count: 1,
            style_id: None,
            search: true,
            theme: "system".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomModel {
    pub id: String,
    pub provider: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub resolutions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelsConf {
    pub enabled: HashMap<String, Vec<String>>,
    pub hidden: Vec<String>,
    pub custom: Vec<CustomModel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub deepseek: DeepSeekConf,
    pub providers: ProvidersConf,
    pub defaults: Defaults,
    pub models: ModelsConf,
    pub onboarded: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            deepseek: DeepSeekConf::default(),
            providers: ProvidersConf::default(),
            defaults: Defaults::default(),
            models: ModelsConf::default(),
            onboarded: false,
        }
    }
}

pub fn load() -> Config {
    let path = paths::dirs().config;
    paths::read_json::<Config>(&path).unwrap_or_default()
}

pub fn save(config: &Config) -> Result<(), String> {
    paths::write_json(&paths::dirs().config, config)
}

pub fn provider_name(id: &str) -> &'static str {
    match id {
        "seedream" => "Seedream",
        "minimax" => "MiniMax",
        "hunyuan" => "混元",
        _ => "未知供应商",
    }
}

pub fn key_of(config: &Config, provider: &str) -> String {
    if provider == "deepseek" {
        return config.deepseek.key.trim().to_string();
    }
    let entry = match provider {
        "seedream" => &config.providers.seedream,
        "minimax" => &config.providers.minimax,
        "hunyuan" => &config.providers.hunyuan,
        _ => return String::new(),
    };
    entry.key.trim().to_string()
}

pub fn base_of(config: &Config, provider: &str) -> String {
    let raw = if provider == "deepseek" {
        config.deepseek.base_url.as_str()
    } else {
        match provider {
            "seedream" => config.providers.seedream.base_url.as_str(),
            "minimax" => config.providers.minimax.base_url.as_str(),
            "hunyuan" => config.providers.hunyuan.base_url.as_str(),
            _ => "",
        }
    };
    raw.trim().trim_end_matches('/').to_string()
}

pub fn mask(key: &str) -> String {
    if key.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "已保存".into();
    }
    let head: String = chars.iter().take(3).collect();
    let tail: String = chars.iter().skip(chars.len().saturating_sub(4)).collect();
    format!("{}…{}", head, tail)
}

pub fn sanitize(config: &Config) -> Value {
    let providers = json!({
        "seedream": {
            "baseUrl": config.providers.seedream.base_url,
            "hasKey": !config.providers.seedream.key.trim().is_empty(),
            "keyHint": mask(&config.providers.seedream.key),
        },
        "minimax": {
            "baseUrl": config.providers.minimax.base_url,
            "hasKey": !config.providers.minimax.key.trim().is_empty(),
            "keyHint": mask(&config.providers.minimax.key),
        },
        "hunyuan": {
            "baseUrl": config.providers.hunyuan.base_url,
            "hasKey": !config.providers.hunyuan.key.trim().is_empty(),
            "keyHint": mask(&config.providers.hunyuan.key),
        },
    });
    json!({
        "version": config.version,
        "deepseek": {
            "baseUrl": config.deepseek.base_url,
            "hasKey": !config.deepseek.key.trim().is_empty(),
            "keyHint": mask(&config.deepseek.key),
        },
        "providers": providers,
        "defaults": config.defaults,
        "models": config.models,
        "onboarded": config.onboarded,
        "dataDir": paths::dirs().root.to_string_lossy(),
    })
}

pub fn update(config: &mut Config, patch: &Value) -> Result<(), String> {
    if let Some(value) = patch.get("deepseekKey").and_then(Value::as_str) {
        let value = value.trim();
        if !value.is_empty() {
            config.deepseek.key = value.to_string();
        }
    }
    if let Some(value) = patch.get("deepseekBaseUrl").and_then(Value::as_str) {
        let value = value.trim().trim_end_matches('/');
        if !value.is_empty() {
            config.deepseek.base_url = value.to_string();
        }
    }
    if let Some(value) = patch.get("hidden").and_then(Value::as_array) {
        config.models.hidden = value
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(value) = patch.get("custom").and_then(Value::as_array) {
        config.models.custom = value
            .iter()
            .filter_map(|item| serde_json::from_value::<CustomModel>(item.clone()).ok())
            .filter(|item| !item.id.trim().is_empty() && !item.provider.trim().is_empty())
            .collect();
    }
    if let Some(value) = patch.get("enabled").and_then(Value::as_object) {
        for (provider, ids) in value {
            if let Some(list) = ids.as_array() {
                let list: Vec<String> = list
                    .iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect();
                if list.is_empty() {
                    config.models.enabled.remove(provider);
                } else {
                    config.models.enabled.insert(provider.clone(), list);
                }
            }
        }
    }
    if let Some(value) = patch.get("defaults") {
        if let Ok(defaults) = serde_json::from_value::<Defaults>(value.clone()) {
            let mut defaults = defaults;
            defaults.count = defaults.count.clamp(1, 4);
            config.defaults = defaults;
        }
    }
    if let Some(value) = patch.get("onboarded").and_then(Value::as_bool) {
        config.onboarded = value;
    }
    if let Some(providers) = patch.get("providers").and_then(Value::as_object) {
        for id in ["seedream", "minimax", "hunyuan"] {
            let Some(incoming) = providers.get(id) else {
                continue;
            };
            let target = match id {
                "seedream" => &mut config.providers.seedream,
                "minimax" => &mut config.providers.minimax,
                _ => &mut config.providers.hunyuan,
            };
            if let Some(key) = incoming.get("key").and_then(Value::as_str) {
                let key = key.trim();
                if !key.is_empty() {
                    target.key = key.to_string();
                }
            }
            if let Some(base) = incoming.get("baseUrl").and_then(Value::as_str) {
                let base = base.trim().trim_end_matches('/');
                if !base.is_empty() {
                    target.base_url = base.to_string();
                }
            }
        }
    }
    save(config)?;
    Ok(())
}

pub fn reset() -> Result<Config, String> {
    // 「恢复默认设置」只重置地址、模型和偏好，已经填好的 Key 和引导状态都保留，
    // 否则用户会毫无提示地丢掉四把 Key。
    let current = load();
    let mut config = Config::default();
    config.deepseek.key = current.deepseek.key;
    config.providers.minimax.key = current.providers.minimax.key;
    config.providers.seedream.key = current.providers.seedream.key;
    config.providers.hunyuan.key = current.providers.hunyuan.key;
    config.onboarded = current.onboarded;
    save(&config)?;
    Ok(config)
}
