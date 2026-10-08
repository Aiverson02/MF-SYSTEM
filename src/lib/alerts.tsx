/**
 * Alertas centralizados para a secretaria.
 * Toasts não-bloqueantes + modal de confirmação assíncrono.
 */
import { createRoot, type Root } from 'react-dom/client'
import ToastHost, { pushToast, type ToastKind } from '../components/ToastHost'
import ConfirmHost, { requestConfirm, type ConfirmOptions } from '../components/ConfirmHost'

let initialized = false
let root: Root | null = null

function ensureHosts() {
  if (initialized) return
  const div = document.createElement('div')
  div.dataset.alertsHost = ''
  document.body.appendChild(div)
  root = createRoot(div)
  root.render(
    <>
      <ToastHost />
      <ConfirmHost />
    </>,
  )
  initialized = true
}

export const showSuccess = (msg: string) => {
  ensureHosts()
  pushToast(msg, 'sucesso')
}

export const showError = (msg: string) => {
  ensureHosts()
  pushToast(msg, 'erro')
}

export const showInfo = (msg: string) => {
  ensureHosts()
  pushToast(msg, 'info')
}

export const confirmarAcao = (opts: ConfirmOptions) => {
  ensureHosts()
  return requestConfirm(opts)
}

export { pushToast, type ToastKind }
