import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Sparkles,
  SquarePen,
  Wand2,
  X,
} from 'lucide-react'
import { useApp } from '../store'
import { bridge, compressForVision, uid } from '../lib/bridge'
import { setBusy } from '../lib/busy'
import { Markdown } from './Markdown'
import type { WorkshopState } from '../types'

type Kind = 'image' | 'asset'
type Stage = 'analysis' | 'spec' | 'compile'

type Ref = {
  id: string
  name: string
  dataUrl: string
  thumb?: string
  file?: File
  fileId?: string
}
type WorkshopMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: Ref[]
  streaming?: boolean
  thinking?: boolean
  error?: string
  batch?: number
  batches?: number
  stage?: Stage
}

type Draft = {
  kind: Kind
  name: string
  description: string
  prompt: string
  spec: string
  recommended: {
    provider: string
    ratio: string
    resolution: string
    count: number
  }
  tips: string
}

const PROVIDERS = ['seedream', 'minimax', 'hunyuan']
const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']
const RESOLUTIONS = ['1K', '1.5K', '2K', '4K']

// One DeepSeek request carries at most this many reference images and this many
// bytes of image data. Anything beyond is packed into the next request, so a
// large reference set is uploaded and sent in several batches and never blows
// up a single request.
const MAX_IMAGES_PER_REQUEST = 6
const MAX_BYTES_PER_REQUEST = 12 * 1024 * 1024

const encodedBytes = (dataUrl: string) =>
  Math.round((Math.max(0, dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)

function chunkImages(items: Ref[]) {
  const batches: Ref[][] = []
  let current: Ref[] = []
  let bytes = 0
  for (const item of items) {
    const size = encodedBytes(item.dataUrl)
    if (
      current.length &&
      (current.length >= MAX_IMAGES_PER_REQUEST || bytes + size > MAX_BYTES_PER_REQUEST)
    ) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += size
  }
  if (current.length) batches.push(current)
  return batches
}

const KINDS: { id: Kind; name: string; summary: string; tags: string }[] = [
  {
    id: 'image',
    name: '图片技能',
    summary: '一套完整的画面风格，用来生成整张图',
    tags: '光影 · 配色 · 镜头 · 材质',
  },
  {
    id: 'asset',
    name: '插画素材技能',
    summary: '一套素材生产规范，批量产出成套素材',
    tags: '线宽 · 上色 · 留白 · 一致性',
  },
]

function parseSkill(text: string, specFallback = ''): Draft | null {
  const candidates: string[] = []
  const trimmed = text.trim()
  if (trimmed) candidates.push(trimmed)
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(match[1])
  const start = text.lastIndexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const raw = JSON.parse(candidates[index])
      if (!raw || typeof raw.prompt !== 'string' || raw.prompt.trim().length < 20) continue
      const recommended = raw.recommended || {}
      return {
        kind: raw.kind === 'asset' ? 'asset' : 'image',
        name: String(raw.name || '未命名技能').slice(0, 24),
        description: String(raw.description || '').slice(0, 120),
        prompt: String(raw.prompt).slice(0, 2400),
        spec: String(raw.spec || specFallback || '').slice(0, 12000),
        recommended: {
          provider: PROVIDERS.includes(recommended.provider) ? recommended.provider : 'seedream',
          ratio: RATIOS.includes(recommended.ratio) ? recommended.ratio : '1:1',
          resolution: RESOLUTIONS.includes(recommended.resolution)
            ? recommended.resolution
            : '2K',
          count: Math.min(4, Math.max(1, Number(recommended.count) || 1)),
        },
        tips: String(raw.tips || '').slice(0, 220),
      }
    } catch {
      // 流式过程中 JSON 还不完整，跳过这一轮
    }
  }
  return null
}

