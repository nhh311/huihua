import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Download, FolderOpen, ImagePlus, Loader2, Menu, Sparkles, Trash2, X } from 'lucide-react'
import { useActiveSession, useApp } from './store'
import { Sidebar, type AppView } from './components/Sidebar'
import { Chat } from './components/Chat'
import { Composer, type ComposerHandle } from './components/Composer'
import { Settings } from './components/Settings'
import { Gallery } from './components/Gallery'
import { Presets } from './components/Presets'
import { Workshop } from './components/Workshop'
import { Onboarding } from './components/Onboarding'
import { SafeImage } from './components/SafeImage'
import { Modal } from './components/ui'
import ExitGuard from './components/ExitGuard'
import { bridge, formatTime, now, titleFrom, uid } from './lib/bridge'
import { baseName, exportImage, showInFolder } from './lib/export'
import { setBusy } from './lib/busy'
import type { Attachment, GalleryItem, Message, Plan, Preset, PresetDraft } from './types'

const SYSTEM_PROMPT = `你是「绘话」的对话助手。你正在和用户讨论一张要生成的图片，负责把画面、构图、光线、风格和参考图说清楚。用户会先点「整理文案」把对话整理成生图文案，再点「开始生成」才真正出图；你不要声称你已经生成了图片，也不要把「整理文案」说成已经出图。
回答用中文，简洁、具体、可执行；需要时可以先反问一两个关键问题。用户上传参考图时，先理解图片里值得保留和需要改变的部分。你可以在需要时联网搜索，但不要编造事实。`

type ChatTarget = { requestId: string; sessionId: string; messageId: string }
type GenTarget = { requestId: string; sessionId: string; messageId: string }

