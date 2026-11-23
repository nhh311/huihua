use crate::catalog;
use crate::config;
use crate::deepseek;
use crate::styles::{self, Recommended, Style};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_TRANSCRIPT: usize = 16000;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Plan {
    pub title: String,
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub count: u32,
    pub seed: Option<i64>,
    pub style_id: Option<String>,
    pub notes: String,
    pub fallback: bool,
    pub recommended: Option<Recommended>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanParams {
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub count: u32,
    pub seed: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlannerInput {
    pub messages: Vec<Value>,
    pub params: PlanParams,
    pub style_id: Option<String>,
    pub allow_fallback: Option<bool>,
}

fn trim(value: &str, max: usize) -> String {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > max {
        format!("{}…", text.chars().take(max).collect::<String>())
    } else {
        text
    }
}

fn transcript_of(messages: &[Value]) -> String {
    let start = messages.len().saturating_sub(24);
    let mut lines = Vec::new();
    for message in &messages[start..] {
        let role = if message.get("role").and_then(Value::as_str) == Some("assistant") {
            "助手"
        } else {
            "用户"
        };
        let files = message
            .get("files")
            .or_else(|| message.get("attachments"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let file_note = if files.is_empty() {
            String::new()
        } else {
            let names: Vec<String> = files
                .iter()
                .map(|file| {
                    let name = file
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("文件");
                    let image = file
                        .get("isImage")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    if image {
                        format!("{}，图片", name)
                    } else {
                        name.to_string()
                    }
                })
                .collect();
            format!("（附带 {} 个文件：{}）", files.len(), names.join("；"))
        };
        let text = trim(
            message
                .get("content")
                .or_else(|| message.get("text"))
                .and_then(Value::as_str)
                .unwrap_or(""),
            1800,
        );
        if text.is_empty() && file_note.is_empty() {
            continue;
        }
        lines.push(format!("{}：{}{}", role, text, file_note));
    }
    let joined = lines.join("\n");
    if joined.chars().count() > MAX_TRANSCRIPT {
        joined.chars().skip(joined.chars().count() - MAX_TRANSCRIPT).collect()
    } else {
        joined
    }
}

fn available_models(config: &config::Config) -> String {
    let mut chunks = Vec::new();
    for provider in catalog::list(config) {
        let mut lines = Vec::new();
        for model in provider.models {
            lines.push(format!(
                "- {}/{}（{}）{}；比例 {}；最多 {} 张；参考图 {} 张{}",
                provider.id,
                model.id,
                model.name,
                model.resolutions.join("/"),
                model.ratios.join("/"),
                model.count_max,
                model.ref_max,
                if model.seed { "；支持 seed" } else { "" }
            ));
        }
        if !lines.is_empty() {
            chunks.push(lines.join("\n"));
        }
    }
    chunks.join("\n")
}

fn system_prompt(config: &config::Config, style: Option<&Style>, params: &PlanParams) -> String {
    let style_line = match style {
        Some(style) => format!(
            "用户当前风格：{} —— {}\n把风格作为约束融合进 prompt，用户对话里的具体描述优先于风格。",
            style.name, style.prompt
        ),
        None => "用户当前风格：未选择".into(),
    };
    format!(
        r#"你是「绘话」的生图规划师。你的任务是根据用户与助手的对话，整理出一条可以直接交给生图模型的提示词，并选择供应商、模型、比例、清晰度与张数。

只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。字段如下：
{{
  "title": "不超过 18 个字的方案名",
  "prompt": "最终提示词",
  "provider": "seedream | minimax | hunyuan",
  "model": "模型 id",
  "ratio": "1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3",
  "resolution": "1K | 1.5K | 2K | 4K",
  "count": 1,
  "seed": null,
  "styleId": null,
  "notes": "一句给用户看的说明，可空"
}}

规则：
1. prompt 用中文写，具体、可执行：主体、场景、光线、构图、风格、材质/镜头都要落到实处。不要出现“帮我生成”“根据对话”等对话词，不要编造真实品牌或真人。
2. 如果用户上传了参考图，prompt 要说明保留什么、改变什么；参考图会原样随请求发给模型，不会先做识图。
3. 优先沿用用户的当前选择：供应商 {provider}、模型 {model}、比例 {ratio}、清晰度 {resolution}、张数 {count}。只有画面明显更适合别的供应商/模型/比例时才改，并在 notes 里说明原因。
4. 只有 provider 是 hunyuan 时才填 seed（0 到 9007199254740991 的整数）；其他供应商必须填 null。
5. 不要输出负面提示词（三家都不支持）；不要输出水印参数。
6. 如果对话还不足以生成（例如用户只是在闲聊），也要给出一个最接近的方案，并在 notes 里写“信息不足，建议补充……”。
7. styleId 只能保持用户当前选择；不要自动推荐或切换风格。用户没选风格时填 null。
8. 张数 count 取 1 到 4；清晰度必须在模型支持列表内。

可选模型与能力：
{models}

{style_line}

现在请根据下面的对话输出 JSON。"#,
        provider = params.provider,
        model = params.model,
        ratio = params.ratio,
        resolution = params.resolution,
        count = params.count,
        models = available_models(config),
        style_line = style_line,
    )
}

pub fn parse_json(text: &str) -> Result<Value, String> {
    let mut body = text.trim().to_string();
    if body.starts_with("```") {
        body = body.trim_start_matches("```json").trim_start_matches("```").to_string();
    }
    if body.ends_with("```") {
        body = body.trim_end_matches("```").to_string();
    }
    let start = body.find('{').ok_or_else(|| "规划结果不是 JSON".to_string())?;
    let end = body.rfind('}').ok_or_else(|| "规划结果不是 JSON".to_string())?;
    if end <= start {
        return Err("规划结果不是 JSON".into());
    }
    serde_json::from_str(&body[start..=end]).map_err(|e| format!("规划结果不是 JSON：{}", e))
}

fn pick_model(config: &config::Config, provider: &str, model_id: &str) -> Option<catalog::ModelView> {
    catalog::find(config, provider, model_id)
        .or_else(|| catalog::find(config, provider, &catalog::default_model(config, provider)))
}

fn fallback_plan(
    config: &config::Config,
    input: &PlannerInput,
    params: &PlanParams,
    style: Option<&Style>,
) -> Plan {
    let model = pick_model(config, &params.provider, &params.model);
    let latest = input
        .messages
        .iter()
        .rev()
        .find(|message| {
            message.get("role").and_then(Value::as_str) != Some("assistant")
                && !message
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .is_empty()
        })
        .and_then(|message| message.get("content").and_then(Value::as_str))
        .unwrap_or("一张有质感的画面");
    let base = trim(latest, 1800);
    let prompt = match style {
        Some(style) => format!("{}；风格约束：{}", base, style.prompt),
        None => base.clone(),
    };
    let recommended = style.and_then(|s| s.recommended.clone());
    let (provider, model_id, ratio, resolution, count, seed) = match model {
        Some(model) => {
            let ratio = if model.ratios.contains(&params.ratio) {
                params.ratio.clone()
            } else {
                model.default_ratio.clone()
            };
            let resolution = if model.resolutions.contains(&params.resolution) {
                params.resolution.clone()
            } else {
                model.default_resolution.clone()
            };
            (
                model.provider,
                model.id,
                ratio,
                resolution,
                params.count.clamp(1, model.count_max.min(4)),
                if model.seed { params.seed } else { None },
            )
        }
        None => (
            if params.provider.is_empty() {
                "seedream".into()
            } else {
                params.provider.clone()
            },
            params.model.clone(),
            "1:1".into(),
            "2K".into(),
            params.count.clamp(1, 4),
            None,
        ),
    };
    Plan {
        title: if base.is_empty() {
            "未命名方案".into()
        } else {
            trim(&base, 30)
        },
        prompt,
        provider,
        model: model_id,
        ratio,
        resolution,
        count,
        seed,
        style_id: input.style_id.clone(),
        notes: "自动整理没有成功，已用最近一条描述生成草稿；可以手动修改方案。".into(),
        fallback: true,
        recommended,
    }
}

fn normalize_plan(
    raw: &Value,
    input: &PlannerInput,
    params: &PlanParams,
    style: Option<&Style>,
) -> Result<Plan, String> {
    let config = config::load();
    let providers = ["seedream", "minimax", "hunyuan"];
    let raw_provider = raw.get("provider").and_then(Value::as_str).unwrap_or("");
    let mut provider = if providers.contains(&raw_provider) {
        raw_provider.to_string()
    } else if providers.contains(&params.provider.as_str()) {
        params.provider.clone()
    } else {
        "seedream".into()
    };
    let raw_model = raw.get("model").and_then(Value::as_str).unwrap_or("");
    let mut model = pick_model(&config, &provider, raw_model)
        .or_else(|| pick_model(&config, &provider, &params.model));
    if model.is_none() {
        provider = "seedream".into();
        model = pick_model(&config, &provider, &catalog::default_model(&config, &provider));
    }
    let model = model.ok_or_else(|| "没有可用的生图模型".to_string())?;

    let prompt = raw
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if prompt.is_empty() {
        return Err("规划结果没有提示词".into());
    }

    let raw_ratio = raw.get("ratio").and_then(Value::as_str).unwrap_or("");
    let ratio = if model.ratios.iter().any(|x| x == raw_ratio) {
        raw_ratio.to_string()
    } else if model.ratios.iter().any(|x| x == &params.ratio) {
        params.ratio.clone()
    } else {
        model.default_ratio.clone()
    };

    let raw_resolution = raw.get("resolution").and_then(Value::as_str).unwrap_or("");
    let resolution = if model.resolutions.iter().any(|x| x == raw_resolution) {
        raw_resolution.to_string()
    } else if model.resolutions.iter().any(|x| x == &params.resolution) {
        params.resolution.clone()
    } else {
        model.default_resolution.clone()
    };

    let count = raw
        .get("count")
        .and_then(Value::as_u64)
        .unwrap_or(params.count as u64)
        .clamp(1, 4) as u32;
    let count = count.min(model.count_max.max(1));

    let mut seed = None;
    if model.seed {
        let candidate = raw
            .get("seed")
            .and_then(Value::as_i64)
            .or(params.seed)
            .unwrap_or(0);
        if candidate >= 0 {
            seed = Some(candidate.min(9_007_199_254_740_991));
        }
    }

    let title = raw
        .get("title")
        .and_then(Value::as_str)
        .map(|x| trim(x, 30))
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| {
            let value = trim(&prompt, 30);
            if value.is_empty() {
                "生图方案".into()
            } else {
                value
            }
        });

    Ok(Plan {
        title,
        prompt,
        provider,
        model: model.id.clone(),
        ratio,
        resolution,
        count,
        seed,
        style_id: input.style_id.clone(),
        notes: trim(
            raw.get("notes").and_then(Value::as_str).unwrap_or(""),
            300,
        ),
        fallback: false,
        recommended: style.and_then(|s| s.recommended.clone()),
    })
}

pub async fn plan(input: PlannerInput) -> Result<Plan, String> {
    let config = config::load();
    let params = PlanParams {
        provider: if input.params.provider.is_empty() {
            config.defaults.provider.clone()
        } else {
            input.params.provider.clone()
        },
        model: if input.params.model.is_empty() {
            config.defaults.model.clone()
        } else {
            input.params.model.clone()
        },
        ratio: if input.params.ratio.is_empty() {
            config.defaults.ratio.clone()
        } else {
            input.params.ratio.clone()
        },
        resolution: if input.params.resolution.is_empty() {
            config.defaults.resolution.clone()
        } else {
            input.params.resolution.clone()
        },
        count: input.params.count.clamp(1, 4),
        seed: input.params.seed,
    };
    let style = input.style_id.as_deref().and_then(styles::get);
    let transcript = transcript_of(&input.messages);
    if transcript.is_empty() {
        return Err("对话还是空的，先说一句想画什么".into());
    }
    let system = system_prompt(&config, style.as_ref(), &params);
    let key = config::key_of(&config, "deepseek");
    if key.is_empty() {
        return Err("还没有填写 DeepSeek API Key".into());
    }
    let base = config::base_of(&config, "deepseek");
    let user = format!("对话记录：\n{}\n\n请输出方案 JSON。", transcript);
    let result = deepseek::complete_text(
        &key,
        &base,
        &system,
        json!([{ "role": "user", "content": user }]),
        1600,
        true,
        deepseek::EFFORT_HIGH,
    )
    .await;
    match result {
        Ok(text) => {
            let raw = parse_json(&text)?;
            normalize_plan(&raw, &input, &params, style.as_ref())
        }
        Err(error) => {
            if input.allow_fallback == Some(false) {
                Err(error)
            } else {
                Ok(fallback_plan(&config, &input, &params, style.as_ref()))
            }
        }
    }
}
