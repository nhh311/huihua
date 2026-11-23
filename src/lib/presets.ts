import type { Preset } from '../types'

/** 原站推荐模型的简短名字，只用于展示 */
export const SOURCE_MODEL_LABEL: Record<string, string> = {
  'nano-banana-pro-plus': 'Banana Pro',
  'gpt-image-2': 'GPT-Image 2',
}

export const sourceModelName = (model: string) => SOURCE_MODEL_LABEL[model] || model

export const splitVars = (value: string | null | undefined): string[] =>
  (value || '')
    .split(/[,，、/]/)
    .map((item) => item.trim().replace(/^可修改[:：]\s*/, ''))
    .filter(Boolean)

/** 从提示词里按出现顺序取 `{变量}`，去重；这才是真正要填的变量。 */
export function promptVars(prompt: string | null | undefined): string[] {
  const names: string[] = []
  for (const match of String(prompt || '').matchAll(/\{([^{}]+)\}/g)) {
    const name = match[1].trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 变量名：以提示词里的 `{变量}` 为准（原站 vars 字段是给人看的描述，
 * 分隔符混用「、」「/」「，」，直接切会漏掉真正的槽位）。
 */
export function presetVars(preset: Preset, lang: 'zh' | 'en' = 'zh'): string[] {
  const fromPrompt = promptVars(lang === 'en' ? preset.promptEn || preset.prompt : preset.prompt)
  if (fromPrompt.length) return fromPrompt
  return splitVars(lang === 'en' ? preset.varsEn || preset.vars : preset.vars)
}

/** 变量默认值：预设自带的 params 优先，缺失的留空 */
export function defaultValues(preset: Preset): Record<string, string> {
  const values: Record<string, string> = {}
  for (const slot of presetSlots(preset)) {
    values[slot.key] = preset.params?.[slot.zh] || preset.params?.[slot.en] || ''
  }
  return values
}

export interface PresetSlot {
  /** 表单里的稳定键：优先中文名，缺中文时用英文名 */
  key: string
  zh: string
  en: string
}

/**
 * 中英变量按位置配对成一个槽位。少数预设中英变量数不一致（6/453），
 * 多出来的一侧也保留成可填的槽位，避免切到 EN 后有空位填不上。
 */
export function presetSlots(preset: Preset): PresetSlot[] {
  const zhVars = presetVars(preset, 'zh')
  const enVars = presetVars(preset, 'en')
  const total = Math.max(zhVars.length, enVars.length)
  const slots: PresetSlot[] = []
  for (let index = 0; index < total; index += 1) {
    const zh = zhVars[index] || ''
    const en = enVars[index] || ''
    slots.push({ key: zh || en, zh, en })
  }
  return slots
}

const pattern = /\{([^{}]+)\}/g

/** 提示词里明写的比例，例如「图像比例为4:3」「16:9 横版」 */
const ratioPattern =
  /\b(21:9|16:9|9:16|4:3|3:4|3:2|2:3|1:1|4:5|5:4|9:13|13:9|2:1|1:2)\b/g

/** 引擎不支持的常见比例 → 最接近的可选比例 */
const RATIO_ALIAS: Record<string, string> = {
  '4:5': '3:4',
  '5:4': '4:3',
  '9:13': '2:3',
  '13:9': '16:9',
  '21:9': '16:9',
  '2:1': '16:9',
  '1:2': '9:16',
}

export function normalizeRatio(value: string | null | undefined): string | null {
  if (!value) return null
  if (RATIO_LABEL[value]) return value
  return RATIO_ALIAS[value] || null
}

export function ratioFromPrompt(prompt: string): string | null {
  const found = (prompt || '').match(ratioPattern)
  if (!found) return null
  const mapped = [...new Set(found.map((item) => normalizeRatio(item)).filter(Boolean))]
  return mapped.length === 1 ? String(mapped[0]) : null
}

/**
 * 把提示词里的比例统一改成当前选择的比例。
 * 原站有 72 条预设把比例写死在提示词里，而示例图可能被裁过；
 * 不改写的话，选 1:1 生成、提示词仍写着 4:3，出图会跑偏。
 * 引擎不支持的 4:5 / 9:13 也会一并换成最接近的可选比例。
 */
export function alignRatio(text: string, ratio: string): string {
  if (!text || !ratio || !RATIO_LABEL[ratio]) return text
  return text.replace(ratioPattern, ratio)
}

/**
 * 把 `{变量}` 替换成用户填的值；空值保持原样，让用户一眼看到还没填。
 * 中英文按槽位对应：第 N 个槽位的值同时用于两边。
 */
export function applyVars(
  preset: Preset,
  values: Record<string, string>,
  lang: 'zh' | 'en' = 'zh'
): { text: string; missing: string[] } {
  const text = lang === 'en' ? preset.promptEn || preset.prompt : preset.prompt
  const slots = presetSlots(preset)
  const slotValue = (index: number) => {
    const slot = slots[index]
    if (!slot) return ''
    return values[slot.key] ?? values[slot.zh] ?? values[slot.en] ?? ''
  }
  const byName = new Map<string, number>()
  slots.forEach((slot, index) => {
    if (slot.zh) byName.set(slot.zh, index)
    if (slot.en) byName.set(slot.en, index)
  })
  const missing = new Set<string>()
  const output = (text || '').replace(pattern, (raw, name: string) => {
    const index = byName.get(name.trim())
    const value = index === undefined ? values[name] ?? '' : slotValue(index)
    if (!value.trim()) {
      missing.add(name)
      return raw
    }
    return value
  })
  return { text: output, missing: [...missing] }
}

export interface PresetFilter {
  cat: string
  favorite: boolean
  recent: boolean
  model: string
  query: string
}

function score(preset: Preset, tokens: string[]): number {
  if (!tokens.length) return 1
  const title = preset.title.toLowerCase()
  const titleEn = (preset.titleEn || '').toLowerCase()
  const desc = `${preset.desc || ''} ${preset.descEn || ''}`.toLowerCase()
  const prompt = `${preset.prompt || ''} ${preset.promptEn || ''}`.toLowerCase()
  const vars = `${preset.vars || ''} ${preset.varsEn || ''}`.toLowerCase()
  let total = 0
  for (const token of tokens) {
    let hit = 0
    if (title === token) hit += 20
    if (title.includes(token)) hit += 10
    if (titleEn.includes(token)) hit += 7
    if (vars.includes(token)) hit += 5
    if (desc.includes(token)) hit += 4
    if (prompt.includes(token)) hit += 2
    if (!hit) return 0
    total += hit
  }
  return total
}

export function filterPresets(
  presets: Preset[],
  filter: PresetFilter,
  recentIds: string[]
): Preset[] {
  const tokens = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const recentRank = new Map(recentIds.map((id, index) => [id, index]))
  const hits: { preset: Preset; score: number; order: number }[] = []
  presets.forEach((preset, index) => {
    if (filter.cat !== 'all' && preset.cat !== filter.cat) return
    if (filter.favorite && !preset.favorite) return
    if (filter.recent && !recentRank.has(preset.id)) return
    if (filter.model !== 'all' && preset.model !== filter.model) return
    const value = score(preset, tokens)
    if (!value) return
    // 搜过之后按分数排；没搜的时候收藏、最近使用优先，其余保持原站顺序。
    const order = filter.favorite
      ? index
      : filter.recent
        ? (recentRank.get(preset.id) ?? 0)
        : tokens.length
          ? index
          : (preset.favorite ? -2 : 0) + (recentRank.has(preset.id) ? -1 : 0) + index / 1000
    hits.push({ preset, score: value, order })
  })
  hits.sort((a, b) => b.score - a.score || a.order - b.order)
  return hits.map((item) => item.preset)
}

export const ratioOf = (ratio: string) => {
  const [w, h] = ratio.split(':').map(Number)
  return w && h ? w / h : 1
}

export const RATIO_LABEL: Record<string, string> = {
  '1:1': '方形',
  '4:3': '横向',
  '3:4': '竖向',
  '16:9': '宽屏',
  '9:16': '长屏',
  '3:2': '宽幅',
  '2:3': '竖幅',
}
