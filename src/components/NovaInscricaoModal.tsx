import { useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { Curso } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { LoadingBlock, ErrorMessage } from './ui'
import { pushToast } from './ToastHost'
import InscricaoForm from './InscricaoForm'

export default function NovaInscricaoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  useEscapeKey(onClose)

  const cursosFetcher = useCallback(
    async () =>
      (await supabase.from('cursos').select('*').eq('ativo', true).order('nome')) as {
        data: Curso[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cursos, loading, error, reload } = useAsyncData<Curso[]>(cursosFetcher, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <div className="overlay-in flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-serif text-lg font-semibold text-ink">Nova Inscrição</h3>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Fechar">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <LoadingBlock label="A carregar cursos..." />
          ) : error ? (
            <ErrorMessage message={error} onRetry={() => void reload()} />
          ) : (
            <InscricaoForm
              cursos={cursos ?? []}
              onSucesso={(numeros, falhas) => {
                // Sempre a recarregar a lista; só fecha quando tudo passou —
                // havendo recusa (ex.: limite de 3), o formulário mostra o
                // detalhe curso a curso e o modal fica aberto para corrigir.
                onDone()
                if (falhas.length === 0) {
                  pushToast(
                    `${numeros.length > 1 ? 'Inscrições criadas' : 'Inscrição'} ${numeros.join(', ')} com sucesso.`,
                    'sucesso',
                  )
                  onClose()
                } else {
                  pushToast(
                    `${numeros.length} de ${numeros.length + falhas.length} inscrições criadas (${numeros.join(', ')}). ${falhas.length} recusada(s) — veja o detalhe no formulário.`,
                    'erro',
                  )
                }
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
