import type { MouseEvent } from 'react'
import { useMemo, useState } from 'react'
import {
  Images,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useApp } from '../store'
import { bridge, formatTime } from '../lib/bridge'
import { Modal } from './ui'
import type { Session } from '../types'

export type AppView = 'chat' | 'gallery' | 'workshop' | 'presets'

export function Sidebar({
  view,
  onView,
  onNewWorkshop,
  onOpenSettings,
}: {
  view: AppView
  onView: (view: AppView) => void
  onNewWorkshop: () => void
  onOpenSettings: () => void
}) {
  const sessions = useApp((s) => s.sessions)
  const sessionTrash = useApp((s) => s.sessionTrash)
  const activeId = useApp((s) => s.activeId)
  const config = useApp((s) => s.config)
  const newSession = useApp((s) => s.newSession)
  const selectSession = useApp((s) => s.selectSession)
  const removeSession = useApp((s) => s.removeSession)
  const restoreSession = useApp((s) => s.restoreSession)
  const purgeSession = useApp((s) => s.purgeSession)
  const emptySessionTrash = useApp((s) => s.emptySessionTrash)
  const toastMessage = useApp((s) => s.toastMessage)
  const galleryCount = useApp((s) => s.gallery.length)
  const presetCount = useApp((s) => s.presets?.count || 0)
  const [trashOpen, setTrashOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<Session | null>(null)
  const [pendingPurge, setPendingPurge] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const ordered = useMemo(
    () => [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [sessions]
  )

  const configured = useMemo(() => {
    if (!config) return 0
    const providers = Object.values(config.providers).filter((p) => p.hasKey).length
    return providers + (config.deepseek.hasKey ? 1 : 0)
  }, [config])

  const askRemove = (event: MouseEvent, session: Session) => {
    event.stopPropagation()
    setPendingRemove(session)
  }

  const confirmRemove = async () => {
    if (!pendingRemove) return
    const session = pendingRemove
    if (session.kind === 'workshop' && session.workshop?.status === 'running') {
      const requestId = session.workshop.requestId
      if (requestId) void bridge.workshop.abort(requestId)
    }
    setPendingRemove(null)
    await removeSession(session.id)
    toastMessage('已移到「最近删除」，还能还原', 'success')
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <div className="brand-text">
          <strong>绘话</strong>
        </div>
      </div>

      <button className="new-chat" onClick={() => newSession()}>
        <Plus size={17} />
        <span>新对话</span>
        <kbd>Ctrl N</kbd>
      </button>

      <button
        className="nav-item nav-workshop"
        onClick={onNewWorkshop}
      >
        <Wand2 size={17} />
        <span>新技能</span>
        <span className="nav-badge">工坊</span>
      </button>

      <button
        className={`nav-item ${view === 'presets' ? 'is-active' : ''}`}
        onClick={() => onView('presets')}
      >
        <LayoutGrid size={17} />
        <span>预设库</span>
        <span className="nav-count">{presetCount || ''}</span>
      </button>

      <button
        className={`nav-item ${view === 'gallery' ? 'is-active' : ''}`}
        onClick={() => onView('gallery')}
      >
        <Images size={17} />
        <span>作品</span>
        <span className="nav-count">{galleryCount || ''}</span>
      </button>

      <div className="sidebar-section">
        <span>最近对话</span>
        <div className="sidebar-section-right">
          <span>{ordered.length}</span>
          <button
            className="sidebar-trash"
            onClick={() => setTrashOpen(true)}
            disabled={!sessionTrash.length}
            title="最近删除（会话）"
          >
            <Trash2 size={12} />
            {sessionTrash.length ? sessionTrash.length : ''}
          </button>
        </div>
      </div>

      <div className="session-list">
        {ordered.map((session) => {
          const workshop = session.kind === 'workshop'
          const running = workshop && session.workshop?.status === 'running'
          const active = (workshop ? view === 'workshop' : view === 'chat') && activeId === session.id
          const unread = workshop && !active && session.workshop?.unread === true
          return (
            <button
              key={session.id}
              className={`session-item ${active ? 'is-active' : ''} ${workshop ? 'is-workshop' : ''}`}
              onClick={() => {
                selectSession(session.id)
                onView(workshop ? 'workshop' : 'chat')
                if (unread) useApp.getState().syncWorkshop(session.id, { unread: false })
              }}
            >
              {running ? (
                <Loader2 size={15} className="spin session-spin" />
              ) : workshop ? (
                <Wand2 size={15} />
              ) : (
                <MessageSquare size={15} />
              )}
              <span className="session-title">{session.title || (workshop ? '新技能' : '新对话')}</span>
              {unread ? <span className="session-dot" /> : null}
              <span className="session-time">{formatTime(session.updatedAt)}</span>
              <span
                className="session-delete"
                role="button"
                title={workshop ? '删除这个技能会话' : '删除对话'}
                onClick={(event) => askRemove(event, session)}
              >
                <Trash2 size={13} />
              </span>
            </button>
          )
        })}
      </div>

      <div className="sidebar-foot">
        <button className="nav-item" onClick={onOpenSettings}>
          <Settings size={17} />
          <span>设置</span>
          <span className={`key-dot ${configured >= 2 ? 'is-ok' : ''}`} />
        </button>
        <p className="sidebar-note">
          {configured ? `${configured} 个接口已配置` : '还没有配置接口密钥'}
        </p>
      </div>

      {pendingRemove ? (
        <Modal
          title={pendingRemove.kind === 'workshop' ? '删除这个技能会话？' : '删除这段对话？'}
          subtitle={
            pendingRemove.kind === 'workshop' && pendingRemove.workshop?.status === 'running'
              ? '技能还在生成，删除会中断任务；会话仍会放进最近删除，可以还原。'
              : '会先放进「最近删除」，之后随时可以还原。'
          }
          onClose={() => setPendingRemove(null)}
          footer={
            <>
              <button className="button button-quiet" onClick={() => setPendingRemove(null)}>
                取消
              </button>
              <button className="button button-danger" onClick={() => void confirmRemove()}>
                移到最近删除
              </button>
            </>
          }
        >
          <div className="session-delete-preview">
            <strong>{pendingRemove.title || '新对话'}</strong>
            <p>
              {pendingRemove.messages.length} 条消息 · 最近更新 {formatTime(pendingRemove.updatedAt)}
            </p>
          </div>
        </Modal>
      ) : null}

      {trashOpen ? (
        <Modal
          wide
          title="最近删除的对话"
          subtitle="删掉的对话会保留在这里，点还原就能回到「最近对话」。"
          onClose={() => setTrashOpen(false)}
          footer={
            sessionTrash.length ? (
              confirmEmpty ? (
                <>
                  <span className="trash-confirm-text">彻底删除全部 {sessionTrash.length} 段对话？不可恢复。</span>
                  <button className="button button-quiet" onClick={() => setConfirmEmpty(false)}>
                    取消
                  </button>
                  <button
                    className="button button-danger"
                    onClick={() => {
                      void emptySessionTrash()
                      setConfirmEmpty(false)
                      setTrashOpen(false)
                    }}
                  >
                    全部彻底删除
                  </button>
                </>
              ) : (
                <button className="button button-quiet" onClick={() => setConfirmEmpty(true)}>
                  <Trash2 size={15} />
                  清空最近删除
                </button>
              )
            ) : null
          }
        >
          {!sessionTrash.length ? (
            <div className="trash-empty">
              <Trash2 size={22} />
              <p>最近删除是空的。删错对话时可以在这里找回来。</p>
            </div>
          ) : (
            <ul className="trash-list">
              {sessionTrash.map((session) => (
                <li key={session.id} className="trash-row">
                  <span className="trash-session-icon">
                    {session.kind === 'workshop' ? <Wand2 size={16} /> : <MessageSquare size={16} />}
                  </span>
                  <div className="trash-body">
                    <p>{session.title || (session.kind === 'workshop' ? '新技能' : '新对话')}</p>
                    <span>
                      {session.messages.length} 条消息 · 删除于{' '}
                      {formatTime(new Date(session.deletedAt || Date.now()).toISOString())}
                    </span>
                  </div>
                  {pendingPurge === session.id ? (
                    <div className="trash-actions">
                      <span>彻底删除？</span>
                      <button className="button button-quiet" onClick={() => setPendingPurge(null)}>
                        取消
                      </button>
                      <button
                        className="button button-danger"
                        onClick={() => {
                          void purgeSession(session.id)
                          setPendingPurge(null)
                        }}
                      >
                        确定
                      </button>
                    </div>
                  ) : (
                    <div className="trash-actions">
                      <button
                        className="button button-quiet"
                        onClick={() => {
                          void restoreSession(session.id)
                          toastMessage('已还原到最近对话', 'success')
                        }}
                      >
                        <RotateCcw size={14} />
                        还原
                      </button>
                      <button className="button button-quiet" onClick={() => setPendingPurge(session.id)}>
                        彻底删除
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}
    </aside>
  )
}
