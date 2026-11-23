import { create } from 'zustand'
import type {
  ConfigView,
  GalleryItem,
  GalleryTrashItem,
  Message,
  PresetCatalog,
  PresetImportResult,
  ProviderView,
  Session,
  SessionKind,
  SessionParams,
  Style,
  WorkshopState,
} from './types'
import { bridge, now, titleFrom, uid } from './lib/bridge'
import { deleteSession, getMeta, loadSessions, scheduleSave, setMeta } from './lib/db'

interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'success'
}

interface AppState {
  ready: boolean
  error: string | null
  config: ConfigView | null
  catalog: ProviderView[]
  styles: Style[]
  gallery: GalleryItem[]
  galleryTrash: GalleryTrashItem[]
  sessions: Session[]
  sessionTrash: Session[]
  activeId: string | null
  toast: Toast | null
  /** 预设库（453 条，随安装包分发的只读数据） */
  presets: PresetCatalog | null
  presetsBusy: boolean
  init: () => Promise<void>
  toastMessage: (text: string, kind?: Toast['kind']) => void
  clearToast: () => void
  /** force=true 时不再复用空白会话，直接开一条全新的对话（预设库「在对话里使用」用）。 */
  newSession: (force?: boolean) => string | undefined
  newWorkshopSession: () => void
  selectSession: (id: string) => void
  removeSession: (id: string) => Promise<void>
  restoreSession: (id: string) => Promise<void>
  purgeSession: (id: string) => Promise<void>
  emptySessionTrash: () => Promise<void>
  updateSession: (id: string, updater: (session: Session) => Session) => void
  syncWorkshop: (id: string, patch: Partial<WorkshopState>) => void
  appendMessage: (sessionId: string, message: Message) => void
  patchMessage: (sessionId: string, messageId: string, patch: Partial<Message>) => void
  patchGeneration: (
    sessionId: string,
    messageId: string,
    patch: Partial<NonNullable<Message['generation']>>
  ) => void
  setParams: (patch: Partial<SessionParams>) => void
  setProvider: (providerId: string) => void
  setModel: (modelId: string) => void
  setStyle: (styleId: string | null) => void
  setStyleOn: (sessionId: string, styleId: string | null) => void
  setConfig: (patch: any) => Promise<ConfigView | null>
  refreshCatalog: () => Promise<void>
  refreshStyles: () => Promise<void>
  refreshGallery: () => Promise<void>
  refreshGalleryTrash: () => Promise<void>
  removeGalleryItem: (id: string) => Promise<boolean>
  restoreGalleryItem: (id: string) => Promise<boolean>
  purgeGalleryItem: (id: string) => Promise<boolean>
  emptyGalleryTrash: () => Promise<boolean>
  saveStyle: (input: any) => Promise<Style | null>
  deleteStyle: (id: string) => Promise<boolean>
  loadPresets: () => Promise<void>
  importPresets: () => Promise<PresetImportResult | null>
  removeUserPresets: () => Promise<boolean>
  toggleFavorite: (id: string) => Promise<void>
  markPresetUsed: (id: string) => Promise<void>
  installPreset: (args: {
    id: string
    provider: string
    model: string
    ratio: string
    resolution: string
    prompt: string
    count: number
  }) => Promise<Style | null>
  adaptPrompt: (args: {
    provider: string
    model: string
    prompt: string
    title?: string
    originalModel?: string
  }) => Promise<{ prompt: string; note: string } | null>
}

const defaultParams = (config: ConfigView): SessionParams => ({
  provider: config.defaults.provider,
  model: config.defaults.model,
  ratio: config.defaults.ratio,
  resolution: config.defaults.resolution,
  count: config.defaults.count,
  seed: null,
  search: config.defaults.search,
})

const emptyWorkshop = (): WorkshopState => ({
  status: 'idle',
  stage: null,
  messages: [],
  need: '',
  kind: 'image',
  refs: [],
  spec: '',
  skill: null,
  installedId: null,
  error: '',
})

const makeSession = (config: ConfigView, kind: SessionKind = 'chat'): Session => {
  const at = now()
  return {
    id: uid('s-'),
    title: kind === 'workshop' ? '新技能' : '新对话',
    titleAuto: kind === 'chat',
    kind,
    workshop: kind === 'workshop' ? emptyWorkshop() : undefined,
    createdAt: at,
    updatedAt: at,
    messages: [],
    params: defaultParams(config),
    styleId: config.defaults.styleId || null,
  }
}

