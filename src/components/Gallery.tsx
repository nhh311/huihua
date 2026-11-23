import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  FolderOpen,
  Images,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { useApp } from '../store'
import { bridge, formatTime } from '../lib/bridge'
import { baseName, exportImage, showInFolder } from '../lib/export'
import { Modal } from './ui'
import { SafeImage } from './SafeImage'
import type { GalleryItem, GalleryTrashItem } from '../types'

export function Gallery({ onPreview }: { onPreview: (item: GalleryItem) => void }) {
  const gallery = useApp((s) => s.gallery)
  const galleryTrash = useApp((s) => s.galleryTrash)
  const catalog = useApp((s) => s.catalog)
  const refreshGallery = useApp((s) => s.refreshGallery)
  const refreshGalleryTrash = useApp((s) => s.refreshGalleryTrash)
  const removeGalleryItem = useApp((s) => s.removeGalleryItem)
  const restoreGalleryItem = useApp((s) => s.restoreGalleryItem)
  const purgeGalleryItem = useApp((s) => s.purgeGalleryItem)
  const emptyGalleryTrash = useApp((s) => s.emptyGalleryTrash)
  const toastMessage = useApp((s) => s.toastMessage)
  const [provider, setProvider] = useState('all')
  const [loading, setLoading] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null)
  const [pendingPurge, setPendingPurge] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exported, setExported] = useState<{ path: string; name: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    void Promise.all([refreshGallery(), refreshGalleryTrash()]).finally(() => setLoading(false))
  }, [refreshGallery, refreshGalleryTrash])

  const items = useMemo(() => {
    const list = provider === 'all' ? gallery : gallery.filter((item) => item.provider === provider)
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [gallery, provider])

  const nameOf = (id: string) => catalog.find((p) => p.id === id)?.name || id

  const download = async (item: GalleryItem) => {
    try {
      const path = await exportImage(item.id)
      if (!path) return
      setExported({ path, name: baseName(path) })
      toastMessage(`已导出 ${baseName(path)}`, 'success')
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const remove = async () => {
    if (!pendingDelete) return
    setBusy(true)
    const ok = await removeGalleryItem(pendingDelete.id)
    setBusy(false)
    if (ok) {
      setPendingDelete(null)
      toastMessage('已移到最近删除，可在右上角找回', 'success')
    }
  }

  const restore = async (entry: GalleryTrashItem) => {
    setBusy(true)
    const ok = await restoreGalleryItem(entry.id)
    setBusy(false)
    if (ok && !useApp.getState().galleryTrash.length) setTrashOpen(false)
  }

  const purge = async (id: string) => {
    setBusy(true)
    const ok = await purgeGalleryItem(id)
    setBusy(false)
    if (ok) setPendingPurge(null)
  }

  const emptyAll = async () => {
    setBusy(true)
    const ok = await emptyGalleryTrash()
    setBusy(false)
    if (ok) {
      setConfirmEmpty(false)
      setTrashOpen(false)
    }
  }

  const reveal = async (item: GalleryItem) => {
    try {
      await bridge.gallery.reveal(item.id)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <section className="gallery-view">
      <header className="page-head">
        <div>
          <h1>作品</h1>
          <p>{gallery.length} 张生成结果，原图保存在本地。</p>
        </div>
        <div className="page-head-actions">
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="all">全部供应商</option>
            {catalog.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="button button-quiet"
            onClick={() => setTrashOpen(true)}
            disabled={!galleryTrash.length}
            title="删除的作品会先放这里，30 天内可以还原"
          >
            <Trash2 size={15} />
            最近删除{galleryTrash.length ? ` (${galleryTrash.length})` : ''}
          </button>
          <button className="button button-quiet" onClick={() => void refreshGallery()}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      {exported ? (
        <div className="export-result">
          <span className="export-result-path" title={exported.path}>
            已导出到 <b>{exported.path}</b>
          </span>
          <button className="button button-quiet" onClick={() => void showInFolder(exported.path)}>
            <FolderOpen size={15} />
            打开所在文件夹
          </button>
          <button className="icon-button" title="关闭" onClick={() => setExported(null)}>
            <X size={15} />
          </button>
        </div>
      ) : null}

      {!items.length ? (
        <div className="gallery-empty">
          <span>
            <Images size={26} />
          </span>
          <h2>还没有作品</h2>
          <p>在对话里整理好文案，点「开始生成」，图片会自动收进这里。</p>
        </div>
      ) : (
        <div className="gallery-grid">
          {items.map((item) => (
            <figure className="gallery-card" key={item.id}>
              <div
                className="gallery-image"
                onClick={() => onPreview(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onPreview(item)
                }}
              >
                <SafeImage item={item} loading="lazy" />
                <span className="gallery-provider">{nameOf(item.provider)}</span>
              </div>
              <figcaption>
                <p title={item.prompt}>{item.prompt}</p>
                <span>
                  {item.ratio} · {item.resolution} · {formatTime(item.createdAt)}
                </span>
                <div className="gallery-actions">
                  <button type="button" title="预览大图" onClick={() => onPreview(item)}>
                    <Images size={15} />
                    预览
                  </button>
                  <button type="button" title="导出原图（可选择保存位置）" onClick={() => void download(item)}>
                    <Download size={15} />
                    导出
                  </button>
                  <button type="button" title="打开原图所在文件夹" onClick={() => void reveal(item)}>
                    <FolderOpen size={15} />
                    文件夹
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    title="移到最近删除（可还原）"
                    onClick={() => setPendingDelete(item)}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {pendingDelete ? (
        <Modal
          title="删除这张作品？"
          subtitle="会先放进「最近删除」，30 天内随时可以还原。"
          onClose={() => (busy ? undefined : setPendingDelete(null))}
          footer={
            <>
              <button className="button button-quiet" onClick={() => setPendingDelete(null)} disabled={busy}>
                取消
              </button>
              <button className="button button-danger" onClick={() => void remove()} disabled={busy}>
                {busy ? '正在移入…' : '移到最近删除'}
              </button>
            </>
          }
        >
          <div className="delete-preview">
            <img src={pendingDelete.thumbUrl || pendingDelete.url} alt="" />
            <p>{pendingDelete.prompt}</p>
          </div>
        </Modal>
      ) : null}

      {trashOpen ? (
        <Modal
          wide
          title="最近删除"
          subtitle="删除的作品会在这里保留 30 天，到期自动清理；也可以现在就彻底删除。"
          onClose={() => setTrashOpen(false)}
          footer={
            galleryTrash.length ? (
              confirmEmpty ? (
                <>
                  <span className="trash-confirm-text">彻底删除全部 {galleryTrash.length} 张？不可恢复。</span>
                  <button className="button button-quiet" onClick={() => setConfirmEmpty(false)} disabled={busy}>
                    取消
                  </button>
                  <button className="button button-danger" onClick={() => void emptyAll()} disabled={busy}>
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
          {!galleryTrash.length ? (
            <div className="trash-empty">
              <Trash2 size={22} />
              <p>最近删除是空的。删错的作品会先出现在这里。</p>
            </div>
          ) : (
            <ul className="trash-list">
              {galleryTrash.map((entry) => (
                <li key={entry.id} className="trash-row">
                  <img
                    className="trash-thumb"
                    src={entry.thumbUrl || entry.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      const image = event.currentTarget
                      if (image.dataset.fallback !== '1') {
                        image.dataset.fallback = '1'
                        image.src = entry.imageUrl
                      }
                    }}
                  />
                  <div className="trash-body">
                    <p>{entry.item.prompt}</p>
                    <span>
                      {entry.item.ratio} · {entry.item.resolution} · 删除于 {formatTime(entry.deletedAt)}
                    </span>
                  </div>
                  {pendingPurge === entry.id ? (
                    <div className="trash-actions">
                      <span>彻底删除？</span>
                      <button className="button button-quiet" onClick={() => setPendingPurge(null)} disabled={busy}>
                        取消
                      </button>
                      <button className="button button-danger" onClick={() => void purge(entry.id)} disabled={busy}>
                        确定
                      </button>
                    </div>
                  ) : (
                    <div className="trash-actions">
                      <button className="button button-quiet" onClick={() => void restore(entry)} disabled={busy}>
                        <RotateCcw size={14} />
                        还原
                      </button>
                      <button className="button button-quiet" onClick={() => setPendingPurge(entry.id)}>
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
    </section>
  )
}
