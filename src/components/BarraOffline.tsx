import { useEffect, useState } from 'react'
import { pushToast } from './ToastHost'
import {
  getEstadoOffline,
  listarFalhas,
  sincronizarAgora,
  subscreverEstado,
  type EstadoOffline,
} from '../lib/offline'

/**
 * Indicador flutuante (canto inferior esquerdo) do estado de ligação:
 *  - âmbar: offline (dados em cache / alterações pendentes)
 *  - azul:  a sincronizar
 *  - vermelho: falhas de sincronização (toque para ver motivos)
 * Quando tudo está sincronizado e online, não renderiza nada.
 */
export default function BarraOffline() {
  const [estado, setEstado] = useState<EstadoOffline>(getEstadoOffline)

  useEffect(() => subscreverEstado(setEstado), [])

  const oculto =
    estado.online && !estado.sincronizando && estado.pendentes === 0 && estado.falhas === 0
  if (oculto) return null

  let texto: string
  let estilo: string
  let icone: string
  if (!estado.online) {
    icone = '⚡'
    texto = estado.pendentes > 0 ? `Offline · ${estado.pendentes} pendente(s)` : 'Offline — dados em cache'
    estilo = 'bg-warn-soft text-ink'
  } else if (estado.sincronizando) {
    icone = '⟳'
    texto = estado.pendentes > 0 ? `A sincronizar ${estado.pendentes} alteração(ões)…` : 'A sincronizar…'
    estilo = 'bg-accent-soft text-accent-ink'
  } else if (estado.falhas > 0) {
    icone = '✕'
    texto = `${estado.falhas} falha(s) de sincronização`
    estilo = 'bg-danger-soft text-danger'
  } else {
    icone = '⏳'
    texto = `${estado.pendentes} alteração(ões) por sincronizar`
    estilo = 'bg-warn-soft text-ink'
  }

  function clicar() {
    if (!estado.online) {
      pushToast(
        'Sem ligação à internet. As alterações guardadas serão sincronizadas automaticamente quando a ligação voltar.',
        'info',
      )
    } else if (estado.falhas > 0) {
      const motivos = listarFalhas()
        .slice(-3)
        .map((f) => `• ${f.motivo}`)
        .join(' · ')
      pushToast(`Motivos das falhas: ${motivos}`, 'erro')
    } else {
      void sincronizarAgora()
    }
  }

  return (
    <button
      type="button"
      role="status"
      onClick={clicar}
      title="Estado de ligação e sincronização (toque para ver detalhes)"
      className={`fixed bottom-6 left-6 z-[100] pointer-events-auto flex items-center gap-2 rounded-full border border-line px-4 py-2 text-xs font-semibold shadow-lg ${estilo}`}
    >
      <span aria-hidden>{icone}</span>
      <span>{texto}</span>
    </button>
  )
}
