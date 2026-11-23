import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const native = (window as any).huihua as any

function subscribe(event: string, callback: (payload: any) => void) {
  let unlisten: (() => void) | undefined
  let disposed = false
  void listen(event, (event) => callback(event.payload)).then((fn) => {
    if (disposed) fn()
    else unlisten = fn
  })
  return () => {
    disposed = true
    if (unlisten) unlisten()
  }
}

const tauriBridge = {
  app: {
    info: () => invoke('app_info'),
    openDataDir: () => invoke('app_open_data_dir'),
    openExternal: (url: string) => invoke('app_open_external', { url }),
    showItem: (path: string) => invoke('app_show_item', { path }),
    setBusy: (busy: boolean) => invoke('app_set_busy', { busy }),
    hideToTray: () => invoke('app_hide_to_tray'),
    quit: () => invoke('app_quit'),
    onCloseRequested: (callback: (payload: any) => void) => subscribe('app:close-requested', callback),
  },
  config: {
    get: () => invoke('config_get'),
    update: (patch: any) => invoke('config_update', { patch }),
    reset: () => invoke('config_reset'),
    test: (args: { provider: string; key?: string; baseUrl?: string }) =>
      invoke('config_test', {
        provider: args.provider,
        key: args.key || null,
        baseUrl: args.baseUrl || null,
      }),
  },
  chat: {
    start: (args: { requestId: string; body: any }) =>
      invoke('chat_start', { requestId: args.requestId, body: args.body }),
    abort: (requestId: string) => invoke('chat_abort', { requestId }),
    title: (messages: any[]) => invoke('chat_title', { messages }),
    upload: (args: { name: string; mime: string; buffer: Uint8Array; purpose?: string }) =>
      invoke('chat_upload', {
        name: args.name,
        mime: args.mime,
        buffer: Array.from(args.buffer),
        purpose: args.purpose || null,
      }),
    onEvent: (callback: (payload: any) => void) => subscribe('chat:event', callback),
  },
  workshop: {
    start: (args: { requestId: string; body: any; stage?: 'analysis' | 'spec' | 'compile' }) =>
      invoke('workshop_start', { requestId: args.requestId, body: args.body, stage: args.stage }),
    abort: (requestId: string) => invoke('workshop_abort', { requestId }),
    onEvent: (callback: (payload: any) => void) => subscribe('workshop:event', callback),
  },
  models: {
    catalog: () => invoke('models_catalog'),
    all: () => invoke('models_all'),
    probe: (args: { provider: string; key?: string; baseUrl?: string }) =>
      invoke('models_probe', {
        provider: args.provider,
        key: args.key || null,
        baseUrl: args.baseUrl || null,
      }),
  },
  planner: {
    plan: (input: any) =>
      invoke('planner_plan', {
        input: { ...input, allowFallback: input.allowFallback !== false },
      }),
  },
  generate: {
    start: (args: { requestId: string; plan: any; refs: string[]; sessionId: string }) =>
      invoke('generate_start', {
        requestId: args.requestId,
        plan: args.plan,
        refs: args.refs,
        sessionId: args.sessionId,
      }),
    abort: (requestId: string) => invoke('generate_abort', { requestId }),
    onEvent: (callback: (payload: any) => void) => subscribe('generate:event', callback),
  },
  styles: {
    list: () => invoke('styles_list'),
    get: (id: string) => invoke('styles_get', { id }),
    save: (input: any) => invoke('styles_save', { input }),
    remove: (id: string) => invoke('styles_delete', { id }),
  },
  presets: {
    catalog: () => invoke('presets_catalog'),
    favorite: (id: string, on: boolean) => invoke('presets_favorite', { id, on }),
    use: (id: string) => invoke('presets_use', { id }),
    install: (args: {
      id: string
      provider: string
      model: string
      ratio: string
      resolution: string
      prompt?: string
      count?: number
    }) =>
      invoke('presets_install', {
        id: args.id,
        provider: args.provider,
        model: args.model,
        ratio: args.ratio,
        resolution: args.resolution,
        prompt: args.prompt || null,
        count: args.count ?? null,
      }),
    importLibrary: () => invoke('presets_import'),
    removeUser: () => invoke('presets_remove_user'),
    adapt: (args: {
      provider: string
      model: string
      prompt: string
      title?: string
      originalModel?: string
    }) =>
      invoke('presets_adapt', {
        provider: args.provider,
        model: args.model,
        prompt: args.prompt,
        title: args.title || null,
        originalModel: args.originalModel || null,
      }),
  },
  gallery: {
    list: () => invoke('gallery_list'),
    remove: (id: string) => invoke('gallery_remove', { id }),
    export: (id: string) => invoke('gallery_export', { id }),
    exportAs: (id: string) => invoke('gallery_export_as', { id }),
    reveal: (id: string) => invoke('gallery_reveal', { id }),
    preview: (id: string, thumb = true) => invoke('gallery_preview', { id, thumb }),
    trash: () => invoke('gallery_trash'),
    restore: (id: string) => invoke('gallery_restore', { id }),
    purge: (id: string) => invoke('gallery_purge', { id }),
    emptyTrash: () => invoke('gallery_empty_trash'),
  },
  file: {
    saveText: (name: string, content: string) => invoke('save_text_file', { name, content }),
  },
}

