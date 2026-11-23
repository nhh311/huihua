import { Download, FolderOpen, ImageOff, Loader2, Sparkles } from 'lucide-react'
import { useApp } from '../store'
import { bridge } from '../lib/bridge'
import { baseName, exportImage } from '../lib/export'
import { GeneratingArt } from './GeneratingArt'
import { SafeImage } from './SafeImage'
import type { GalleryItem, Message } from '../types'

export function GenerationCard({
  message,
  onPreview,
}: {
  message: Message
  onPreview: (item: GalleryItem) => void
}) {
  const generation = message.generation
  const toastMessage = useApp((s) => s.toastMessage)
  const catalog = useApp((s) => s.catalog)
  if (!generation) return null

  const running = generation.status === 'running'
  const total = generation.progress?.total || Math.max(1, generation.images.length)
  const done = generation.progress?.done || generation.images.length
  const planCount = Math.max(total, message.plan?.count || 0)
  const provider = catalog.find((item) => item.id === message.plan?.provider)
  const model = provider?.models.find((item) => item.id === message.plan?.model)

  const reveal = async (item: GalleryItem) => {
    try {
      await bridge.gallery.reveal(item.id)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const download = async (item: GalleryItem) => {
    try {
      const path = await exportImage(item.id)
      if (path) toastMessage(`已导出 ${baseName(path)}`, 'success')
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="generation-card">
      <div className="generation-head">
        <div className="generation-title">
          <span className="generation-icon">
            <Sparkles size={16} />
          </span>
          <div>
            <strong>{running ? '正在生成' : generation.status === 'error' ? '生成失败' : '生成结果'}</strong>
            <span>
              {running
                ? [provider?.name, model?.name].filter(Boolean).join(' · ') || '正在调用生图模型'
                : generation.status === 'error'
                  ? generation.error || '请稍后重试'
                  : `${generation.images.length} 张 · 已保存到作品`}
            </span>
          </div>
        </div>
        {running ? <Loader2 className="spin" size={18} /> : null}
      </div>

      {running ? (
        <GeneratingArt
          total={planCount}
          done={done}
          providerName={provider?.name}
          modelName={model?.name}
          ratio={message.plan?.ratio}
          resolution={message.plan?.resolution}
        />
      ) : null}

      {generation.warnings?.length ? (
        <ul className="generation-warnings">
          {generation.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {generation.images.length ? (
        <div className={`generation-grid count-${Math.min(generation.images.length, 4)}`}>
          {generation.images.map((item) => (
            <figure className="generation-tile" key={item.id}>
              <SafeImage item={item} onClick={() => onPreview(item)} />
              <figcaption>
                <span title={item.prompt}>{item.prompt}</span>
                <div className="tile-actions">
                  <button title="打开所在文件夹" onClick={() => void reveal(item)}>
                    <FolderOpen size={14} />
                  </button>
                  <button title="导出图片" onClick={() => void download(item)}>
                    <Download size={14} />
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {generation.status === 'error' && !generation.images.length ? (
        <div className="generation-empty">
          <ImageOff size={20} />
          <p>{generation.error || '这次没有拿到图片，修改文案后可以再试一次。'}</p>
        </div>
      ) : null}
    </div>
  )
}
