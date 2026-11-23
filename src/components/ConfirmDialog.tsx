import type { ReactNode } from 'react'

type Action = {
  label: string
  tone?: 'primary' | 'danger' | 'quiet'
  onClick: () => void
}

type Props = {
  open: boolean
  title: string
  subtitle?: ReactNode
  actions: Action[]
  onClose?: () => void
}

export default function ConfirmDialog({ open, title, subtitle, actions, onClose }: Props) {
  if (!open) return null
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-card">
        <h3>{title}</h3>
        {subtitle ? <p className="confirm-subtitle">{subtitle}</p> : null}
        <div className="confirm-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`confirm-action ${action.tone || 'quiet'}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
        {onClose ? (
          <button type="button" className="confirm-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        ) : null}
      </div>
    </div>
  )
}
