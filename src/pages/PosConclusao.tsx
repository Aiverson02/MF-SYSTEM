import { useCallback, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EstadoItemPos, ItemPosConclusao, PosConclusao } from '../types/database'
import { ESTADO_POS_LABELS, ITEM_POS_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { EmptyState, ErrorMessage, LoadingBlock, PageHeader } from '../components/ui'
import { confirmarAcao, showSuccess } from '../lib/alerts'
import { pushToast } from '../components/ToastHost'
import { format } from '../lib/format'
import { imprimirReciboPos } from '../lib/recibo'

const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', maximumFractionDigits: 0 }).format(v)

type Filtro = 'todos' | ItemPosConclusao | 'por_pagar'

export default function PosConclusaoPage() {
  const [filtro, setFiltro] = useState<Filtro>('todos')

  const fetcher = useCallback(async () => {
    const { data, error } = await supabase
      .from('pos_conclusao')
      .select(
        '*, alunos_matriculados(numero_estudante, numero_bi, inscricoes(nome_completo), turmas(nome_turma))',
      )
      .order('criado_em', { ascending: false })
    return { data: (data ?? []) as PosConclusao[], error }
  }, [])

  const { data: itens, loading, error, reload } = useAsyncData<PosConclusao[]>(fetcher, [])

  const resumo = useMemo(() => {
    const lista = itens ?? []
    const pendentes = lista.filter((i) => i.estado === 'pendente')
    return {
      certPend: pendentes.filter((i) => i.item === 'certificado').length,
      faixaPend: pendentes.filter((i) => i.item === 'faixa').length,
      porPagar: lista.filter((i) => !i.pago && i.estado !== 'entregue'),
      valorAPagar: lista.filter((i) => !i.pago && i.estado !== 'entregue').reduce((s, i) => s + Number(i.valor), 0),
    }
  }, [itens])

  const filtradas = useMemo(() => {
    let base = itens ?? []
    if (filtro === 'certificado' || filtro === 'faixa') base = base.filter((i) => i.item === filtro)
    if (filtro === 'por_pagar') base = base.filter((i) => !i.pago && i.estado !== 'entregue')
    return base
  }, [itens, filtro])

  const marcarPago = async (i: PosConclusao) => {
    const ok = await confirmarAcao({
      title: `Marcar ${ITEM_POS_LABELS[i.item]} como pago`,
      message: `Confirmar pagamento de ${fmtMzn(Number(i.valor))} de ${i.alunos_matriculados?.inscricoes?.nome_completo ?? 'aluno'}?`,
      confirmLabel: 'Confirmar',
    })
    if (!ok) return
    const { error: err } = await supabase.from('pos_conclusao').update({ pago: true }).eq('id', i.id)
    if (err) {
      pushToast(err.message, 'erro')
      return
    }
    pushToast('Pagamento registado.', 'sucesso')
    void reload()
    // Como nas mensalidades: emite o recibo logo após o pagamento ser aceite
    setTimeout(
      () =>
        void imprimirReciboPos({
          ...i,
          pago: true,
          data_pagamento: new Date().toISOString().slice(0, 10),
        }),
      250,
    )
  }

  const avancarEstado = async (i: PosConclusao) => {
    const destino: EstadoItemPos = i.estado === 'pendente' ? 'emitido' : 'entregue'
    const acao = destino === 'emitido' ? 'emitir' : 'entregar'
    const ok = await confirmarAcao({
      title: `${acao.charAt(0).toUpperCase() + acao.slice(1)} ${ITEM_POS_LABELS[i.item]}`,
      message:
        destino === 'emitido'
          ? `Emitir o certificado de ${i.alunos_matriculados?.inscricoes?.nome_completo ?? 'aluno'}?`
          : `Confirmar entrega da ${ITEM_POS_LABELS[i.item].toLowerCase()} a ${i.alunos_matriculados?.inscricoes?.nome_completo ?? 'aluno'}?`,
      confirmLabel: acao.charAt(0).toUpperCase() + acao.slice(1),
    })
    if (!ok) return
    const { error: err } = await supabase
      .from('pos_conclusao')
      .update({ estado: destino, data_entrega: destino === 'entregue' ? new Date().toISOString().slice(0, 10) : null })
      .eq('id', i.id)
    if (err) {
      pushToast(err.message, 'erro')
      return
    }
    showSuccess(
      destino === 'emitido'
        ? 'Item marcado como emitido.'
        : 'Item entregue. O fluxo pós-conclusão deste aluno está completo.',
    )
    void reload()
  }

  return (
    <>
      <PageHeader
        title="Pós-Conclusão"
        subtitle="Certificados e faixas de graduação — alocados automaticamente quando um curso é concluído"
      />

      {/* Resumo */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="cell px-4 py-3">
          <p className="label-section">Certificados pendentes</p>
          <p className={`mt-1 font-serif text-[22px] leading-none tnum ${resumo.certPend > 0 ? 'text-warn' : 'text-ok'}`}>
            {resumo.certPend}
          </p>
        </div>
        <div className="cell px-4 py-3">
          <p className="label-section">Faixas pendentes</p>
          <p className={`mt-1 font-serif text-[22px] leading-none tnum ${resumo.faixaPend > 0 ? 'text-warn' : 'text-ok'}`}>
            {resumo.faixaPend}
          </p>
        </div>
        <div className="cell px-4 py-3">
          <p className="label-section">Por pagar</p>
          <p className="mt-1 font-serif text-[22px] leading-none tnum text-ink">{resumo.porPagar.length}</p>
        </div>
        <div className="cell px-4 py-3">
          <p className="label-section">Valor a receber</p>
          <p className="mt-1 font-serif text-[22px] leading-none tnum text-ink">{fmtMzn(resumo.valorAPagar)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-3 flex w-fit gap-0.5 rounded-md border border-line p-0.5">
        {(
          [
            ['todos', 'Todos'],
            ['certificado', 'Certificados'],
            ['faixa', 'Faixas'],
            ['por_pagar', 'Por pagar'],
          ] as [Filtro, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded px-3 py-1 text-[13px] font-medium ${
              filtro === f ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="cell">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorMessage message={error} onRetry={() => void reload()} />
        ) : filtradas.length === 0 ? (
          <EmptyState
            message="Nenhum item pós-conclusão. Ao concluir um curso na Ficha do Aluno, o certificado e a faixa são alocados automaticamente aqui."
            icon="🎓"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Aluno</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Valor</th>
                  <th className="px-4 py-2.5 font-medium">Pagamento</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtradas.map((i) => {
                  const a = i.alunos_matriculados
                  return (
                    <tr key={i.id} className="hover:bg-canvas">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{a?.inscricoes?.nome_completo ?? '—'}</p>
                        <p className="font-mono text-[11px] text-ink-faint">
                          {a?.numero_estudante}
                          {a?.turmas?.nome_turma ? ` · ${a.turmas.nome_turma}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] ${
                            i.item === 'certificado' ? 'bg-accent-soft text-accent-ink' : 'bg-raised text-ink-muted'
                          }`}
                        >
                          {ITEM_POS_LABELS[i.item]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tnum text-ink">{fmtMzn(Number(i.valor))}</td>
                      <td className="px-4 py-2.5">
                        {i.pago ? (
                          <span className="inline-flex items-center gap-1.5 text-ok">
                            <span className="dot bg-ok" aria-hidden />
                            Pago
                            {i.data_pagamento && (
                              <span className="font-mono text-[11px] text-ink-faint">
                                {format.date(i.data_pagamento)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-warn">
                            <span className="dot bg-warn" aria-hidden />
                            Em dívida
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={`dot ${
                              i.estado === 'entregue' ? 'bg-ok' : i.estado === 'emitido' ? 'bg-accent' : 'bg-warn'
                            }`}
                            aria-hidden
                          />
                          {ESTADO_POS_LABELS[i.estado]}
                          {i.data_entrega && (
                            <span className="font-mono text-[11px] text-ink-faint">{format.date(i.data_entrega)}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          {!i.pago && i.estado !== 'entregue' && (
                            <button onClick={() => void marcarPago(i)} className="btn-primary px-2.5 py-1 text-xs">
                              Marcar pago
                            </button>
                          )}
                          {i.pago && (
                            <button onClick={() => void imprimirReciboPos(i)} className="btn-secondary px-2.5 py-1 text-xs">
                              Recibo
                            </button>
                          )}
                          {i.estado === 'pendente' && (
                            <button onClick={() => void avancarEstado(i)} className="btn-secondary px-2.5 py-1 text-xs">
                              Emitir
                            </button>
                          )}
                          {i.estado === 'emitido' && (
                            <button onClick={() => void avancarEstado(i)} className="btn-primary px-2.5 py-1 text-xs">
                              Entregar
                            </button>
                          )}
                          {i.estado === 'entregue' && (
                            <span className="text-xs text-ok">Concluído ✓</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        O valor do certificado e da faixa é definido em Configurações. O sistema aloca automaticamente os itens quando
        uma matrícula é marcada como concluída.
      </p>
    </>
  )
}
