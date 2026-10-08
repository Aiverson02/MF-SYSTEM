import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type ToastKind = 'sucesso' | 'erro' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

type Listener = (t: Toast) => void

const listeners = new Set<Listener>()
let nextId = 1

/** API imperativa: pushToast('mensagem', 'sucesso') de qualquer lugar. */
export function pushToast(message: string, kind: ToastKind = 'info') {
  const toast: Toast = { id: nextId++, kind, message }
  listeners.forEach((l) => l(toast))
}

// Cor apenas na barra lateral esquerda: borda funcional, fundo neutro
const barColor: Record<ToastKind, string> = {
  sucesso: 'bg-ok',
  erro: 'bg-danger',
  info: 'bg-accent',
}

const icons: Record<ToastKind, string> = { sucesso: '✓', erro: '✕', info: 'ℹ' }

function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDone(toast.id), 6000)
    return () => clearTimeout(t)
  }, [toast.id, onDone])

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-80 items-stretch overflow-hidden rounded-lg border border-line bg-surface"
    >
      <span className={`w-1 shrink-0 ${barColor[toast.kind]}`} aria-hidden />
      <div className="flex flex-1 items-start gap-3 px-3 py-2.5">
        <span className={`mt-0.5 text-sm font-semibold ${barColor[toast.kind].replace('bg-', 'text-')}`}>
          {icons[toast.kind]}
        </span>
        <p className="flex-1 text-sm text-ink">{toast.message}</p>
        <button onClick={() => onDone(toast.id)} className="text-sm text-ink-faint hover:text-ink" aria-label="Fechar">
          ✕
        </button>
      </div>
    </div>
  )
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const listener: Listener = (t) => setToasts((prev) => [...prev, t])
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id))

  return createPortal(
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={remove} />
      ))}
    </div>,
    document.body,
  )
}
