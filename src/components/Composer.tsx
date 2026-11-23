import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ArrowUp,
  Loader2,
  Paperclip,
  Sparkles,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import { useApp } from '../store'
import {
  acceptAttr,
  bridge,
  compressImage,
  fileToDataUrl,
  formatBytes,
  isImageFile,
  uid,
  uploadPurpose,
} from '../lib/bridge'
import type { Attachment, PresetDraft, Session } from '../types'

export interface ComposerHandle {
  insertText: (text: string) => void
  addFiles: (files: FileList | File[]) => void
}

interface Props {
  session: Session | null
  /** 预设库带进来的提示词；nonce 变化时覆盖输入框 */
  draft?: PresetDraft | null
  streaming: boolean
  generating: boolean
  planning: boolean
  hasPlan: boolean
  onOpenSettings: () => void
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>
  onPlan: (text: string, attachments: Attachment[]) => Promise<boolean>
  onStartLatest: () => void
  onStop: () => void
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    session,
    draft,
    streaming,
    generating,
    planning,
    hasPlan,
    onOpenSettings,
    onSend,
    onPlan,
    onStartLatest,
    onStop,
  },
  ref
) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const appliedDraft = useRef(0)
  const lastSession = useRef('')

  const catalog = useApp((s) => s.catalog)
  const styles = useApp((s) => s.styles)
  const config = useApp((s) => s.config)
  const setParams = useApp((s) => s.setParams)
  const setProvider = useApp((s) => s.setProvider)
  const setModel = useApp((s) => s.setModel)
  const setStyle = useApp((s) => s.setStyle)
  const toastMessage = useApp((s) => s.toastMessage)

  const provider = catalog.find((p) => p.id === session?.params.provider)
  const model = provider?.models.find((m) => m.id === session?.params.model) || provider?.models[0]
  const uploading = attachments.some((a) => a.status === 'uploading')
  const busy = streaming || generating || planning
  const hasKey = Boolean(config?.deepseek.hasKey)

  useEffect(() => {
    if (!session?.id) return
    const switched = lastSession.current !== session.id
    lastSession.current = session.id
    // 预设带进来的草稿：同一 nonce 只应用一次；会话已经有消息就不再回填，
    // 否则发完再切走/切回来，旧提示词会被重新塞进输入框（2.0.1 修的残留问题）。
    if (
      draft &&
      draft.sessionId === session.id &&
      draft.nonce !== appliedDraft.current &&
      !session.messages.length
    ) {
      appliedDraft.current = draft.nonce
      setText(draft.text)
      setAttachments([])
      setProvider(draft.provider)
      setModel(draft.model)
      setParams({
        ratio: draft.ratio,
        resolution: draft.resolution,
        count: draft.count,
        seed: null,
      })
      requestAnimationFrame(() => {
        textRef.current?.focus()
        textRef.current?.setSelectionRange(draft.text.length, draft.text.length)
      })
      return
    }
    // 只有真的换了会话才清空输入框；草稿被上层清掉（draft 变 null）时不要动正在编辑的文字。
    if (switched) {
      setText('')
      setAttachments([])
    }
  }, [session?.id, draft?.nonce])

  useEffect(() => {
    const node = textRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`
  }, [text])

  useImperativeHandle(ref, () => ({
    insertText: (value: string) => {
      setText((current) => (current ? `${current.trimEnd()} ${value}` : value))
      requestAnimationFrame(() => textRef.current?.focus())
    },
    addFiles: (files: FileList | File[]) => {
      void addFiles(files)
    },
  }))

  const updateAttachment = (id: string, patch: Partial<Attachment>) => {
    setAttachments((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const upload = async (file: File, attachmentId: string, image: boolean) => {
    if (!hasKey) {
      updateAttachment(attachmentId, {
        status: 'error',
        error: '先配置 DeepSeek API Key 才能上传附件',
      })
      return
    }
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const result = await bridge.chat.upload({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        buffer,
        purpose: uploadPurpose(file, image),
      })
      updateAttachment(attachmentId, { status: 'ready', serverId: result.id, error: undefined })
    } catch (error) {
      updateAttachment(attachmentId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    if (attachments.length + list.length > 12) {
      toastMessage('最多添加 12 个附件', 'error')
      return
    }
    const added: { file: File; attachment: Attachment }[] = []
    for (const file of list) {
      if (file.size > 64 * 1024 * 1024) {
        toastMessage(`${file.name} 超过 64MB`, 'error')
        continue
      }
      const image = isImageFile(file)
      let dataUrl: string | undefined
      if (image) {
        try {
          dataUrl = await compressImage(file, 2048)
        } catch {
          dataUrl = await fileToDataUrl(file)
        }
      }
      const attachment: Attachment = {
        id: uid('a-'),
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        isImage: image,
        dataUrl,
        status: hasKey ? 'uploading' : 'error',
        error: hasKey ? undefined : '先配置 DeepSeek API Key 才能上传附件',
      }
      added.push({ file, attachment })
    }
    if (!added.length) return
    setAttachments((current) => [...current, ...added.map((item) => item.attachment)])
    for (const { file, attachment } of added) {
      if (attachment.status === 'uploading') void upload(file, attachment.id, attachment.isImage)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }

  const validateAttachments = () => {
    if (uploading) {
      toastMessage('附件还在上传，稍等一下', 'info')
      return false
    }
    if (attachments.some((a) => a.status === 'error')) {
      toastMessage('有附件上传失败，请移除后重试', 'error')
      return false
    }
    return true
  }

  const submitSend = async () => {
    if (!session || busy || sending) return
    if (!text.trim() && !attachments.length) return
    if (!validateAttachments()) return
    setSending(true)
    const ok = await onSend(text.trim(), attachments.filter((a) => a.status === 'ready'))
    setSending(false)
    if (ok) {
      setText('')
      setAttachments([])
    }
  }

  const submitPlan = async () => {
    if (!session || busy || sending) return
    if (!text.trim() && !attachments.length && !session.messages.length) {
      toastMessage('先说说想要什么画面', 'info')
      return
    }
    if (!validateAttachments()) return
    setSending(true)
    const ok = await onPlan(text.trim(), attachments.filter((a) => a.status === 'ready'))
    setSending(false)
    if (ok) {
      setText('')
      setAttachments([])
    }
  }

  const changeProvider = (id: string) => {
    setProvider(id)
  }

  const changeModel = (id: string) => {
    setModel(id)
  }

  return (
    <div className="composer">
      {!hasKey ? (
        <button className="composer-banner" onClick={onOpenSettings}>
          <Sparkles size={14} />
          还没有配置 DeepSeek Key，点这里填写后才能对话
        </button>
      ) : null}

      <div className="params">
        <select value={session?.params.provider || ''} onChange={(event) => changeProvider(event.target.value)}>
          {catalog.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <select value={session?.params.model || ''} onChange={(event) => changeModel(event.target.value)}>
          {(provider?.models || []).map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <select value={session?.params.ratio || '1:1'} onChange={(event) => setParams({ ratio: event.target.value })}>
          {(model?.ratios || ['1:1']).map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={session?.params.resolution || '2K'}
          onChange={(event) => setParams({ resolution: event.target.value })}
        >
          {(model?.resolutions || ['2K']).map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={session?.params.count || 1}
          onChange={(event) => setParams({ count: Number(event.target.value) })}
        >
          {Array.from({ length: model?.countMax || 1 }, (_, index) => index + 1).map((n) => (
            <option value={n} key={n}>
              {n} 张
            </option>
          ))}
        </select>

        {model?.seed ? (
          <label className="seed-input">
            <span>种子</span>
            <input
              type="number"
              min={0}
              placeholder="随机"
              value={session?.params.seed ?? ''}
              onChange={(event) =>
                setParams({
                  seed: event.target.value === '' ? null : Math.max(0, Number(event.target.value)),
                })
              }
            />
          </label>
        ) : null}

        <select value={session?.styleId || ''} onChange={(event) => setStyle(event.target.value || null)}>
          <option value="">无风格</option>
          {styles.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <button
          className={`search-toggle ${session?.params.search ? 'is-on' : ''}`}
          onClick={() => setParams({ search: !session?.params.search })}
          title="联网搜索"
        >
          <span />
          联网
        </button>
      </div>

      {attachments.length ? (
        <div className="composer-attachments">
          {attachments.map((item) => (
            <div className={`composer-attachment ${item.status}`} key={item.id}>
              {item.isImage && item.dataUrl ? (
                <img src={item.dataUrl} alt={item.name} />
              ) : (
                <span className="file-badge">
                  <Paperclip size={14} />
                </span>
              )}
              <div className="composer-attachment-meta">
                <span title={item.name}>{item.name}</span>
                <small>
                  {formatBytes(item.size)}
                  {item.status === 'uploading' ? ' · 上传中' : item.status === 'error' ? ' · 失败' : ''}
                </small>
              </div>
              {item.status === 'uploading' ? <Loader2 size={13} className="spin" /> : null}
              <button title="移除" onClick={() => removeAttachment(item.id)}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-input-row">
        <button className="attach-button" title="添加附件" onClick={() => fileRef.current?.click()}>
          <Paperclip size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept={acceptAttr}
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <textarea
          ref={textRef}
          rows={1}
          value={text}
          placeholder={
            session?.messages.length
              ? '继续聊，或调整画面细节…'
              : '说说你想要什么画面，例如：雨夜的东京街头，电影感…'
          }
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files || [])
            if (files.length) {
              event.preventDefault()
              void addFiles(files)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (event.ctrlKey || event.metaKey) void submitPlan()
              else void submitSend()
            }
          }}
        />

        <div className="composer-actions">
          {streaming || generating ? (
            <button className="button button-quiet" onClick={onStop}>
              <Square size={14} />
              停止
            </button>
          ) : (
            <button
              className="button button-send"
              disabled={(!text.trim() && !attachments.length) || sending}
              onClick={() => void submitSend()}
              title="发送（Enter）"
            >
              {sending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} />}
            </button>
          )}
        </div>
      </div>

      <div className="composer-foot">
        <div className="composer-buttons">
          <button
            className="button button-plan"
            disabled={busy || sending || (!text.trim() && !attachments.length && !session?.messages.length)}
            onClick={() => void submitPlan()}
            title="让 DeepSeek 把当前对话整理成生图文案，不出图、不扣生图额度"
          >
            <Wand2 size={15} />
            整理文案
          </button>
          <span className="composer-step" aria-hidden="true">
            →
          </span>
          <button
            className="button button-primary"
            disabled={busy || !hasPlan}
            onClick={onStartLatest}
            title={hasPlan ? '按最近一份文案调用生图模型' : '先点「整理文案」整理文案'}
          >
            <Sparkles size={15} />
            开始生成
          </button>
        </div>
      </div>
    </div>
  )
})