export default function App() {
  const ready = useApp((s) => s.ready)
  const error = useApp((s) => s.error)
  const config = useApp((s) => s.config)
  const init = useApp((s) => s.init)
  const newSession = useApp((s) => s.newSession)
  const selectSession = useApp((s) => s.selectSession)
  const newWorkshopSession = useApp((s) => s.newWorkshopSession)
  const sessions = useApp((s) => s.sessions)
  const activeId = useApp((s) => s.activeId)
  const toast = useApp((s) => s.toast)
  const clearToast = useApp((s) => s.clearToast)

  const session = useActiveSession()
  const catalog = useApp((s) => s.catalog)

  const [view, setView] = useState<AppView>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null)
  const [lightboxExport, setLightboxExport] = useState<string | null>(null)
  const [lightboxDelete, setLightboxDelete] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [genBusy, setGenBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [presetDraft, setPresetDraft] = useState<PresetDraft | null>(null)

  useEffect(() => {
    setBusy('chat', chatBusy || genBusy || planBusy)
  }, [chatBusy, genBusy, planBusy])

  useEffect(() => {
    if (!sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  useEffect(() => {
    if (!session) return
    if (session.kind === 'workshop' && view === 'chat') setView('workshop')
    if (session.kind !== 'workshop' && view === 'workshop') setView('chat')
  }, [session?.id, session?.kind, view])
  const composerRef = useRef<ComposerHandle>(null)
  const chatRef = useRef<ChatTarget | null>(null)
  const genRef = useRef<GenTarget | null>(null)
  const dragDepth = useRef(0)
  const pendingFiles = useRef<File[] | null>(null)
  const titled = useRef<Set<string>>(new Set())

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (ready && config && !config.onboarded) setOnboarding(true)
  }, [ready, config?.onboarded])

  useEffect(() => {
    const offChat = bridge.chat.onEvent((event: any) => {
      const target = chatRef.current
      if (!target || event.requestId !== target.requestId) return
      const state = useApp.getState()
      const current = state.sessions.find((item) => item.id === target.sessionId)
      const message = current?.messages.find((item) => item.id === target.messageId)
      if (!message) {
        if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') {
          chatRef.current = null
          setChatBusy(false)
        }
        return
      }

      if (event.type === 'start') {
        state.patchMessage(target.sessionId, target.messageId, { streaming: true })
        return
      }
      if (event.type === 'text') {
        state.patchMessage(target.sessionId, target.messageId, {
          content: `${message.content || ''}${event.text || ''}`,
          streaming: true,
        })
        return
      }
      if (event.type === 'thinking') {
        state.patchMessage(target.sessionId, target.messageId, {
          thinking: `${message.thinking || ''}${event.text || ''}`,
          streaming: true,
        })
        return
      }
      if (event.type === 'signature') {
        state.patchMessage(target.sessionId, target.messageId, {
          signature: `${message.signature || ''}${event.signature || ''}`,
        })
        return
      }
      if (event.type === 'usage') {
        state.patchMessage(target.sessionId, target.messageId, { usage: event.usage })
        return
      }
      if (event.type === 'done') {
        const empty = !message.content && !message.thinking
        state.patchMessage(target.sessionId, target.messageId, {
          streaming: false,
          ...(empty ? { error: '没有收到回复，请重试' } : {}),
        })
        chatRef.current = null
        setChatBusy(false)
        if (!empty) void maybeTitle(target.sessionId)
        return
      }
      if (event.type === 'error') {
        state.patchMessage(target.sessionId, target.messageId, {
          streaming: false,
          error: event.message || '对话失败',
        })
        chatRef.current = null
        setChatBusy(false)
        return
      }
      if (event.type === 'aborted') {
        state.patchMessage(target.sessionId, target.messageId, {
          streaming: false,
          stopped: true,
        })
        chatRef.current = null
        setChatBusy(false)
      }
    })

    const offGen = bridge.generate.onEvent((event: any) => {
      const target = genRef.current
      if (!target || event.requestId !== target.requestId) return
      const state = useApp.getState()
      const current = state.sessions.find((item) => item.id === target.sessionId)
      const message = current?.messages.find((item) => item.id === target.messageId)
      if (!message) {
        if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') {
          genRef.current = null
          setGenBusy(false)
        }
        return
      }
      const generation = message.generation

      if (event.type === 'image' && event.item) {
        const images = [...(generation?.images || []), event.item]
        state.patchGeneration(target.sessionId, target.messageId, {
          images,
          progress: { done: images.length, total: generation?.progress?.total || images.length },
        })
        return
      }
      if (event.type === 'progress') {
        state.patchGeneration(target.sessionId, target.messageId, {
          progress: { done: event.done, total: event.total },
        })
        return
      }
      if (event.type === 'warning') {
        state.patchGeneration(target.sessionId, target.messageId, {
          warnings: [...(generation?.warnings || []), event.message],
        })
        return
      }
      if (event.type === 'done') {
        state.patchGeneration(target.sessionId, target.messageId, {
          status: 'done',
          progress: { done: event.succeeded, total: event.total },
        })
        genRef.current = null
        setGenBusy(false)
        const planMessage = current?.messages.find(
          (item) => item.kind === 'plan' && item.planStatus === 'running'
        )
        if (planMessage) state.patchMessage(target.sessionId, planMessage.id, { planStatus: 'done' })
        void state.refreshGallery()
        return
      }
      if (event.type === 'aborted') {
        state.patchGeneration(target.sessionId, target.messageId, {
          status: 'error',
          error: '已取消生成',
        })
        genRef.current = null
        setGenBusy(false)
        const planMessage = current?.messages.find(
          (item) => item.kind === 'plan' && item.planStatus === 'running'
        )
        if (planMessage) state.patchMessage(target.sessionId, planMessage.id, { planStatus: 'draft' })
        void state.refreshGallery()
        return
      }
      if (event.type === 'error') {
        state.patchGeneration(target.sessionId, target.messageId, {
          status: 'error',
          error: event.message || '生成失败',
        })
        genRef.current = null
        setGenBusy(false)
        const planMessage = current?.messages.find(
          (item) => item.kind === 'plan' && item.planStatus === 'running'
        )
        if (planMessage) state.patchMessage(target.sessionId, planMessage.id, { planStatus: 'draft' })
        void state.refreshGallery()
      }
    })

    return () => {
      offChat()
      offGen()
    }
  }, [])

  useEffect(() => {
    setLightboxExport(null)
    setLightboxDelete(false)
  }, [lightbox?.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (lightbox) setLightbox(null)
        else if (settingsOpen) setSettingsOpen(false)
        return
      }
      const tag = (event.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !typing) {
        event.preventDefault()
        newSession()
        setView('chat')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, settingsOpen, newSession])

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types || []).includes('Files')

  const onDragEnter = (event: DragEvent) => {
    if (view === 'workshop' || !hasFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
  }

  const onDragOver = (event: DragEvent) => {
    if (view === 'workshop' || !hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: DragEvent) => {
    if (view === 'workshop' || !hasFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  const onDrop = (event: DragEvent) => {
    if (view === 'workshop' || !hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDropActive(false)
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    if (view === 'chat') {
      composerRef.current?.addFiles(files)
      return
    }
    pendingFiles.current = files
    setView('chat')
  }

  useEffect(() => {
    if (view !== 'chat') return undefined
    const files = pendingFiles.current
    if (!files?.length) return undefined
    pendingFiles.current = null
    const timer = window.setTimeout(() => composerRef.current?.addFiles(files), 80)
    return () => window.clearTimeout(timer)
  }, [view])

  const activeSession = () => {
    const state = useApp.getState()
    return state.sessions.find((item) => item.id === state.activeId) || null
  }

  const hasPlan = Boolean(session?.messages.some((message) => message.kind === 'plan'))

  // 首轮回答结束后，让 DeepSeek 把这次会话概括成一个短标题。只做一次；
  // 失败就保留按第一句话截断的标题，不打断对话。
  const maybeTitle = async (sessionId: string) => {
    const state = useApp.getState()
    const current = state.sessions.find((item) => item.id === sessionId)
    if (!current || current.titleAuto === false || titled.current.has(sessionId)) return
    const firstUser = current.messages.find((item) => item.role === 'user' && item.content.trim())
    if (!firstUser) return
    if (current.title !== titleFrom(firstUser.content)) return

    const transcript: { role: string; content: { type: string; text: string }[] }[] = []
    for (const item of current.messages.slice(0, 8)) {
      if (item.kind === 'generation') continue
      if (item.kind === 'plan') {
        const text = item.plan ? `${item.plan.title}。${item.plan.prompt}` : ''
        if (text.trim()) {
          transcript.push({ role: 'assistant', content: [{ type: 'text', text: text.slice(0, 800) }] })
        }
        continue
      }
      if (!item.content.trim()) continue
      transcript.push({
        role: item.role,
        content: [{ type: 'text', text: item.content.slice(0, 1200) }],
      })
    }
    if (transcript.length < 2 || !transcript.some((item) => item.role === 'assistant')) return

    titled.current.add(sessionId)
    try {
      const title = await bridge.chat.title(transcript)
      const latest = useApp.getState().sessions.find((item) => item.id === sessionId)
      if (!latest || latest.titleAuto === false) return
      useApp.getState().updateSession(sessionId, (item) => ({ ...item, title, titleAuto: false }))
    } catch {
      titled.current.delete(sessionId)
    }
  }

  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    const state = useApp.getState()
    const current = activeSession()
    if (!current) return false
    if (!state.config?.deepseek.hasKey) {
      state.toastMessage('先配置 DeepSeek API Key', 'error')
      setSettingsOpen(true)
      return false
    }
    if (chatBusy || genBusy || planBusy) {
      state.toastMessage('上一步还在进行中', 'info')
      return false
    }

    const userMessage: Message = {
      id: uid('m-'),
      role: 'user',
      content: text,
      attachments,
      createdAt: now(),
    }
    state.appendMessage(current.id, userMessage)

    const withUser = useApp.getState().sessions.find((item) => item.id === current.id)
    if (!withUser) return false
    const apiMessages = buildApiMessages(withUser.messages)
    if (!apiMessages.length) {
      state.toastMessage('消息是空的', 'info')
      return false
    }

    const assistant: Message = {
      id: uid('m-'),
      role: 'assistant',
      content: '',
      thinking: '',
      streaming: true,
      createdAt: now(),
    }
    state.appendMessage(current.id, assistant)

    const requestId = uid('chat-')
    chatRef.current = { requestId, sessionId: current.id, messageId: assistant.id }
    setChatBusy(true)
    // 预设草稿是一次性的：已经发出去就清掉，避免切视图/切会话后又把旧文字塞回输入框。
    setPresetDraft(null)

    const tools: any[] = [{ type: 'deepseek_read_url', name: 'deepseek_read_url' }]
    if (current.params.search) tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })

    try {
      await bridge.chat.start({
        requestId,
        body: {
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
          safety_check: { level: 'high' },
          tools,
        },
      })
    } catch (err) {
      state.patchMessage(current.id, assistant.id, {
        streaming: false,
        error: err instanceof Error ? err.message : String(err),
      })
      chatRef.current = null
      setChatBusy(false)
      return true
    }
    return true
  }

  const plan = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    const state = useApp.getState()
    const current = activeSession()
    if (!current) return false
    if (!state.config?.deepseek.hasKey) {
      state.toastMessage('先配置 DeepSeek API Key', 'error')
      setSettingsOpen(true)
      return false
    }
    if (chatBusy || genBusy || planBusy) {
      state.toastMessage('等当前任务完成再整理文案', 'info')
      return false
    }
    if (text.trim() || attachments.length) {
      state.appendMessage(current.id, {
        id: uid('m-'),
        role: 'user',
        content: text,
        attachments,
        createdAt: now(),
      })
    }

    const afterUser = useApp.getState().sessions.find((item) => item.id === current.id)
    if (!afterUser) return false
    const history = afterUser.messages
    const placeholder: Message = {
      id: uid('m-'),
      role: 'assistant',
      content: '',
      thinking: '正在把对话整理成生图文案…',
      streaming: true,
      createdAt: now(),
    }
    state.appendMessage(current.id, placeholder)
    setPlanBusy(true)
    setPresetDraft(null)
    try {
      const result = await bridge.planner.plan({
        messages: history,
        params: afterUser.params,
        styleId: afterUser.styleId,
      })
      const planMessage: Message = {
        id: uid('m-'),
        role: 'assistant',
        kind: 'plan',
        content: '',
        plan: result.plan as Plan,
        planStatus: 'draft',
        createdAt: now(),
      }
      state.updateSession(current.id, (sessionItem) => ({
        ...sessionItem,
        messages: [...sessionItem.messages.filter((item) => item.id !== placeholder.id), planMessage],
      }))
      void maybeTitle(current.id)
      return true
    } catch (err) {
      state.patchMessage(current.id, placeholder.id, {
        streaming: false,
        thinking: '',
        error: err instanceof Error ? err.message : String(err),
      })
      state.toastMessage('方案整理失败，可以重试', 'error')
      return false
    } finally {
      setPlanBusy(false)
    }
  }

  const replan = async (messageId: string): Promise<void> => {
    const state = useApp.getState()
    const current = activeSession()
    if (!current || planBusy || chatBusy || genBusy) return
    const index = current.messages.findIndex((item) => item.id === messageId)
    if (index < 0) return
    const history = current.messages.slice(0, index)
    state.patchMessage(current.id, messageId, { planStatus: 'running' })
    setPlanBusy(true)
    try {
      const result = await bridge.planner.plan({
        messages: history,
        params: current.params,
        styleId: current.styleId,
      })
      state.patchMessage(current.id, messageId, {
        plan: result.plan as Plan,
        planStatus: 'draft',
      })
    } catch (err) {
      state.patchMessage(current.id, messageId, { planStatus: 'draft' })
      state.toastMessage(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setPlanBusy(false)
    }
  }

  const startPlan = async (messageId: string): Promise<void> => {
    const state = useApp.getState()
    const current = activeSession()
    if (!current) return
    const planMessage = current.messages.find((item) => item.id === messageId && item.kind === 'plan')
    const targetPlan = planMessage?.plan
    if (!targetPlan) return
    if (chatBusy || genBusy || planBusy) {
      state.toastMessage('等当前任务完成再生成', 'info')
      return
    }
    if (!targetPlan.prompt.trim()) {
      state.toastMessage('方案还是空的', 'info')
      return
    }
    const providerConfig = state.config?.providers?.[targetPlan.provider]
    if (!providerConfig?.hasKey) {
      const providerName = catalog.find((item) => item.id === targetPlan.provider)?.name || targetPlan.provider
      state.toastMessage(`还没有配置 ${providerName} 的 Key`, 'error')
      setSettingsOpen(true)
      return
    }

    const model = catalog
      .find((item) => item.id === targetPlan.provider)
      ?.models.find((item) => item.id === targetPlan.model)
    const refs: string[] = []
    for (const item of current.messages) {
      for (const attachment of item.attachments || []) {
        if (attachment.isImage && attachment.dataUrl) refs.push(attachment.dataUrl)
      }
    }
    const limitedRefs = refs.slice(-(model?.refMax || 5))
    const total = Math.min(4, Math.max(1, Number(targetPlan.count) || 1))

    const generationMessage: Message = {
      id: uid('m-'),
      role: 'assistant',
      kind: 'generation',
      content: '',
      plan: targetPlan,
      generation: {
        status: 'running',
        images: [],
        warnings: [],
        progress: { done: 0, total },
      },
      createdAt: now(),
    }
    state.appendMessage(current.id, generationMessage)
    state.patchMessage(current.id, messageId, { planStatus: 'running' })

    const requestId = uid('gen-')
    genRef.current = { requestId, sessionId: current.id, messageId: generationMessage.id }
    setGenBusy(true)
    try {
      await bridge.generate.start({
        requestId,
        plan: targetPlan,
        refs: limitedRefs,
        sessionId: current.id,
      })
    } catch (err) {
      state.patchGeneration(current.id, generationMessage.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
      state.patchMessage(current.id, messageId, { planStatus: 'draft' })
      genRef.current = null
      setGenBusy(false)
    }
  }

  const startLatest = () => {
    const current = activeSession()
    if (!current) return
    const plans = current.messages.filter((item) => item.kind === 'plan' && item.plan)
    const last = plans[plans.length - 1]
    if (!last) {
      useApp.getState().toastMessage('先点「整理文案」整理文案', 'info')
      return
    }
    void startPlan(last.id)
  }

  const stop = () => {
    const state = useApp.getState()
    if (chatRef.current) {
      const target = chatRef.current
      void bridge.chat.abort(target.requestId)
      state.patchMessage(target.sessionId, target.messageId, { streaming: false, stopped: true })
      chatRef.current = null
      setChatBusy(false)
    }
    if (genRef.current) {
      const target = genRef.current
      void bridge.generate.abort(target.requestId)
      state.patchGeneration(target.sessionId, target.messageId, {
        status: 'error',
        error: '已取消生成',
      })
      const current = state.sessions.find((item) => item.id === target.sessionId)
      const planMessage = current?.messages.find(
        (item) => item.kind === 'plan' && item.planStatus === 'running'
      )
      if (planMessage) state.patchMessage(target.sessionId, planMessage.id, { planStatus: 'draft' })
      genRef.current = null
      setGenBusy(false)
    }
  }

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <Sparkles size={22} />
        </div>
        <strong>绘话</strong>
        <span>正在打开工作台…</span>
        <Loader2 size={16} className="spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="boot">
        <div className="boot-mark boot-error">
          <X size={22} />
        </div>
        <strong>启动失败</strong>
        <span>{error}</span>
        <button className="button button-primary" onClick={() => window.location.reload()}>
          重试
        </button>
      </div>
    )
  }

  const goChat = () => {
    const current = sessions.find((item) => item.id === activeId)
    if (current?.kind !== 'workshop') {
      setView('chat')
      return
    }
    const chat = sessions.find((item) => item.kind !== 'workshop')
    if (chat) {
      selectSession(chat.id)
    } else {
      newSession()
    }
    setView('chat')
  }

  /**
   * 预设库的「在对话里使用 / 直接生成」。
   * 一定落进普通对话：如果当前停在工坊会话（或者根本没会话），先找一条普通对话，
   * 没有就新建一条。直接把预设塞进工坊会把技能会话和生图对话混在一起。
   */
  const applyPreset = (payload: {
    preset: Preset
    prompt: string
    provider: string
    model: string
    ratio: string
    resolution: string
    count: number
    mode: 'chat' | 'generate'
  }) => {
    const state = useApp.getState()
    const providerView = state.catalog.find((item) => item.id === payload.provider)
    const modelView = providerView?.models.find((item) => item.id === payload.model)
    if (!providerView?.hasKey) {
      state.toastMessage(`${providerView?.name || payload.provider} 还没有填 Key`, 'error')
      setSettingsOpen(true)
      return
    }

    const chats = state.sessions.filter((item) => (item.kind || 'chat') === 'chat')
    const current = state.sessions.find((item) => item.id === state.activeId)
    const currentChat = current && (current.kind || 'chat') === 'chat' ? current : null

    // 「在对话里使用」必须落在一条全新的空白对话里：带着历史的会话绝不复用。
    // 已经空白的会话可以复用，避免连点几次留下多条空会话。
    if (payload.mode === 'chat' || !modelView) {
      const blank =
        (currentChat && !currentChat.messages.length && currentChat) ||
        chats.find((item) => !item.messages.length)
      let targetId = ''
      if (blank) {
        state.selectSession(blank.id)
        targetId = blank.id
      } else {
        targetId = state.newSession(true) || ''
      }
      if (!targetId) return
      setPresetDraft({
        nonce: Date.now() + Math.random(),
        sessionId: targetId,
        text: payload.prompt,
        provider: payload.provider,
        model: payload.model,
        ratio: payload.ratio,
        resolution: payload.resolution,
        count: payload.count,
      })
      setView('chat')
      state.toastMessage(`已带入「${payload.preset.title}」，可以改完直接发送`, 'success')
      return
    }

    // 「直接生成」把方案卡放进普通对话；当前不是普通对话就找最近一条，没有才新建。
    let targetId = currentChat?.id || ''
    if (!targetId) {
      targetId = chats[0]?.id || state.newSession(true) || ''
      if (targetId) state.selectSession(targetId)
    }
    if (!targetId) return

    const plan: Plan = {
      title: payload.preset.title,
      prompt: payload.prompt,
      provider: payload.provider,
      model: payload.model,
      ratio: payload.ratio,
      resolution: payload.resolution,
      count: payload.count,
      seed: null,
      styleId: null,
      notes: `预设库 · ${payload.preset.title}`,
    }
    const message: Message = {
      id: uid('m-'),
      role: 'assistant',
      kind: 'plan',
      content: '',
      plan,
      planStatus: 'draft',
      createdAt: now(),
    }
    useApp.getState().appendMessage(targetId, message)
    setView('chat')
    window.setTimeout(() => void startPlan(message.id), 30)
  }

  const openPresetSettings = () => setSettingsOpen(true)

  return (
    <div className={`app${sidebarOpen ? ' sidebar-open' : ''}`}>
      <div className="mobile-topbar">
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-label="打开导航"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={19} />
        </button>
        <strong>绘话</strong>
      </div>
      {sidebarOpen ? (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />
      ) : null}
      <Sidebar
        view={view}
        onView={(next) => {
          setView(next)
          setSidebarOpen(false)
        }}
        onNewWorkshop={() => {
          newWorkshopSession()
          setView('workshop')
          setSidebarOpen(false)
        }}
        onOpenSettings={() => {
          setSettingsOpen(true)
          setSidebarOpen(false)
        }}
      />
      <main
        className={`main${dropActive ? ' is-dropping' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {view === 'gallery' ? (
          <Gallery onPreview={setLightbox} />
        ) : view === 'presets' ? (
          <Presets onApply={applyPreset} onOpenSettings={openPresetSettings} />
        ) : view === 'workshop' ? null : (
          <>
            <Chat
              session={session}
              busy={chatBusy || genBusy || planBusy}
              onStartPlan={(id) => void startPlan(id)}
              onReplan={(id) => void replan(id)}
              onPreview={setLightbox}
              onSuggestion={(value) => composerRef.current?.insertText(value)}
            />
            <div className="composer-wrap">
              <Composer
                ref={composerRef}
                session={session}
                draft={presetDraft}
                streaming={chatBusy}
                generating={genBusy}
                planning={planBusy}
                hasPlan={hasPlan}
                onOpenSettings={() => setSettingsOpen(true)}
                onSend={send}
                onPlan={plan}
                onStartLatest={startLatest}
                onStop={stop}
              />
            </div>
          </>
        )}

        {sessions
          .filter((item) => item.kind === 'workshop')
          .map((item) => (
            <div
              className="workshop-host"
              key={item.id}
              hidden={!(view === 'workshop' && activeId === item.id)}
            >
              <Workshop sessionId={item.id} onClose={goChat} />
            </div>
          ))}

        {dropActive ? (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-card">
              <span className="drop-icon">
                <ImagePlus size={24} />
              </span>
              <strong>松手，添加到这次对话</strong>
              <span>图片会作为生图参考图，文档会作为对话上下文</span>
            </div>
          </div>
        ) : null}
      </main>

      {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}
      {onboarding ? <Onboarding onDone={() => setOnboarding(false)} /> : null}

      {lightbox ? (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="lightbox-stage">
              <SafeImage item={lightbox} thumb={false} alt={lightbox.prompt} />
            </div>
            <aside className="lightbox-info">
              <div className="lightbox-info-head">
                <div>
                  <strong>
                    {lightbox.ratio} · {lightbox.resolution}
                  </strong>
                  <span>
                    {lightbox.provider} · {formatTime(lightbox.createdAt)}
                  </span>
                </div>
                <button className="lightbox-close" onClick={() => setLightbox(null)} title="关闭">
                  <X size={18} />
                </button>
              </div>
              <div className="lightbox-actions">
                <button
                  className="button button-primary"
                  onClick={async () => {
                    try {
                      const path = await exportImage(lightbox.id)
                      if (!path) return
                      setLightboxExport(path)
                      useApp.getState().toastMessage(`已导出 ${baseName(path)}`, 'success')
                    } catch (err) {
                      useApp
                        .getState()
                        .toastMessage(err instanceof Error ? err.message : String(err), 'error')
                    }
                  }}
                >
                  <Download size={15} />
                  导出原图
                </button>
                <button
                  className="button button-quiet"
                  onClick={async () => {
                    try {
                      await bridge.gallery.reveal(lightbox.id)
                    } catch (err) {
                      useApp
                        .getState()
                        .toastMessage(err instanceof Error ? err.message : String(err), 'error')
                    }
                  }}
                >
                  <FolderOpen size={15} />
                  打开文件夹
                </button>
                <button className="button button-quiet is-danger" onClick={() => setLightboxDelete(true)}>
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
              <p className="lightbox-prompt">{lightbox.prompt}</p>
              {lightboxExport ? (
                <div className="lightbox-export">
                  <span title={lightboxExport}>已保存到 {lightboxExport}</span>
                  <button className="button button-quiet" onClick={() => void showInFolder(lightboxExport)}>
                    <FolderOpen size={14} />
                    打开所在文件夹
                  </button>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      ) : null}

      {lightbox && lightboxDelete ? (
        <Modal
          title="删除这张作品？"
          subtitle="会先放进「最近删除」，30 天内还能还原。"
          onClose={() => setLightboxDelete(false)}
          footer={
            <>
              <button className="button button-quiet" onClick={() => setLightboxDelete(false)}>
                取消
              </button>
              <button
                className="button button-danger"
                onClick={async () => {
                  const ok = await useApp.getState().removeGalleryItem(lightbox.id)
                  if (ok) {
                    setLightboxDelete(false)
                    setLightbox(null)
                    useApp.getState().toastMessage('已移到最近删除，可在作品页找回', 'success')
                  }
                }}
              >
                移到最近删除
              </button>
            </>
          }
        >
          <div className="delete-preview">
            <img src={lightbox.thumbUrl || lightbox.url} alt="" />
            <p>{lightbox.prompt}</p>
          </div>
        </Modal>
      ) : null}

      {toast ? (
        <button className={`toast toast-${toast.kind}`} role="status" aria-live="polite" onClick={clearToast}>
          {toast.text}
        </button>
      ) : null}

      <ExitGuard />
    </div>
  )
}

function buildApiMessages(messages: Message[]) {
  const items: { role: 'user' | 'assistant'; content: any[] }[] = []
  for (const message of messages) {
    if (message.kind === 'plan' || message.kind === 'generation') continue
    if (message.role === 'assistant' && !message.content.trim()) continue
    const content: any[] = []
    if (message.content.trim()) content.push({ type: 'text', text: message.content.trim() })
    for (const attachment of message.attachments || []) {
      if (attachment.status !== 'ready' || !attachment.serverId) continue
      content.push({
        type: attachment.isImage ? 'image' : 'document',
        source: { type: 'file', file_id: attachment.serverId },
      })
    }
    if (!content.length) continue
    const last = items[items.length - 1]
    if (last && last.role === message.role) {
      last.content.push(...content)
    } else {
      items.push({ role: message.role, content })
    }
  }
  while (items.length && items[0].role !== 'user') items.shift()
  return items
}