const visibleText = (text: string) =>
  text
    .replace(/```(?:json)?[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

async function makeThumb(dataUrl: string): Promise<string> {
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = dataUrl
    })
    const side = 168
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl.slice(0, 20_000)
    const scale = Math.max(side / image.width, side / image.height)
    const width = image.width * scale
    const height = image.height * scale
    ctx.drawImage(image, (side - width) / 2, (side - height) / 2, width, height)
    return canvas.toDataURL('image/jpeg', 0.62)
  } catch {
    return dataUrl.slice(0, 2000)
  }
}

export function Workshop({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const saveStyle = useApp((s) => s.saveStyle)
  const setStyleOn = useApp((s) => s.setStyleOn)
  const toastMessage = useApp((s) => s.toastMessage)
  const stored = useRef(useApp.getState().sessions.find((item) => item.id === sessionId)?.workshop)
    .current

  const [kind, setKind] = useState<Kind>(stored?.kind || 'image')
  const [refs, setRefs] = useState<Ref[]>(
    (stored?.refs || []).map((item) => ({ id: item.id, name: item.name, dataUrl: item.thumb }))
  )
  const [need, setNeed] = useState(stored?.need || '')
  const [messages, setMessages] = useState<WorkshopMessage[]>(
    (stored?.messages || []).map((item) => ({
      ...item,
      streaming: false,
      thinking: false,
      images: item.images?.map((image) => ({
        id: image.id,
        name: image.name,
        dataUrl: image.dataUrl || image.thumb || '',
        thumb: image.thumb,
      })),
    }))
  )
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(stored?.skill || null)
  const [spec, setSpec] = useState(stored?.spec || '')
  const [genStage, setGenStage] = useState<'spec' | 'compile' | null>(null)
  const [genError, setGenError] = useState(stored?.status === 'error' ? stored.error : '')
  const [installing, setInstalling] = useState(false)
  const [installedId, setInstalledId] = useState<string | null>(stored?.installedId || null)
  const [dragOver, setDragOver] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const storedStatus = useApp(
    (state) => state.sessions.find((item) => item.id === sessionId)?.workshop?.status
  )

  const fileInput = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const countRef = useRef(0)
  const forceScrollRef = useRef(true)
  const stickRef = useRef(true)
  const holdRef = useRef(0)
  const apiMessages = useRef<any[]>(
    (stored?.messages || [])
      .filter((item) => item.text && item.text.trim().length > 0)
      .map((item) => ({ role: item.role, content: item.text }))
  )
  const assistantText = useRef('')
  const activeRequest = useRef<{ requestId: string; messageId: string; stage: Stage } | null>(null)
  const installedKeys = useRef<Set<string>>(new Set())
  const queue = useRef<{ images: Ref[]; text: string }[]>([])
  const batchStart = useRef(0)
  const batchTotal = useRef(0)
  const stageRef = useRef<Stage>('analysis')
  const specRef = useRef(stored?.spec || '')
  const retryRef = useRef(0)
  const continuedRef = useRef(false)
  const messagesRef = useRef<WorkshopMessage[]>(messages)
  const beginRequestRef = useRef<(stage: Stage, body: any, messageId: string) => Promise<void>>(
    async () => {}
  )
  const sendNextBatchRef = useRef<(messageId: string) => Promise<void>>(async () => {})
  const autoInstallRef = useRef<(value: Draft) => Promise<void>>(async () => {})
  const retryStageRef = useRef<() => void>(() => {})

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const sync = (patch: Partial<WorkshopState>) =>
    useApp.getState().syncWorkshop(sessionId, patch)

  const setTitle = (title: string) =>
    useApp.getState().updateSession(sessionId, (session) => ({
      ...session,
      title,
      titleAuto: false,
    }))

  const persistMessages = (list: WorkshopMessage[], extra: Partial<WorkshopState> = {}) => {
    const clean = list.map((item) => ({
      ...item,
      streaming: false,
      thinking: false,
      images: item.images?.map((image) => ({
        id: image.id,
        name: image.name,
        thumb: image.thumb || image.dataUrl || '',
        dataUrl: image.thumb || image.dataUrl || '',
      })),
    }))
    sync({ messages: clean, ...extra })
  }

  const started = messages.length > 0
  const hasAnalysis = messages.some(
    (item) => item.role === 'assistant' && visibleText(item.text).trim().length > 0
  )

  useEffect(() => {
    const off = bridge.workshop.onEvent((event: any) => {
      const target = activeRequest.current
      if (!target || event.requestId !== target.requestId) return
      const patch = (value: (item: WorkshopMessage) => WorkshopMessage) =>
        setMessages((current) => current.map((item) => (item.id === target.messageId ? value(item) : item)))

      if (event.type === 'text') {
        assistantText.current += String(event.text || '')
        patch((item) => ({ ...item, text: assistantText.current, thinking: false }))
      } else if (event.type === 'thinking') {
        patch((item) => ({ ...item, thinking: true }))
      } else if (event.type === 'error') {
        const message = String(event.message || '生成失败')
        activeRequest.current = null
        queue.current = []
        setStreaming(false)
        setUploading(false)
        patch((item) => ({ ...item, streaming: false, thinking: false, error: message }))
        if (target.stage === 'analysis') {
          setGenerating(false)
          persistMessages(messagesRef.current, { status: 'idle' })
          toastMessage(message, 'error')
          return
        }
        const retryable = /429|限流|timeout|超时|连接|network/i.test(message)
        if (retryable && retryRef.current < 1) {
          retryRef.current += 1
          toastMessage('接口限流或超时，3 秒后自动重试一次', 'info')
          window.setTimeout(() => retryStageRef.current(), 3000)
          return
        }
        setGenerating(false)
        setGenStage(null)
        setGenError(message)
        sync({ status: 'error', error: message, stage: null })
        toastMessage(message, 'error')
      } else if (event.type === 'aborted') {
        activeRequest.current = null
        queue.current = []
        setGenerating(false)
        setStreaming(false)
        setUploading(false)
        setGenStage(null)
        patch((item) => ({
          ...item,
          streaming: false,
          thinking: false,
          text: assistantText.current || '已停止',
        }))
        sync({ status: 'interrupted', stage: null })
      } else if (event.type === 'done') {
        const text = assistantText.current
        const stopReason = String(event.stop_reason || '')
        if (
          (target.stage === 'spec' || target.stage === 'compile') &&
          stopReason === 'max_tokens' &&
          !continuedRef.current
        ) {
          continuedRef.current = true
          apiMessages.current.push({ role: 'assistant', content: text })
          apiMessages.current.push({
            role: 'user',
            content: '上次输出被长度限制截断了。请紧接着断点继续写，不要重复已经写过的内容，也不要解释。',
          })
          sync({ status: 'running', stage: target.stage })
          void beginRequestRef.current(
            target.stage,
            {
              messages: textOnlyMessages(),
              max_tokens: target.stage === 'spec' ? 12000 : 4000,
            },
            target.messageId
          )
          return
        }
        activeRequest.current = null
        setUploading(false)

        if (target.stage === 'analysis') {
          apiMessages.current.push({ role: 'assistant', content: text.slice(batchStart.current) })
          const next = messagesRef.current.map((item) =>
            item.id === target.messageId
              ? { ...item, text, streaming: false, thinking: false }
              : item
          )
          patch((item) => ({ ...item, thinking: false, text, streaming: false }))
          if (queue.current.length) {
            persistMessages(next, { status: 'running', stage: 'analysis' })
            void sendNextBatchRef.current(target.messageId)
            return
          }
          setStreaming(false)
          setGenerating(false)
          batchTotal.current = 0
          persistMessages(next, { status: 'idle', stage: null })
          return
        }

        if (target.stage === 'spec') {
          const value = text.trim()
          if (!value) {
            setGenerating(false)
            setGenStage(null)
            setGenError('规格没有生成出来，再点一次「生成 Skill」。')
            sync({ status: 'error', error: '规格没有生成出来', stage: null })
            return
          }
          specRef.current = value
          setSpec(value)
          patch((item) => ({
            ...item,
            text: '12 节完整规格已生成，正在编译提示词…',
            streaming: false,
            thinking: false,
          }))
          apiMessages.current.push({ role: 'assistant', content: value })
          apiMessages.current.push({
            role: 'user',
            content: '【编译提示词】把上面的 12 节规格编译成一段可直接出图的中文提示词，按约定只输出 JSON。',
          })
          sync({ spec: value, status: 'running', stage: 'compile' })
          setGenStage('compile')
          setGenerating(true)
          const compileId = uid('wa')
          setMessages((current) => [
            ...current,
            { id: compileId, role: 'assistant', text: '', streaming: true, thinking: true, stage: 'compile' },
          ])
          assistantText.current = ''
          stageRef.current = 'compile'
          continuedRef.current = false
          void beginRequestRef.current('compile', { messages: textOnlyMessages(), max_tokens: 4000 }, compileId)
          return
        }

        const parsed = parseSkill(text, specRef.current)
        setStreaming(false)
        setGenerating(false)
        setGenStage(null)
        if (parsed) {
          patch((item) => ({
            ...item,
            text: '提示词已编译完成，正在安装技能…',
            streaming: false,
            thinking: false,
          }))
          setDraft(parsed)
          setSpec(parsed.spec || specRef.current)
          setGenError('')
          setTitle(parsed.name)
          sync({ skill: parsed, spec: parsed.spec || specRef.current, status: 'running' })
          void autoInstallRef.current(parsed)
        } else {
          const message = '提示词没生成完整，可以点「重试」再编译一次。'
          patch((item) => ({
            ...item,
            text: '提示词没生成完整。',
            streaming: false,
            thinking: false,
          }))
          setGenError(message)
          sync({ status: 'error', error: message, stage: null })
          toastMessage(message, 'error')
        }
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const handleScroll = () => {
      const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
      if (Date.now() >= holdRef.current) stickRef.current = bottom
      setAtBottom(bottom)
    }
    const onWheel = () => {
      stickRef.current = false
      holdRef.current = Date.now() + 1500
    }
    node.addEventListener('scroll', handleScroll, { passive: true })
    node.addEventListener('wheel', onWheel, { passive: true })
    node.addEventListener('touchmove', onWheel, { passive: true })
    return () => {
      node.removeEventListener('scroll', handleScroll)
      node.removeEventListener('wheel', onWheel)
      node.removeEventListener('touchmove', onWheel)
    }
  }, [started, messages.length > 0])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    countRef.current = messages.length
    if (forceScrollRef.current) {
      forceScrollRef.current = false
      stickRef.current = true
      setAtBottom(true)
      node.scrollTop = node.scrollHeight
      return
    }
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight
    if (Date.now() < holdRef.current) {
      setAtBottom(gap < 24)
      return
    }
    if (!stickRef.current) {
      setAtBottom(gap < 24)
      return
    }
    node.scrollTop = node.scrollHeight
  }, [messages, draft])

  useEffect(
    () => () => {
      const target = activeRequest.current
      if (target) void bridge.workshop.abort(target.requestId)
    },
    []
  )

  useEffect(() => {
    setBusy(`workshop:${sessionId}`, streaming || uploading || generating)
    return () => setBusy(`workshop:${sessionId}`, false)
  }, [sessionId, streaming, uploading, generating])

  useEffect(() => {
    if (!streaming) {
      setElapsed(0)
      return
    }
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [streaming])

  const latestRefs = useRef<Ref[]>([])
  useEffect(() => {
    latestRefs.current = refs
  }, [refs])

  const readFiles = async (list: FileList | File[]) => {
    const images = Array.from(list).filter((file) => file.type.startsWith('image/'))
    if (!images.length) {
      toastMessage('这里只接受图片，请拖入图片文件', 'info')
      return
    }
    const next: Ref[] = []
    for (const file of images) {
      try {
        const dataUrl = await compressForVision(file, 1280, 600_000)
        const thumb = await makeThumb(dataUrl)
        next.push({ id: uid('ref'), name: file.name, dataUrl, thumb, file })
      } catch {
        toastMessage(`${file.name} 读取失败`, 'error')
      }
    }
    if (next.length) {
      setRefs((current) => [...current, ...next])
      sync({
        refs: [...refs, ...next].map((item) => ({
          id: item.id,
          name: item.name,
          thumb: item.thumb || '',
        })),
      })
    }
  }

  const removeRef = (id: string) => {
    const next = refs.filter((item) => item.id !== id)
    setRefs(next)
    sync({ refs: next.map((item) => ({ id: item.id, name: item.name, thumb: item.thumb || '' })) })
  }

  const uploadImages = async (items: Ref[]) => {
    const pending = items.filter((item) => !item.fileId && item.file)
    if (!pending.length) return items
    const uploaded = new Map<string, string>()
    for (const item of pending) {
      const file = item.file as File
      const buffer = new Uint8Array(await file.arrayBuffer())
      const result = await bridge.chat.upload({
        name: file.name,
        mime: file.type || 'image/png',
        buffer,
      })
      uploaded.set(item.id, result.id)
    }
    setRefs((current) =>
      current.map((item) => (uploaded.has(item.id) ? { ...item, fileId: uploaded.get(item.id) } : item))
    )
    return items.map((item) => ({ ...item, fileId: uploaded.get(item.id) || item.fileId }))
  }

  const failBatch = (messageId: string, message: string) => {
    queue.current = []
    setGenerating(false)
    setStreaming(false)
    setUploading(false)
    activeRequest.current = null
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId ? { ...item, streaming: false, thinking: false, error: message } : item
      )
    )
  }

  const beginRequest = async (stage: Stage, body: any, messageId: string) => {
    const requestId = uid('ws')
    activeRequest.current = { requestId, messageId, stage }
    stageRef.current = stage
    setStreaming(true)
    try {
      await bridge.workshop.start({ requestId, body, stage })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failBatch(messageId, message)
      if (stage === 'analysis') {
        sync({ status: 'idle' })
      } else {
        setGenerating(false)
        setGenStage(null)
        setGenError(message)
        sync({ status: 'error', error: message, stage: null })
      }
    }
  }

  /**
   * Sends one fixed-size batch of reference images. Images are uploaded only
   * when their batch is about to be sent, so each request stays within the
   * image-count and byte budget defined by MAX_IMAGES_PER_REQUEST /
   * MAX_BYTES_PER_REQUEST. The next batch is triggered from the `done` handler.
   */
  const sendNextBatch = async (messageId: string) => {
    const next = queue.current.shift()
    if (!next) return
    const index = batchTotal.current - queue.current.length
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId ? { ...item, batch: index, batches: batchTotal.current } : item
      )
    )
    if (index > 1) assistantText.current = ''
    batchStart.current = 0
    setUploading(true)
    let prepared: Ref[] = []
    try {
      prepared = await uploadImages(next.images)
    } catch (error) {
      failBatch(messageId, error instanceof Error ? error.message : String(error))
      return
    }
    setUploading(false)
    const blocks: any[] = [{ type: 'text', text: next.text }]
    for (const image of prepared) {
      if (image.fileId) {
        blocks.push({ type: 'image', source: { type: 'file', file_id: image.fileId } })
      }
    }
    apiMessages.current.push({ role: 'user', content: blocks })
    await beginRequest('analysis', { messages: apiMessages.current, max_tokens: 8000 }, messageId)
  }

  const turn = async (text: string, images: Ref[], options?: { display?: string }) => {
    if (streaming || uploading || queue.current.length) return
    const base = text.trim() || '请拆解参考图，做成一个可复用的技能。'
    if (!images.length && !messages.length) {
      toastMessage('先上传一张参考图', 'info')
      return
    }
    const currentTitle = useApp.getState().sessions.find((item) => item.id === sessionId)?.title || ''
    if (!messagesRef.current.length && (!currentTitle || currentTitle === '新技能')) {
      const source = need.trim().replace(/\s+/g, ' ')
      if (source) setTitle(source.slice(0, 12))
    }
    const batches = images.length ? chunkImages(images) : [[]]
    batchTotal.current = batches.length
    batchStart.current = 0
    queue.current = batches.map((batch, index) => ({
      images: batch,
      text:
        batches.length === 1
          ? base
          : index === 0
            ? `${base}\n\n这只是第 1/${batches.length} 批参考图，先继续分析，不要输出技能。`
            : index === batches.length - 1
              ? `参考图已全部给完（第 ${index + 1}/${batches.length} 批，最后一批）。继续分析，按约定决定下一步；如果已经足够清楚，可以给出技能。`
              : `继续看第 ${index + 1}/${batches.length} 批参考图，先继续分析，不要输出技能。`,
    }))
    assistantText.current = ''
    forceScrollRef.current = true
    const messageId = uid('wa')
    const userMessage: WorkshopMessage = {
      id: uid('wu'),
      role: 'user',
      text: options?.display || base,
      images,
    }
    setMessages((current) => [
      ...current,
      userMessage,
      { id: messageId, role: 'assistant', text: '', streaming: true, batch: 0, batches: batches.length },
    ])
    setStreaming(true)
    persistMessages(
      [
        ...messagesRef.current,
        userMessage,
        { id: messageId, role: 'assistant', text: '', batch: 0, batches: batches.length },
      ],
      { status: 'running', stage: 'analysis', need, kind, refs: refs.map(({ id, name, thumb }) => ({ id, name, thumb })) }
    )
    await sendNextBatch(messageId)
  }

  const start = () => {
    if (streaming) return
    if (!refs.length) {
      toastMessage('先上传一张参考图', 'info')
      return
    }
    void turn(need, refs)
  }

  const send = () => {
    if (streaming || uploading) return
    const text = input.trim()
    if (!text) {
      toastMessage('说说想调整哪里，或补充一个细节', 'info')
      return
    }
    setInput('')
    void turn(text, refs.filter((item) => !item.fileId))
  }

  const textOnlyMessages = () =>
    apiMessages.current.map((message: any) => {
      if (typeof message.content === 'string') return message
      if (!Array.isArray(message.content)) return message
      const text = message.content
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => String(part.text || ''))
        .join('\n')
        .trim()
      return { role: message.role, content: text }
    }).filter((message: any) => typeof message.content !== 'string' || message.content.trim())

  const generateSkill = () => {
    if (streaming || uploading || generating) return
    if (!hasAnalysis) {
      toastMessage('先让它把参考图拆解完，再生成 Skill', 'info')
      return
    }
    retryRef.current = 0
    continuedRef.current = false
    setInput('')
    apiMessages.current.push({
      role: 'user',
      content:
        '【生成规格】请把上面的全部分析、讨论和我的要求汇总，按约定输出 12 节完整规格（Markdown，不要 JSON、不要代码围栏）。',
    })
    specRef.current = ''
    setSpec('')
    setDraft(null)
    setInstalledId(null)
    setGenError('')
    setGenStage('spec')
    setGenerating(true)
    const userMessage: WorkshopMessage = {
      id: uid('wu'),
      role: 'user',
      text: '按现在确认的细节生成 Skill。',
    }
    const placeholder: WorkshopMessage = {
      id: uid('wa'),
      role: 'assistant',
      text: '',
      streaming: true,
      thinking: true,
      stage: 'spec',
    }
    forceScrollRef.current = true
    setMessages((current) => [...current, userMessage, placeholder])
    sync({ status: 'running', stage: 'spec', spec: '', skill: null, installedId: null, error: '' })
    assistantText.current = ''
    void beginRequest('spec', { messages: textOnlyMessages(), max_tokens: 12000 }, placeholder.id)
  }

  const retryStage = () => {
    const stage: Stage = stageRef.current === 'compile' ? 'compile' : 'spec'
    retryRef.current = 0
    continuedRef.current = false
    setGenError('')
    setGenStage(stage)
    setGenerating(true)
    const messageId = uid('wa')
    setMessages((current) => [
      ...current,
      { id: messageId, role: 'assistant', text: '', streaming: true, thinking: true, stage },
    ])
    assistantText.current = ''
    sync({ status: 'running', stage })
    void beginRequest(
      stage,
      { messages: textOnlyMessages(), max_tokens: stage === 'spec' ? 12000 : 4000 },
      messageId
    )
  }

  const stop = () => {
    queue.current = []
    setGenerating(false)
    setGenStage(null)
    const target = activeRequest.current
    if (target) void bridge.workshop.abort(target.requestId)
  }

  const autoInstall = async (value: Draft) => {
    const key = `${value.kind}|${value.name}|${value.prompt.slice(0, 60)}`
    if (installedKeys.current.has(key)) return
    installedKeys.current.add(key)
    await install(value, key)
  }

  const install = async (value: Draft, key?: string) => {
    setInstalling(true)
    const samples = latestRefs.current.slice(0, 3).map((item) => ({ dataUrl: item.dataUrl }))
    const style = await saveStyle({
      name: value.name,
      description: value.description,
      kind: value.kind,
      prompt: value.prompt,
      spec: value.spec,
      recommended: value.recommended,
      samples,
    })
    setInstalling(false)
    if (style) {
      setInstalledId(style.id)
      sync({
        status: 'done',
        skill: value,
        spec: value.spec,
        installedId: style.id,
        unread: true,
        error: '',
      })
      toastMessage(`技能「${style.name}」已安装，输入框「风格」里可以直接用`, 'success')
    } else if (key) {
      installedKeys.current.delete(key)
    }
  }

  const useSkill = () => {
    if (!installedId) return
    const state = useApp.getState()
    state.syncWorkshop(sessionId, { unread: false })
    const chat = state.sessions.find((item) => item.kind !== 'workshop' && item.id !== sessionId)
    if (chat) {
      state.setStyleOn(chat.id, installedId)
      state.selectSession(chat.id)
    } else {
      state.newSession()
      const nextId = useApp.getState().activeId
      if (nextId) state.setStyleOn(nextId, installedId)
    }
    toastMessage('已切到这个技能，直接说要画什么就行', 'success')
    onClose()
  }

  beginRequestRef.current = beginRequest
  sendNextBatchRef.current = sendNextBatch
  autoInstallRef.current = autoInstall
  retryStageRef.current = retryStage

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    void readFiles(event.dataTransfer.files)
  }

  const kindName = KINDS.find((item) => item.id === kind)?.name || '技能'

  return (
    <section className="workshop">
      <div className="workshop-scroll" ref={scrollRef}>
        <header className="workshop-head">
          <div>
            <span className="workshop-kicker">技能工坊</span>
            <h1>把参考图拆成技能</h1>
            <p>
              上传参考图，逐项确认风格与细节。完成后会生成可复用的完整规格，并自动安装到「风格」。
            </p>
          </div>
          <button className="button button-quiet" onClick={() => onClose()} type="button">
            <ArrowLeft size={15} />
            回到对话
          </button>
        </header>

        {!started ? (
          <div className="workshop-start">
            <div className="skill-kinds">
              {KINDS.map((item) => (
                <button
                  key={item.id}
                  className={`skill-kind ${kind === item.id ? 'is-active' : ''}`}
                  onClick={() => setKind(item.id)}
                >
                  <span className="skill-kind-icon">
                    {item.id === 'image' ? <Sparkles size={18} /> : <SquarePen size={18} />}
                  </span>
                  <strong>{item.name}</strong>
                  <span>{item.summary}</span>
                  <em>{item.tags}</em>
                </button>
              ))}
            </div>

            <div
              className={`ref-drop ${dragOver ? 'is-over' : ''} ${refs.length ? 'has-items' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
            >
              {refs.map((item) => (
                <figure className="ref-item" key={item.id} onClick={(event) => event.stopPropagation()}>
                  <img src={item.dataUrl} alt={item.name} />
                  <button
                    className="ref-remove"
                    title="移除"
                    onClick={() => removeRef(item.id)}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </figure>
              ))}
              <div className="ref-add">
                <ImagePlus size={22} />
                <strong>上传参考图</strong>
                <span>点击选择或直接拖进来，可以放多张</span>
              </div>
            </div>

            <label className="workshop-need">
              <span>
                想做成什么样的技能？<em>可选</em>
              </span>
              <textarea
                value={need}
                onChange={(event) => setNeed(event.target.value)}
                placeholder={`例如：做成适合${kind === 'asset' ? '贴纸' : '小红书封面'}的感觉，颜色别太艳；或者：保留参考图的笔触，但换成暖色调。`}
                rows={3}
              />
            </label>

            <div className="analysis-plan">
              <div className="analysis-plan-head">
                <Sparkles size={14} />
                <strong>会先逐项拆解，全部确认后才生成技能</strong>
              </div>
              <div className="analysis-tags">
                {[
                  '作品判读',
                  '色彩合同',
                  '光与明度',
                  '笔触材质',
                  '构图语法',
                  '细节规则',
                  '世界观',
                  '边界禁用',
                  '新细节决策',
                  '提示词骨架',
                  '验收标准',
                ].map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>

            <button
              className="button button-primary workshop-start-button"
              disabled={!refs.length || uploading}
              onClick={start}
            >
              {uploading ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
              开始拆解
            </button>
          </div>
        ) : (
          <div className="workshop-thread">
            {storedStatus === 'interrupted' && !streaming && !generating ? (
              <p className="workshop-notice">
                上次生成被中断了。可以继续补充细节，或点右下角「生成 Skill」重新来一次。
              </p>
            ) : null}
            {messages.map((message) => {
              const hiddenStage =
                message.role === 'assistant' && (message.stage === 'spec' || message.stage === 'compile')
              const body = hiddenStage && message.streaming ? '' : visibleText(message.text)
              return (
              <div className={`wmsg wmsg-${message.role}`} key={message.id}>
                {message.role === 'assistant' ? (
                  <span className="wmsg-avatar">
                    <Sparkles size={15} />
                  </span>
                ) : null}
                <div className="wmsg-body">
                  {message.images?.length ? (
                    <div className="wmsg-images">
                      {message.images.map((image) => (
                        <img key={image.id} src={image.dataUrl} alt={image.name} />
                      ))}
                    </div>
                  ) : null}
                  {message.role === 'assistant' ? (
                    <>
                      {message.streaming && (message.batches || 0) > 1 ? (
                        <span className="wmsg-batch">
                          参考图 {message.batch || 1}/{message.batches} 批
                        </span>
                      ) : null}
                      {message.streaming && !body ? (
                        <span className="wmsg-thinking">
                          <Loader2 size={13} className="spin" />
                          {message.stage === 'spec'
                            ? `正在生成 12 节完整规格（已 ${elapsed}s）…`
                            : message.stage === 'compile'
                              ? `正在编译提示词（已 ${elapsed}s）…`
                              : generating
                                ? `正在整理完整规格（最高强度思考 · 已 ${elapsed}s）…`
                                : `正在拆解参考图（已 ${elapsed}s）…`}
                        </span>
                      ) : null}
                      {body ? <Markdown>{body}</Markdown> : null}
                      {message.streaming ? <span className="wmsg-caret" /> : null}
                      {message.error ? <p className="wmsg-error">{message.error}</p> : null}
                    </>
                  ) : (
                    <p>{message.text}</p>
                  )}
                </div>
              </div>
              )
            })}

            {generating || genError ? (
              <div className="skill-card is-running">
                <div className="skill-card-head">
                  <span className="skill-chip">{kind === 'asset' ? '插画素材' : '图片技能'}</span>
                  <strong>{genStage === 'compile' ? '正在编译提示词' : '正在生成完整规格'}</strong>
                  {genError ? (
                    <span className="skill-fail">失败</span>
                  ) : (
                    <Loader2 size={14} className="spin" />
                  )}
                </div>
                {genError ? (
                  <div className="skill-stage">
                    <p className="wmsg-error">{genError}</p>
                    <button className="button button-quiet" onClick={retryStage} type="button">
                      重试
                    </button>
                  </div>
                ) : (
                  <div className="skill-stage">
                    <span>
                      {genStage === 'compile'
                        ? '第 2/2 段 · 把 12 节规格压成提示词和推荐参数'
                        : '第 1/2 段 · 生成 12 节完整规格'}
                    </span>
                    <span>已用 {elapsed}s</span>
                    {spec && genStage === 'compile' ? (
                      <details className="skill-spec">
                        <summary>
                          规格已生成，先看看
                          <span>{spec.length} 字</span>
                        </summary>
                        <div className="skill-spec-body">
                          <Markdown>{spec}</Markdown>
                        </div>
                      </details>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {draft ? (
              <div className="skill-card">
                <div className="skill-card-head">
                  <span className="skill-chip">{draft.kind === 'asset' ? '插画素材' : '图片技能'}</span>
                  <strong>{draft.name}</strong>
                  {installedId ? (
                    <span className="skill-ok">
                      <Check size={13} />
                      已安装
                    </span>
                  ) : installing ? (
                    <span className="skill-installing">
                      <Loader2 size={13} className="spin" />
                      安装中
                    </span>
                  ) : null}
                </div>
                {draft.description ? <p className="skill-desc">{draft.description}</p> : null}
                {draft.spec && draft.spec.length < 600 ? (
                  <p className="skill-warn">规格偏短，建议再点一次「生成 Skill」补全细节。</p>
                ) : null}
                {draft.spec ? (
                  <details className="skill-spec">
                    <summary>
                      查看完整规格 · 12 节
                      <span>{draft.spec.length} 字</span>
                    </summary>
                    <div className="skill-spec-body">
                      <Markdown>{draft.spec}</Markdown>
                    </div>
                  </details>
                ) : null}
                <details className="skill-prompt">
                  <summary>查看提示词</summary>
                  <p>{draft.prompt}</p>
                </details>
                <div className="skill-meta">
                  <span>{draft.recommended.provider}</span>
                  <span>{draft.recommended.ratio}</span>
                  <span>{draft.recommended.resolution}</span>
                  <span>{draft.recommended.count} 张</span>
                </div>
                {draft.tips ? <p className="skill-tip">{draft.tips}</p> : null}
                <div className="skill-actions">
                  {installedId ? (
                    <button className="button button-primary" onClick={useSkill}>
                      <Sparkles size={15} />
                      在对话里使用
                    </button>
                  ) : (
                    <button
                      className="button button-primary"
                      disabled={installing}
                      onClick={() => void install(draft)}
                    >
                      安装技能
                    </button>
                  )}
                  <span className="skill-hint">没达到想要的效果？继续在下面说要改哪里。</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {!atBottom ? (
        <button
          className="scroll-bottom"
          type="button"
          onClick={() => {
            const node = scrollRef.current
            if (!node) return
            stickRef.current = true
            setAtBottom(true)
            node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
          }}
        >
          <ArrowDown size={14} />
          回到最新
        </button>
      ) : null}

      {started ? (
        <div className="workshop-composer">
          {refs.length ? (
            <div className="workshop-refs is-summary">
              <ImagePlus size={13} />
              <span>已带上 {refs.length} 张参考图</span>
              <button type="button" onClick={() => fileInput.current?.click()}>
                再加
              </button>
            </div>
          ) : null}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={
              generating
                ? '正在生成技能，可以先等它跑完…'
                : streaming
                  ? '正在拆解，可以等它说完再补充…'
                  : '补充或修正细节；确认后点「生成 Skill」…'
            }
          />
          <div className="workshop-composer-foot">
            <div className="workshop-composer-left">
              <button
                className="icon-button"
                type="button"
                title="再加一张参考图"
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={16} />
              </button>
              <span className="workshop-kind-tag">{kindName}</span>
            </div>
            {streaming ? (
              <div className="workshop-actions">
                <button className="button button-quiet" onClick={stop}>
                  停止
                </button>
                <button
                  className="button button-primary workshop-generate"
                  disabled
                  type="button"
                >
                  <Loader2 size={15} className="spin" />
                  {generating ? '生成中…' : '生成 Skill'}
                </button>
              </div>
            ) : (
              <div className="workshop-actions">
                <button
                  className="button button-quiet"
                  onClick={send}
                  disabled={uploading || generating}
                >
                  发送
                </button>
                <button
                  className="button button-primary workshop-generate"
                  title="细节确认后再点；不点就不会生成技能"
                  disabled={!hasAnalysis || uploading || generating}
                  onClick={generateSkill}
                >
                  {generating ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
                  {generating ? '生成中…' : '生成 Skill'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void readFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </section>
  )
}
