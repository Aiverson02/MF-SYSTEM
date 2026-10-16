import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { PautaFormador } from '../../types/database'
import { ESTADO_PAUTA_LABELS, TIPO_AVALIACAO_LABELS, TURNO_LABELS } from '../../types/database'
import { Badge, EmptyState, ErrorMessage, LoadingBlock } from '../../components/ui'
import { useAsyncData } from '../../hooks/useAsyncData'
import { exportToCsv, nomeFicheiro } from '../../lib/exportCsv'
import { showSuccess } from '../../lib/alerts'
import { format } from '../../lib/format'

/**
 * O que o formador tem para preencher: uma linha por item (avaliação, exame ou
 * recurso) que a secretaria abriu. Os dados vêm da RPC `pautas_do_formador`,
 * que só devolve as turmas atribuídas a este formador.
 */
export default function MinhasPautas() {
  const fetcher = useCallback(async () => {
    const { data, error } = await supabase.rpc('pautas_do_formador')
    return { data: (data as PautaFormador[] | null) ?? null, error }
  }, [])

  const { data: pautas, loading, error, reload } = useAsyncData<PautaFormador[]>(fetcher, [])

  const porTurma = (pautas ?? []).reduce<Record<string, PautaFormador[]>>((acc, p) => {
    const chave = `${p.ano_lectivo}·${p.curso}·${p.turma}·${p.turno}`
    ;(acc[chave] ??= []).push(p)
    return acc
  }, {})

  if (loading) return <LoadingBlock label="A carregar as suas pautas..." />
  if (error) return <ErrorMessage message={error} onRetry={() => void reload()} />

  /** As suas pautas em CSV (mesma informação que aparece na lista). */
  const exportar = () => {
    exportToCsv<PautaFormador>(
      nomeFicheiro('minhas_pautas'),
      [
        { header: 'Curso', value: (p) => p.curso },
        { header: 'Turma', value: (p) => p.turma },
        { header: 'Turno', value: (p) => TURNO_LABELS[p.turno] },
        { header: 'Ano lectivo', value: (p) => String(p.ano_lectivo) },
        { header: 'Item', value: (p) => p.item },
        { header: 'Tipo', value: (p) => TIPO_AVALIACAO_LABELS[p.tipo] },
        { header: 'Peso', value: (p) => String(p.peso).replace('.', ',') },
        { header: 'Escala', value: (p) => String(p.nota_maxima).replace('.', ',') },
        { header: 'Estado', value: (p) => ESTADO_PAUTA_LABELS[p.estado as 'aberta' | 'fechada'] },
        { header: 'Notas lançadas', value: (p) => `${p.notas_lancadas}/${p.total_alunos}` },
        { header: 'Prazo', value: (p) => (p.prazo ? format.date(p.prazo) : '') },
      ],
      pautas ?? [],
    )
    showSuccess('Pautas exportadas em CSV.')
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] leading-tight text-ink">As minhas pautas</h1>
          <p className="mt-1 text-sm text-ink-muted">
            A secretaria abre cada pauta; aqui lança e corrige as notas enquanto estiver aberta.
          </p>
        </div>
        {(pautas ?? []).length > 0 && (
          <button onClick={exportar} className="btn-secondary px-3 py-1.5 text-[13px]">
            Exportar CSV
          </button>
        )}
      </div>

      {(pautas ?? []).length === 0 ? (
        <div className="cell mt-5">
          <EmptyState
            message="Ainda não tem pautas atribuídas. Assim que a secretaria abrir uma pauta das suas turmas, ela aparece aqui."
            icon="📋"
          />
        </div>
      ) : (
        Object.entries(porTurma).map(([chave, itens]) => (
          <div key={chave} className="cell mt-5">
            <div className="cell-head">
              <div>
                <p className="label-section">
                  {itens[0].curso} — {itens[0].turma}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {TURNO_LABELS[itens[0].turno]} · {itens[0].ano_lectivo}
                </p>
              </div>
              <span className="tnum text-[13px] text-ink-muted">{itens[0].total_alunos} alunos</span>
            </div>

            <div className="divide-y divide-line">
              {itens.map((p) => {
                const progresso = p.total_alunos > 0 ? Math.round((p.notas_lancadas / p.total_alunos) * 100) : 0
                return (
                  <Link
                    key={p.pauta_id}
                    to={`/formador/pauta/${p.turma_id}/${p.avaliacao_id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-ink">{p.item}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {TIPO_AVALIACAO_LABELS[p.tipo]} · peso {String(p.peso).replace('.', ',')} · escala{' '}
                        {String(p.nota_maxima).replace('.', ',')}
                        {p.prazo ? ` · prazo ${format.date(p.prazo)}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tnum text-[13px] text-ink-muted">
                        {p.notas_lancadas}/{p.total_alunos}
                      </span>
                      {p.estado === 'fechada' ? (
                        <Badge variant="neutro">{ESTADO_PAUTA_LABELS.fechada}</Badge>
                      ) : p.pode_editar ? (
                        <Badge variant="em_analise">{progresso === 100 ? 'Completa' : 'Aberta'}</Badge>
                      ) : (
                        <Badge variant="rejeitado">Prazo terminado</Badge>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        ))
      )}
    </>
  )
}
