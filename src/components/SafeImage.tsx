import { useEffect, useState, type MouseEventHandler } from 'react'
import { bridge } from '../lib/bridge'
import type { GalleryItem } from '../types'

// Inline copies recovered from the backend, so a gallery page only pays for the
// fallback once even when the asset protocol stays unavailable.
const recovered = new Map<string, string>()

function sourceOf(item: GalleryItem, thumb: boolean) {
  return (thumb ? item.thumbUrl : item.url) || item.url || item.thumbUrl || ''
}

export function SafeImage({
  item,
  thumb = true,
  alt,
  className,
  loading,
  onClick,
}: {
  item: GalleryItem
  thumb?: boolean
  alt?: string
  className?: string
  loading?: 'lazy' | 'eager'
  onClick?: MouseEventHandler<HTMLImageElement>
}) {
  const [src, setSrc] = useState(() => sourceOf(item, thumb))
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    setSrc(sourceOf(item, thumb))
    setRetrying(false)
  }, [item.id, item.url, item.thumbUrl, thumb])

  const recover = async () => {
    if (retrying) return
    const key = `${item.id}:${thumb ? 'thumb' : 'full'}`
    const cached = recovered.get(key)
    if (cached) {
      setSrc(cached)
      return
    }
    setRetrying(true)
    try {
      const data = await bridge.gallery.preview(item.id, thumb)
      if (typeof data === 'string' && data.startsWith('data:')) {
        recovered.set(key, data)
        setSrc(data)
      }
    } catch {
      // Leave the alt text in place; nothing else we can do here.
    } finally {
      setRetrying(false)
    }
  }

  return (
    <img
      src={src}
      alt={alt ?? item.prompt ?? '生成图片'}
      className={className}
      loading={loading}
      onClick={onClick}
      onError={() => void recover()}
      draggable={false}
    />
  )
}
