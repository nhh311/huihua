import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUpRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Sparkles,
  User,
} from 'lucide-react'
import type { GalleryItem, Message, Session } from '../types'
import { Markdown } from './Markdown'
import { PlanCard } from './PlanCard'
import { GenerationCard } from './GenerationCard'

const suggestions = [
  {
    title: '电影感夜景',
    hint: '霓虹、雨夜、低机位',
    prompt:
      '雨夜的东京街头，霓虹灯倒映在积水里，一位撑透明伞的女孩站在便利店门口，电影感广角，低机位，湿润的空气，克制的青橙色调。',
  },
  {
    title: '产品海报',
    hint: '静物、棚拍、留白',
    prompt:
      '一瓶极简白色香水放在米色石材台上，柔和侧光，背景是温暖的奶油色渐变，产品摄影，干净留白，高级质感，适合做海报主视觉。',
  },
  {
    title: '角色设定',
    hint: '半身、细节、氛围',
    prompt:
      '一位穿深绿色风衣的年轻植物学家，站在玻璃温室里，手里拿着一片蕨类叶子，日系动画电影风格，半身构图，柔和逆光，细腻的眼神。',
  },
]

const Thinking = ({ text, streaming }: { text: string; streaming?: boolean }) => (
  <details className="thinking" open={false}>
    <summary>
      {streaming ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
      {streaming ? '正在深度思考…' : '深度思考'}
      <span>{text.length} 字</span>
    </summary>
    <pre>{text}</pre>
  </details>
)

const Attachments = ({ message }: { message: Message }) => {
  const attachments = message.attachments || []
  if (!attachments.length) return null
  return (
    <div className="attachments">
      {attachments.map((item) =>
        item.isImage && item.dataUrl ? (
          <figure className={`attachment-image ${item.status}`} key={item.id}>
            <img src={item.dataUrl} alt={item.name} />
            <figcaption>{item.name}</figcaption>
          </figure>
        ) : (
          <span className={`attachment-file ${item.status}`} key={item.id} title={item.error || item.name}>
            <FileText size={14} />
            <span>{item.name}</span>
            {item.status === 'uploading' ? <Loader2 size={12} className="spin" /> : null}
          </span>
        )
      )}
    </div>
  )
}
export function Chat({
  session,
  busy,
  onStartPlan,
  onReplan,
  onPreview,
  onSuggestion,
}: {
  session: Session | null
  busy: boolean
  onStartPlan: (messageId: string) => void
  onReplan: (messageId: string) => void
  onPreview: (item: GalleryItem) => void
  onSuggestion: (text: string) => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<string | null>(null)
  const countRef = useRef(0)
  const userCountRef = useRef(0)
  const stickRef = useRef(true)
  const holdRef = useRef(0)
  const [atBottom, setAtBottom] = useState(true)

  const last = session?.messages[session.messages.length - 1]
  const lastLength = last ? (last.content?.length || 0) + (last.thinking?.length || 0) : 0

  useEffect(() => {
    const node = scrollerRef.current
    if (!node || !session) return
    // 切会话时直接贴底
    if (session.id !== sessionRef.current) {
      sessionRef.current = session.id
      countRef.current = session.messages.length
      userCountRef.current = session.messages.filter((item) => item.role === 'user').length
      stickRef.current = true
      setAtBottom(true)
      node.scrollTop = session.messages.length ? node.scrollHeight : 0
      return
    }
    const grew = session.messages.length > countRef.current
    countRef.current = session.messages.length
    const users = session.messages.filter((item) => item.role === 'user').length
    // 自己发消息时贴底；模型流式输出时只在这一刻确实位于底部才继续跟随
    if (grew && users > userCountRef.current) {
      userCountRef.current = users
      stickRef.current = true
      setAtBottom(true)
    }
    userCountRef.current = users
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
  }, [session?.id, session?.messages.length, lastLength, last?.planStatus])

  const onScroll = () => {
    const node = scrollerRef.current
    if (!node) return
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    if (Date.now() >= holdRef.current) stickRef.current = bottom
    setAtBottom(bottom)
  }

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const onWheel = () => {
      stickRef.current = false
      holdRef.current = Date.now() + 1500
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('wheel', onWheel, { passive: true })
    node.addEventListener('touchmove', onWheel, { passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('wheel', onWheel)
      node.removeEventListener('touchmove', onWheel)
    }
  }, [])

  const jumpToBottom = () => {
    const node = scrollerRef.current
    if (!node) return
    stickRef.current = true
    setAtBottom(true)
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }

  if (!session) {
    return (
      <div className="chat-empty">
        <p>还没有对话，点左上角「新对话」开始。</p>
      </div>
    )
  }

  return (
    <section className="chat">
      <header className="chat-head">
        <div>
          <h1>{session.title || '新对话'}</h1>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollerRef}>
        {!session.messages.length ? (
          <div className="welcome">
            <h2>今天想画什么？</h2>
            <p>
              先和 DeepSeek 聊清楚画面，再点「整理文案」确认生图方案，最后点「开始生成」。
              也可以从下面一个场景开始。
            </p>
            <div className="suggestion-grid">
              {suggestions.map((item) => (
                <button key={item.title} className="suggestion-card" onClick={() => onSuggestion(item.prompt)}>
                  <span className="suggestion-icon">
                    <ImageIcon size={16} />
                  </span>
                  <strong>{item.title}</strong>
                  <span>{item.hint}</span>
                  <ArrowUpRight size={15} className="suggestion-arrow" />
                </button>
              ))}
            </div>
            <div className="welcome-flow">
              <span>聊清楚</span>
              <i>→</i>
              <span>整理文案</span>
              <i>→</i>
              <span>开始生成</span>
              <p>生成结果自动保存到「作品」，可以回来改一句文案，再出一张。</p>
            </div>
            <div className="welcome-hint">
              <Paperclip size={14} />
              也可以把图片拖到右侧任意位置，做图生图或风格参考            </div>
          </div>
        ) : null}

        <div className="messages">
          {session.messages.map((message) => {
            if (message.kind === 'plan') {
              return (
                <PlanCard
                  key={message.id}
                  message={message}
                  session={session}
                  onStart={onStartPlan}
                  onReplan={onReplan}
                  busy={busy}
                />
              )
            }
            if (message.kind === 'generation') {
              return <GenerationCard key={message.id} message={message} onPreview={onPreview} />
            }

            const isUser = message.role === 'user'
            return (
              <article className={`message ${isUser ? 'is-user' : 'is-assistant'}`} key={message.id}>
                <div className={`avatar ${isUser ? 'avatar-user' : 'avatar-ai'}`}>
                  {isUser ? <User size={15} /> : <Sparkles size={15} />}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{isUser ? '你' : '绘话'}</strong>
                    <span>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    {message.usage?.output_tokens ? (
                      <span className="usage">{message.usage.output_tokens} tokens</span>
                    ) : null}
                  </div>

                  <Attachments message={message} />

                  {message.thinking ? (
                    <Thinking text={message.thinking} streaming={message.streaming} />
                  ) : null}

                  {isUser ? (
                    <div className="user-text">{message.content}</div>
                  ) : (
                    <div className="assistant-text">
                      {message.content ? <Markdown>{message.content}</Markdown> : null}
                      {message.streaming && !message.content ? (
                        <span className="typing">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : null}
                      {message.streaming && message.content ? <span className="caret" /> : null}
                    </div>
                  )}

                  {message.error ? <div className="message-error">{message.error}</div> : null}
                  {message.stopped ? <div className="message-stopped">已停止生成</div> : null}
                </div>
              </article>
            )
          })}
        </div>
        <div ref={bottomRef} />
      </div>
      {!atBottom ? (
        <button className="scroll-bottom" type="button" onClick={jumpToBottom}>
          <ArrowDown size={14} />
          回到最新        </button>
      ) : null}
    </section>
  )
}
