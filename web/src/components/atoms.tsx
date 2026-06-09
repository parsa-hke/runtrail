import type { CSSProperties, ReactNode, MouseEvent } from 'react'
import type { RunStatus } from '../api/types'

// ─── Status indicators ──────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--info)',
  done: 'var(--success)',
  failed: 'var(--danger)',
  killed: 'var(--warn)',
}

export function StatusDot({ status, size = 8 }: { status: RunStatus | string; size?: number }) {
  const color = STATUS_COLOR[status] || 'var(--fg-3)'
  return (
    <span
      title={status}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: status === 'running' ? `0 0 0 2px ${color}33` : 'none',
        animation: status === 'running' ? 'rtPulse 1.6s ease-in-out infinite' : undefined,
      }}
    />
  )
}

export function StatusBadge({ status }: { status: RunStatus | string }) {
  const color = STATUS_COLOR[status] || 'var(--fg-3)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        border: `1px solid ${color}55`,
        borderRadius: 3,
        color,
        background: `${color}14`,
        fontFamily: 'var(--mono)',
        fontSize: 11,
      }}
    >
      <StatusDot status={status} size={6} />
      {status}
    </span>
  )
}

// ─── Tag ────────────────────────────────────────────────────────────────────

export function Tag({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        border: '1px solid var(--border-2)',
        borderRadius: 3,
        background: 'var(--surface-2)',
        color: 'var(--fg-2)',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        cursor: onClick ? 'pointer' : 'default',
        marginRight: 4,
      }}
    >
      {children}
    </span>
  )
}

// ─── KBD ────────────────────────────────────────────────────────────────────

export function KBD({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        padding: '0 5px',
        minWidth: 16,
        height: 16,
        lineHeight: '16px',
        textAlign: 'center',
        border: '1px solid var(--border-2)',
        borderBottomWidth: 2,
        borderRadius: 3,
        background: 'var(--surface-2)',
        color: 'var(--fg-2)',
        fontFamily: 'var(--mono)',
        fontSize: 10,
      }}
    >
      {children}
    </kbd>
  )
}

// ─── Buttons ────────────────────────────────────────────────────────────────

export function Btn({
  children,
  onClick,
  variant = 'default',
  disabled = false,
  style,
}: {
  children: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  variant?: 'default' | 'accent' | 'ghost' | 'danger'
  disabled?: boolean
  style?: CSSProperties
}) {
  const palette: Record<string, CSSProperties> = {
    default: { background: 'var(--surface-2)', color: 'var(--fg)', border: '1px solid var(--border)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' },
    ghost: { background: 'transparent', color: 'var(--fg-2)', border: '1px solid transparent' },
    danger: { background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger)' },
  }
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 3,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...palette[variant],
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export function Panel({
  title,
  children,
  right,
  style,
}: {
  title?: ReactNode
  children: ReactNode
  right?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--surface)',
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-2)',
            fontWeight: 600,
          }}
        >
          <span>{title}</span>
          <span style={{ flex: 1 }} />
          {right}
        </div>
      )}
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}

// ─── Key/value list ─────────────────────────────────────────────────────────

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '4px 0',
        borderBottom: '1px dashed var(--border)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
      }}
    >
      <span style={{ color: 'var(--fg-3)', minWidth: 140 }}>{k}</span>
      <span style={{ color: 'var(--fg)', wordBreak: 'break-word', flex: 1 }}>{v}</span>
    </div>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────────

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        color: 'var(--fg-3)',
        fontFamily: 'var(--mono)',
        fontSize: 12,
        gap: 6,
      }}
    >
      <div style={{ color: 'var(--fg-2)', fontSize: 14, fontWeight: 600 }}>{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  )
}
