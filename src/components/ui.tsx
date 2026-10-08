import type { ReactNode } from 'react'

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin text-accent ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export function LoadingBlock({ label = 'A carregar...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-ink-muted">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span className="text-sm font-medium text-danger">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary">
          Tentar novamente
        </button>
      )}
    </div>
  )
}

export function EmptyState({ message, icon = '📋' }: { message: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span className="text-3xl" aria-hidden>
        {icon}
      </span>
      <p className="text-sm text-ink-muted">{message}</p>
    </div>
  )
}

type BadgeVariant = 'pendente' | 'em_analise' | 'aprovado' | 'rejeitado' | 'com_pendencia' | 'neutro'

/**
 * Estado como dot colorido + texto (cor apenas onde melhora compreensão).
 * Sem fundos grandes coloridos.
 */
const dotColor: Record<BadgeVariant, string> = {
  pendente: 'bg-warn',
  em_analise: 'bg-accent',
  aprovado: 'bg-ok',
  rejeitado: 'bg-danger',
  com_pendencia: 'bg-warn',
  neutro: 'bg-ink-faint',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink">
      <span className={`dot ${dotColor[variant]}`} aria-hidden />
      {children}
    </span>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[24px] leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