const persist = (session: Session) => scheduleSave(session)

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  config: null,
  catalog: [],
  styles: [],
  gallery: [],
  galleryTrash: [],
  sessions: [],
  sessionTrash: [],
  activeId: null,
  toast: null,
  presets: null,
  presetsBusy: false,

  init: async () => {
    try {
      const [config, styles, gallery, galleryTrash, storedSessions, storedActive] = await Promise.all([
        bridge.config.get(),
        bridge.styles.list(),
        bridge.gallery.list(),
        bridge.gallery.trash(),
        loadSessions(),
        getMeta('activeId'),
      ])
      const catalog = await bridge.models.catalog()
      const normalize = (session: Session): Session => {
        const kind: SessionKind = session.kind === 'workshop' ? 'workshop' : 'chat'
        if (kind === 'chat') return { ...session, kind, workshop: undefined }
        const workshop = { ...emptyWorkshop(), ...(session.workshop || {}) }
        if (workshop.status === 'running') {
          workshop.status = 'interrupted'
          workshop.stage = null
          workshop.requestId = undefined
        }
        return { ...session, kind, workshop }
      }
      const allSessions = storedSessions.map(normalize)
      const sessionTrash = allSessions.filter((session) => session.deletedAt)
      let sessions = allSessions.filter((session) => !session.deletedAt)
      if (!sessions.length) {
        sessions = [makeSession(config)]
        persist(sessions[0])
      }
      const activeId =
        (storedActive && sessions.some((s) => s.id === storedActive) && storedActive) ||
        sessions[0].id
      set({
        ready: true,
        config,
        styles,
        gallery,
        galleryTrash,
        sessions,
        sessionTrash,
        activeId,
        catalog,
        error: null,
      })
      // 预设库有 40MB 图 + 453 条数据，不阻塞首屏，后台再读。
      void get().loadPresets()
    } catch (error) {
      set({
        ready: true,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  toastMessage: (text, kind = 'info') => {
    if (toastTimer) clearTimeout(toastTimer)
    const toast = { id: uid('t-'), text, kind }
    set({ toast })
    toastTimer = setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null })
    }, 3200)
  },

  clearToast: () => set({ toast: null }),

  newSession: (force = false) => {
    const config = get().config
    if (!config) return undefined
    if (!force) {
      const empty = get().sessions.find(
        (session) =>
          (session.kind || 'chat') === 'chat' &&
          !session.messages.length &&
          (!session.title || session.title === '新对话')
      )
      if (empty) {
        set({ activeId: empty.id })
        setMeta('activeId', empty.id)
        return empty.id
      }
    }
    const session = makeSession(config)
    persist(session)
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeId: session.id,
    }))
    setMeta('activeId', session.id)
    return session.id
  },

  newWorkshopSession: () => {
    const config = get().config
    if (!config) return
    const blank = get().sessions.find(
      (session) => session.kind === 'workshop' && !(session.workshop?.messages.length || 0)
    )
    if (blank) {
      set({ activeId: blank.id })
      setMeta('activeId', blank.id)
      return
    }
    const session = makeSession(config, 'workshop')
    persist(session)
    set((state) => ({ sessions: [session, ...state.sessions], activeId: session.id }))
    setMeta('activeId', session.id)
  },

  selectSession: (id) => {
    if (!get().sessions.some((s) => s.id === id)) return
    set({ activeId: id })
    setMeta('activeId', id)
  },

  removeSession: async (id) => {
    const state = get()
    const target = state.sessions.find((session) => session.id === id)
    if (!target) return
    const trashed: Session = { ...target, deletedAt: Date.now() }
    scheduleSave(trashed)
    const remaining = state.sessions.filter((session) => session.id !== id)
    const sessionTrash = [trashed, ...state.sessionTrash.filter((session) => session.id !== id)]
    if (!remaining.length) {
      const config = state.config
      if (!config) {
        set({ sessions: [], sessionTrash })
        return
      }
      const session = makeSession(config)
      persist(session)
      set({ sessions: [session], sessionTrash, activeId: session.id })
      setMeta('activeId', session.id)
      return
    }
    const activeId = state.activeId === id ? remaining[0].id : state.activeId
    set({ sessions: remaining, sessionTrash, activeId })
    setMeta('activeId', activeId)
  },

  restoreSession: async (id) => {
    const state = get()
    const target = state.sessionTrash.find((session) => session.id === id)
    if (!target) return
    const restored: Session = { ...target, deletedAt: null, updatedAt: now() }
    scheduleSave(restored)
    const sessionTrash = state.sessionTrash.filter((session) => session.id !== id)
    const sessions = [restored, ...state.sessions].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt))
    )
    set({ sessions, sessionTrash, activeId: restored.id })
    setMeta('activeId', restored.id)
  },

  purgeSession: async (id) => {
    await deleteSession(id)
    set((state) => ({
      sessionTrash: state.sessionTrash.filter((session) => session.id !== id),
    }))
  },

  emptySessionTrash: async () => {
    const ids = get().sessionTrash.map((session) => session.id)
    await Promise.all(ids.map((id) => deleteSession(id)))
    set({ sessionTrash: [] })
  },

  updateSession: (id, updater) => {
    set((state) => {
      const sessions = state.sessions.map((session) => {
        if (session.id !== id) return session
        const updated = updater(session)
        const next = { ...updated, updatedAt: now() }
        persist(next)
        return next
      })
      return { sessions }
    })
  },

  syncWorkshop: (id, patch) => {
    get().updateSession(id, (session) => ({
      ...session,
      workshop: { ...(session.workshop || emptyWorkshop()), ...patch },
    }))
  },

  appendMessage: (sessionId, message) => {    get().updateSession(sessionId, (session) => ({
      ...session,
      title:
        session.title === '新对话' && message.role === 'user'
          ? titleFrom(message.content)
          : session.title,
      messages: [...session.messages, message],
    }))
  },

  patchMessage: (sessionId, messageId, patch) => {
    get().updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message
      ),
    }))
  },

  patchGeneration: (sessionId, messageId, patch) => {
    get().updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) => {
        if (message.id !== messageId) return message
        return {
          ...message,
          generation: {
            status: 'running',
            images: [],
            warnings: [],
            ...(message.generation || {}),
            ...patch,
          },
        }
      }),
    }))
  },

  setParams: (patch) => {
    const { activeId } = get()
    if (!activeId) return
    get().updateSession(activeId, (session) => ({
      ...session,
      params: { ...session.params, ...patch },
    }))
  },

  setProvider: (providerId) => {
    const { catalog, activeId } = get()
    if (!activeId) return
    const provider = catalog.find((p) => p.id === providerId)
    if (!provider) return
    const model =
      provider.models.find((m) => m.id === provider.defaultModel) || provider.models[0]
    if (!model) return
    get().updateSession(activeId, (session) => ({
      ...session,
      params: {
        ...session.params,
        provider: providerId,
        model: model.id,
        resolution: model.resolutions.includes(session.params.resolution)
          ? session.params.resolution
          : model.defaultResolution,
        ratio: model.ratios.includes(session.params.ratio) ? session.params.ratio : '1:1',
      },
    }))
  },

  setModel: (modelId) => {
    const { catalog, activeId } = get()
    if (!activeId) return
    for (const provider of catalog) {
      const model = provider.models.find((m) => m.id === modelId)
      if (!model) continue
      get().updateSession(activeId, (session) => ({
        ...session,
        params: {
          ...session.params,
          provider: provider.id,
          model: model.id,
          resolution: model.resolutions.includes(session.params.resolution)
            ? session.params.resolution
            : model.defaultResolution,
          ratio: model.ratios.includes(session.params.ratio) ? session.params.ratio : '1:1',
        },
      }))
      return
    }
  },

  setStyle: (styleId) => {
    const { activeId } = get()
    if (!activeId) return
    get().updateSession(activeId, (session) => ({ ...session, styleId }))
  },

  setStyleOn: (sessionId, styleId) => {
    get().updateSession(sessionId, (session) => ({ ...session, styleId }))
  },

  setConfig: async (patch) => {
    try {
      const config = await bridge.config.update(patch)
      const catalog = await bridge.models.catalog()
      set({ config, catalog })
      return config
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  },

  refreshCatalog: async () => {
    try {
      const catalog = await bridge.models.catalog()
      set({ catalog })
    } catch {
      // ignore
    }
  },

  refreshStyles: async () => {
    try {
      const styles = await bridge.styles.list()
      set({ styles })
    } catch {
      // ignore
    }
  },

  refreshGallery: async () => {
    try {
      const gallery = await bridge.gallery.list()
      set({ gallery })
    } catch {
      // ignore
    }
  },

  refreshGalleryTrash: async () => {
    try {
      const galleryTrash = await bridge.gallery.trash()
      set({ galleryTrash })
    } catch {
      // ignore
    }
  },

  removeGalleryItem: async (id) => {
    try {
      await bridge.gallery.remove(id)
      await Promise.all([get().refreshGallery(), get().refreshGalleryTrash()])
      return true
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },

  restoreGalleryItem: async (id) => {
    try {
      await bridge.gallery.restore(id)
      await Promise.all([get().refreshGallery(), get().refreshGalleryTrash()])
      get().toastMessage('已还原到作品库', 'success')
      return true
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },

  purgeGalleryItem: async (id) => {
    try {
      await bridge.gallery.purge(id)
      await get().refreshGalleryTrash()
      return true
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },

  emptyGalleryTrash: async () => {
    try {
      const removed = await bridge.gallery.emptyTrash()
      await get().refreshGalleryTrash()
      get().toastMessage(removed ? `已彻底删除 ${removed} 张` : '最近删除已经是空的', 'success')
      return true
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },

  saveStyle: async (input) => {
    try {
      const style = await bridge.styles.save(input)
      await get().refreshStyles()
      return style
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  },

  deleteStyle: async (id) => {
    try {
      const ok = await bridge.styles.remove(id)
      if (ok) {
        for (const session of get().sessions.filter((item) => item.styleId === id)) {
          get().setStyleOn(session.id, null)
        }
        const config = get().config
        if (config && config.defaults.styleId === id) {
          try {
            const next = await bridge.config.update({
              defaults: { ...config.defaults, styleId: null },
            })
            if (next) set({ config: next })
          } catch {
            // 默认风格清不掉不影响删除本身
          }
        }
      }
      await get().refreshStyles()
      return ok
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },

  loadPresets: async () => {
    if (get().presetsBusy) return
    set({ presetsBusy: true })
    try {
      const presets = (await bridge.presets.catalog()) as PresetCatalog
      set({ presets, presetsBusy: false })
    } catch (error) {
      set({
        presetsBusy: false,
        presets: {
          available: false,
          error: error instanceof Error ? error.message : String(error),
          root: '',
          origin: '',
          userRoot: '',
          source: '',
          scrapedAt: '',
          license: '',
          count: 0,
          categories: [],
          presets: [],
          favorites: [],
          recent: [],
        },
      })
    }
  },

  importPresets: async () => {
    try {
      const result = (await bridge.presets.importLibrary()) as PresetImportResult | null
      if (!result) return null
      set({ presets: result.catalog })
      const extra = result.missing ? `，${result.missing} 条没找到示例图` : ''
      get().toastMessage(`已导入 ${result.count} 条素材${extra}`, 'success')
      return result
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  },

  removeUserPresets: async () => {
    try {
      const presets = (await bridge.presets.removeUser()) as PresetCatalog
      set({ presets })
      get().toastMessage(presets.available ? '已移除导入的素材库，回到内置库' : '已移除素材库', 'success')
      return true
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },

  toggleFavorite: async (id) => {
    const catalog = get().presets
    if (!catalog) return
    const target = catalog.presets.find((preset) => preset.id === id)
    if (!target) return
    const on = !target.favorite
    const optimistic: PresetCatalog = {
      ...catalog,
      favorites: on ? [...catalog.favorites, id] : catalog.favorites.filter((item) => item !== id),
      presets: catalog.presets.map((preset) =>
        preset.id === id ? { ...preset, favorite: on } : preset
      ),
    }
    set({ presets: optimistic })
    try {
      await bridge.presets.favorite(id, on)
    } catch (error) {
      set({ presets: catalog })
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  markPresetUsed: async (id) => {
    const catalog = get().presets
    if (catalog) {
      set({
        presets: {
          ...catalog,
          recent: [id, ...catalog.recent.filter((item) => item !== id)].slice(0, 12),
          presets: catalog.presets.map((preset) =>
            preset.id === id ? { ...preset, usedAt: new Date().toISOString() } : preset
          ),
        },
      })
    }
    try {
      await bridge.presets.use(id)
    } catch {
      // 最近使用只是便利信息，写不进去不影响使用
    }
  },

  installPreset: async (args) => {
    try {
      const style = (await bridge.presets.install(args)) as Style
      await get().refreshStyles()
      get().toastMessage(`已装进风格「${style.name}」`, 'success')
      return style
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  },

  adaptPrompt: async (args) => {
    try {
      return (await bridge.presets.adapt(args)) as { prompt: string; note: string }
    } catch (error) {
      get().toastMessage(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  },
}))

export const useActiveSession = () =>
  useApp((state) => state.sessions.find((session) => session.id === state.activeId) || null)

export const useActiveModel = () => {
  const session = useActiveSession()
  const catalog = useApp((state) => state.catalog)
  if (!session) return null
  for (const provider of catalog) {
    const model = provider.models.find((m) => m.id === session.params.model)
    if (model) return { provider, model }
  }
  return null
}
