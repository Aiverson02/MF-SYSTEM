import { useState } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type Resolver = (ok: boolean) => void

let resolver: Resolver | null = null
let openSetter: ((opts: ConfirmOptions | null) => void) | null = null

/** API imperativa: if (await requestConfirm({...})) ... */
export function requestConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    resolver = resolve
    openSetter?.(opts)
  })
}

export default function ConfirmHost() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  openSetter = setOpts

  const close = (ok: boolean) => {
    resolver?.(ok)
    resolver = null
    setOpts(null)
  }

  if (!opts) return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="alertdialog" aria-modal>
      <div className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-ink">{opts.title}</h3>
        <p className="prose-reading mt-2 whitespace-pre-line text-sm text-ink-muted">{opts.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => close(false)} className="btn-secondary">
            {opts.cancelLabel ?? 'Cancelar'}
          </button>
          <button onClick={() => close(true)} autoFocus className={opts.danger ? 'btn bg-danger text-surface hover:opacity-90' : 'btn-primary'}>
            {opts.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
