import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export const IconButton = ({
  title,
  onClick,
  children,
  className = '',
  disabled = false,
  active = false,
}: {
  title: string
  onClick?: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
  active?: boolean
}) => (
  <button
    type="button"
    className={`icon-button ${active ? 'is-active' : ''} ${className}`}
    title={title}
    aria-label={title}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
)

export const Spinner = ({ size = 14 }: { size?: number }) => (
  <span className="spinner" style={{ width: size, height: size }} />
)

export const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}) => (
  <button
    type="button"
    className={`toggle ${checked ? 'is-on' : ''}`}
    onClick={() => onChange(!checked)}
    aria-pressed={checked}
    title={label}
  >
    <span className="toggle-knob" />
    {label ? <span className="toggle-label">{label}</span> : null}
  </button>
)

export const Modal = ({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  footer?: ReactNode
}) => (
  <div className="modal-backdrop" onMouseDown={onClose}>
    <div
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <IconButton title="关闭" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-foot">{footer}</div> : null}
    </div>
  </div>
)

export const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint ? <span className="field-hint">{hint}</span> : null}
  </label>
)
