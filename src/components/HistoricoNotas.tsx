import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { HistoricoNota } from '../types/database'
import { ACCAO_NOTA_LABELS, notaLabel } from '../types/database'
import { Badge, EmptyState, ErrorMessage, LoadingBlock } from './ui'
import { useAsyncData } from '../hooks/useAsyncData'
import { format } from '../lib/format'

/**
 * Rasto de todas as alterações às notas de um aluno (quem, quando, de que
 * valor para que valor). Vem da RPC `historico_notas_aluno`, que só responde
 * a staff — a tabela `notas_historico` não tem grants nem policies, por isso o
 * rasto não é editável nem legível directamente.
 */

const VARIANTE: Record<HistoricoNota['accao'], 'em_analise' | 'neutro' | 'rejeitado'> = {
  insert: 'em_analise',
  update: 'neutro',
  delete: 'rejeitado',
}

export default function HistoricoNotas({ alunoId }: { alunoId: string }) {
  const [aberto, setAberto] = useState(false)

  const fetcher = useCallback(async () => {
    if (!aberto) return { data: [] as HistoricoNota[], error: null }
    const { data, error } = await supabase.rpc('historico_notas_aluno', { p_aluno_id: alunoId })
    return { data: (data as HistoricoNota[] | null) ?? [], error }
  }, [aberto, alunoId])

  const { data, loading, error, reload } = useAsyncData<HistoricoNota[]>(fetcher, [aberto, alunoId])

  const linhas = data ?? []

  return (
    <div className="cell mt-3">
      <div className="cell-head">
        <div>
          <p className="label-section">Histórico de alterações às notas</p>
          <p className="mt-0.5 text-xs text-ink-faint">Quem lançou, quem corrigiu e de que valor para que valor</p>
        </div>
        <button
          onClick={() => setAberto((v) => !v)}
          className="btn-ghost px-2 py-1 text-[13px]"
          aria-expanded={aberto}
        >
          {aberto ? 'Ocultar' : 'Ver histórico'}
        </button>
      </div>

      {aberto &&
        (loading ? (
          <LoadingBlock label="A carregar histórico..." />
        ) : error ? (
          <ErrorMessage message={error} onRetry={() => void reload()} />
        ) : linhas.length === 0 ? (
          <EmptyState message="Ainda não há alterações registadas para este aluno." icon="🕘" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-4 py-2.5 font-medium">Acção</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Antes</th>
                  <th className="px-4 py-2.5 font-medium">Depois</th>
                  <th className="px-4 py-2.5 font-medium">Autor</th>
                  <th className="px-4 py-2.5 font-medium">Formador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {linhas.map((h, i) => (
                  <tr key={`${h.quando}-${h.item}-${i}`}>
                    <td className="tnum px-4 py-2.5 text-ink-muted">{format.dateTime(h.quando)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={VARIANTE[h.accao]}>{ACCAO_NOTA_LABELS[h.accao]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{h.item}</td>
                    <td className="tnum px-4 py-2.5 text-ink-muted">{notaLabel(h.nota_anterior)}</td>
                    <td className="tnum px-4 py-2.5 font-medium text-ink">{notaLabel(h.nota_nova)}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{h.autor}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{h.formador}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  )
}
