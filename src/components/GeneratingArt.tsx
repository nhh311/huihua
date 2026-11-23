import { useEffect, useRef, useState } from 'react'
import starUrl from '../assets/huihua-star.png'
import { createGridLoader } from '../lib/grid-loader'

const CELLS = 32

export function GeneratingArt({
  total,
  done,
  providerName,
  modelName,
  ratio,
  resolution,
}: {
  total: number
  done: number
  providerName?: string
  modelName?: string
  ratio?: string
  resolution?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [icon, setIcon] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => setIcon(image)
    image.src = starUrl
    return () => {
      image.onload = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !icon) return undefined
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const loader = createGridLoader(canvas, {
      variant: 'float',
      theme: 'light',
      n: CELLS,
      gap: 0.3,
      radius: 0.18,
      speed: 0.82,
      icon,
      iconSize: 0.28,
      iconColor: '#2f5d50',
      iconShadow: 1,
    })
    if (calm) loader.drawAt(0)
    else loader.start()
    return () => loader.destroy()
  }, [icon])

  const count = Math.max(1, Math.min(8, total || 1))
  const finished = Math.max(0, Math.min(done, count))
  const percent = Math.round((finished / count) * 100)
  const credits = [providerName, modelName].filter(Boolean).join(' · ') || '生图模型'

  return (
    <div className="gen-stage">
      <div className="gen-canvas-wrap">
        <canvas ref={canvasRef} className="gen-canvas" aria-hidden="true" />
      </div>

      <div className="gen-side">
        <div className="gen-count" role="status" aria-live="polite">
          <strong>{finished}</strong>
          <span> / {count} 张</span>
        </div>

        <div className="gen-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(percent, 2)}%` }} />
        </div>

        <div className="gen-side-meta">{credits}</div>

        <div className="gen-dots" aria-hidden="true">
          {Array.from({ length: count }, (_, index) => (
            <i key={index} className={index < finished ? 'is-done' : ''} />
          ))}
        </div>

        <div className="gen-side-note">
          {[ratio, resolution].filter(Boolean).join(' · ') || '按当前参数'}
          <br />
          每张出图后立即保存到作品，可以继续聊天，也可以随时停止。
        </div>
      </div>
    </div>
  )
}
