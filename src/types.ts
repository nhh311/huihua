export type Role = 'user' | 'assistant'

export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  isImage: boolean
  dataUrl?: string
  serverId?: string
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface Plan {
  title: string
  prompt: string
  provider: string
  model: string
  ratio: string
  resolution: string
  count: number
  seed: number | null
  styleId: string | null
  notes: string
  fallback?: boolean
  recommended?: {
    provider: string
    ratio: string
    resolution: string
    count: number
  } | null
}

export interface Message {
  id: string
  role: Role
  kind?: 'text' | 'plan' | 'generation'
  content: string
  thinking?: string
  signature?: string
  attachments?: Attachment[]
  plan?: Plan
  planStatus?: 'draft' | 'running' | 'done'
  generation?: {
    status: 'running' | 'done' | 'error'
    images: GalleryItem[]
    warnings: string[]
    error?: string
    progress?: { done: number; total: number }
  }
  usage?: Usage
  error?: string
  streaming?: boolean
  stopped?: boolean
  createdAt: string
}

export interface SessionParams {
  provider: string
  model: string
  ratio: string
  resolution: string
  count: number
  seed: number | null
  search: boolean
}

export type SessionKind = 'chat' | 'workshop'
export type WorkshopStage = 'analysis' | 'spec' | 'compile'
export type WorkshopStatus = 'idle' | 'running' | 'done' | 'error' | 'interrupted'

export interface WorkshopImage {
  id: string
  name: string
  /** 小缩略图，仅用于会话历史和重开后回看 */
  thumb: string
  /** 本次运行内的完整压缩图，刷新后不再保留 */
  dataUrl?: string
}

export interface WorkshopMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: WorkshopImage[]
  streaming?: boolean
  thinking?: boolean
  error?: string
  batch?: number
  batches?: number
  stage?: WorkshopStage
}

export interface WorkshopSkill {
  kind: 'image' | 'asset'
  name: string
  description: string
  prompt: string
  spec: string
  recommended: { provider: string; ratio: string; resolution: string; count: number }
  tips: string
}

export interface WorkshopState {
  status: WorkshopStatus
  stage: WorkshopStage | null
  messages: WorkshopMessage[]
  need: string
  kind: 'image' | 'asset'
  refs: WorkshopImage[]
  spec: string
  skill: WorkshopSkill | null
  installedId: string | null
  error: string
  requestId?: string
  unread?: boolean
}

export interface Session {
  id: string
  title: string
  titleAuto?: boolean
  kind?: SessionKind
  workshop?: WorkshopState
  createdAt: string
  updatedAt: string
  messages: Message[]
  params: SessionParams
  styleId: string | null
  /** 软删除时间戳（毫秒），有值表示在「最近删除」里 */
  deletedAt?: number | null
}

export interface ModelView {
  id: string
  name: string
  desc: string
  provider: string
  resolutions: string[]
  ratios: string[]
  defaultResolution: string
  countMax: number
  refMax: number
  seed: boolean
  negative: boolean
  watermark: boolean
  edit: boolean
  builtin: boolean
  adapted: boolean
  aspectHint?: string
  enabled?: boolean
  hidden?: boolean
}

export interface ProviderView {
  id: string
  name: string
  subtitle: string
  baseUrl: string
  defaultModel: string
  hasKey: boolean
  models: ModelView[]
}

export interface ProviderConfigView {
  baseUrl: string
  hasKey: boolean
  keyHint: string
}

export interface ConfigView {
  version: number
  deepseek: { baseUrl: string; hasKey: boolean; keyHint: string }
  providers: Record<string, ProviderConfigView>
  defaults: SessionParams & { styleId: string | null; theme: string }
  models: { enabled: Record<string, string[]>; hidden: string[]; custom: any[] }
  onboarded: boolean
  dataDir: string
}

export interface GalleryItem {
  id: string
  file: string
  thumb: string | null
  width: number | null
  height: number | null
  createdAt: string
  prompt: string
  provider: string
  model: string
  ratio: string
  resolution: string
  seed: number | null
  sessionId: string
  styleId: string | null
  countIndex: number
  url: string
  thumbUrl: string
}

/** 最近删除里的作品，item 保留原索引，还原时按它写回 gallery.json */
export interface GalleryTrashItem {
  id: string
  deletedAt: string
  item: GalleryItem
  imageUrl: string
  thumbUrl: string
}

export interface Style {
  id: string
  name: string
  description: string
  /** image = 图片技能；asset = 插画素材技能；内置风格为 image */
  kind?: string | null
  prompt: string
  /** 极详细的完整规格（Markdown，12 节），工坊生成时写入 */
  spec?: string | null
  recommended: { provider: string; ratio: string; resolution: string; count: number } | null
  samples: string[]
  sampleUrls: string[]
  coverUrl: string | null
  builtin: boolean
  createdAt?: string | null
  /** 来源标记：预设库安装的风格为 `preset:<id>`，用于重复安装时覆盖而不是新增 */
  sourceId?: string | null
}

export interface PresetCategory {
  id: string
  name: string
  nameEn: string
  count: number
}

export interface Preset {
  id: string
  fileId: string
  cat: string
  title: string
  titleEn: string
  prompt: string
  promptEn: string
  /** 变量默认值，例如 { 风格: '动漫' } */
  params: Record<string, string>
  /** 中文变量名，逗号分隔 */
  vars: string
  varsEn: string
  /** 原站推荐模型：nano-banana-pro-plus / gpt-image-2 */
  model: string
  desc: string
  descEn: string
  /** 根据示例图推断的最合适比例 */
  ratio: string
  width: number
  height: number
  thumb: string
  preview: string
  /** 提示词里要求「附件中的图片」时为 true，需要用户带参考图 */
  needsReference: boolean
  favorite: boolean
  usedAt: string | null
}

export interface PresetCatalog {
  available: boolean
  error: string | null
  root: string
  /** builtin = 安装包内置；user = 用户导入；env = 开发时指向的目录 */
  origin: 'builtin' | 'user' | 'env' | string
  /** 用户素材库目录，导入成功后就在这个位置 */
  userRoot: string
  source: string
  scrapedAt: string
  license: string
  count: number
  categories: PresetCategory[]
  presets: Preset[]
  favorites: string[]
  recent: string[]
}

/** 导入素材库的结果 */
export interface PresetImportResult {
  count: number
  images: number
  missing: number
  catalog: PresetCatalog
}

/** 从预设库带进对话的草稿 */
export interface PresetDraft {
  nonce: number
  sessionId: string
  text: string
  provider: string
  model: string
  ratio: string
  resolution: string
  count: number
}

export interface AppInfo {
  version: string
  electron: string
  platform: string
  arch: string
  dataDir: string
}

declare global {
  interface Window {
    huihua: any
  }
}

export {}