export const bridge: any = native || tauriBridge

export const uid = (prefix = '') =>
  `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const now = () => new Date().toISOString()

export const formatTime = (iso: string) => {
  try {
    const date = new Date(iso)
    const today = new Date()
    const sameDay =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    return sameDay
      ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}

export const formatBytes = (size: number) => {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export const isImageFile = (file: File) =>
  file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)

export const ACCEPT_EXTS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.css', '.java', '.go', '.rs', '.c', '.cpp', '.h',
  '.rtf', '.epub', '.log', '.yaml', '.yml', '.toml', '.ini',
]

export const acceptAttr = ACCEPT_EXTS.join(',')

export const uploadPurpose = (file: File, isImage: boolean) => {
  if (isImage) return undefined
  if (/\.(pdf|docx?|pptx?)$/i.test(file.name)) return 'rich_layout_recognition'
  return 'user_data'
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })

export const fileToDataUrl = readDataUrl

export const compressImage = async (file: File, max = 2048): Promise<string> => {
  const dataUrl = await readDataUrl(file)
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return dataUrl
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.width, image.height))
      if (scale >= 1) return resolve(dataUrl)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      const context = canvas.getContext('2d')
      if (!context) return resolve(dataUrl)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const hasAlpha = file.type === 'image/png' || file.type === 'image/webp'
      resolve(canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.9))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

/**
 * Compresses an image for the vision API: shrinks the longest side and
 * re-encodes as JPEG, retrying with a smaller size / lower quality until the
 * encoded payload fits `targetBytes` (or the retry budget runs out). Alpha is
 * flattened onto white so a transparent PNG cannot blow past the budget.
 */
export const compressForVision = async (
  file: File,
  maxSide = 1280,
  targetBytes = 600_000
): Promise<string> => {
  const dataUrl = await readDataUrl(file)
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return dataUrl
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
  let side = maxSide
  let quality = 0.82
  let output = dataUrl
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, side / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return output
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    output = canvas.toDataURL('image/jpeg', quality)
    const encoded = output.slice(output.indexOf(',') + 1)
    const bytes = Math.round((encoded.length * 3) / 4)
    if (bytes <= targetBytes) return output
    side = Math.round(side * 0.8)
    quality = Math.max(0.58, quality - 0.06)
  }
  return output
}

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const titleFrom = (text: string) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return '新对话'
  return clean.length > 22 ? `${clean.slice(0, 22)}…` : clean
}
