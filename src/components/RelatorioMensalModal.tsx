import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { Inscricao, Pagamento } from '../types/database'
import { ESTADO_LABELS, ESTADO_PAGAMENTO_LABELS, mesLabel } from '../types/database'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { Spinner } from './ui'
import { useInstituicao } from '../hooks/useInstituicao'

const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', maximumFractionDigits: 0 }).format(v)

interface RelatorioData {
  inscricoes: Inscricao[]
  pagamentos: Pagamento[]
  matriculasNoMes: { numero_estudante: string; nome: string; curso: string; data: string }[]
}

export default function RelatorioMensalModal({ mes, onClose }: { mes: string; onClose: () => void }) {
  useEscapeKey(onClose)
  const instituicao = useInstituicao()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [data, setData] = useState<RelatorioData | null>(null)

  const primeiroDia = `${mes}-01`
  const ultimoDia = useMemo(() => {
    const [y, m] = mes.split('-').map(Number)
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  }, [mes])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const [ins, pags, mats] = await Promise.all([
      supabase
        .from('inscricoes')
        .select('*, cursos(nome)')
        .gte('created_at', `${primeiroDia}T00:00:00Z`)
        .lte('created_at', `${ultimoDia}T23:59:59Z`)
        .order('created_at'),
      supabase
        .from('pagamentos')
        .select('*, alunos_matriculados(numero_estudante, inscricoes(nome_completo), turmas(nome_turma))')
        .eq('mes_referencia', primeiroDia)
        .order('estado'),
      supabase
        .from('alunos_matriculados')
        .select('numero_estudante, data_matricula, inscricoes(nome_completo), turmas(nome_turma, cursos(nome))')
        .gte('data_matricula', primeiroDia)
        .lte('data_matricula', ultimoDia)
        .order('data_matricula'),
    ])
    if (ins.error || pags.error || mats.error) {
      setErro(ins.error?.message ?? pags.error?.message ?? mats.error?.message ?? 'Erro ao carregar dados.')
      setLoading(false)
      return
    }
    setData({
      inscricoes: (ins.data ?? []) as Inscricao[],
      pagamentos: (pags.data ?? []) as Pagamento[],
      matriculasNoMes: ((mats.data ?? []) as Record<string, unknown>[]).map((m) => ({
        numero_estudante: String(m.numero_estudante),
        nome: String((m.inscricoes as { nome_completo?: string } | null)?.nome_completo ?? '—'),
        curso:
          String(
            ((m.turmas as { cursos?: { nome?: string } | null } | null)?.cursos?.nome) ??
              ((m.turmas as { nome_turma?: string } | null)?.nome_turma ?? '—'),
          ),
        data: String(m.data_matricula),
      })),
    })
    setLoading(false)
  }, [primeiroDia, ultimoDia])

  // Carrega ao abrir (useEffect — nunca disparar fetch durante o render)
  useEffect(() => {
    void carregar()
  }, [carregar])

  const kpis = useMemo(() => {
    if (!data) return null
    const ins = data.inscricoes
    const activos = data.pagamentos.filter((p) => p.estado !== 'cancelado')
    const esperado = activos.reduce((s, p) => s + Number(p.valor), 0)
    const recebido = activos.filter((p) => p.estado === 'pago').reduce((s, p) => s + Number(p.valor), 0)
    return {
      totalInscricoes: ins.length,
      online: ins.filter((i) => i.origem === 'online').length,
      aprovadas: ins.filter((i) => i.estado === 'aprovado').length,
      rejeitadas: ins.filter((i) => i.estado === 'rejeitado').length,
      matriculas: data.matriculasNoMes.length,
      esperado,
      recebido,
      emFalta: esperado - recebido,
      taxa: esperado > 0 ? Math.round((recebido / esperado) * 100) : 100,
    }
  }, [data])

  const exportarCsv = () => {
    if (!data || !kpis) return
    // CSV composto: bloco de KPIs + inscrições + matrículas + pagamentos
    const linhas: (string | number)[][] = []
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    linhas.push(['Relatório mensal — ' + instituicao.nome])
    linhas.push(['Período', mesLabel(`${mes}-01`)])
    linhas.push([])
    linhas.push(['KPIs'])
    linhas.push(['Inscrições no mês', kpis.totalInscricoes])
    linhas.push(['— submetidas pelo site', kpis.online])
    linhas.push(['— aprovadas', kpis.aprovadas])
    linhas.push(['— rejeitadas', kpis.rejeitadas])
    linhas.push(['Matrículas no mês', kpis.matriculas])
    linhas.push(['Mensalidades esperadas', fmtMzn(kpis.esperado)])
    linhas.push(['Mensalidades recebidas', fmtMzn(kpis.recebido)])
    linhas.push(['Em falta', fmtMzn(kpis.emFalta)])
    linhas.push(['Taxa de cobrança', kpis.taxa + '%'])
    linhas.push([])
    linhas.push(['Inscrições'])
    linhas.push(['Número', 'Data', 'Candidato', 'Curso', 'Origem', 'Estado'])
    for (const i of data.inscricoes) {
      linhas.push([i.numero_inscricao, i.created_at.slice(0, 10), i.nome_completo, i.cursos?.nome ?? '', i.origem, ESTADO_LABELS[i.estado]])
    }
    linhas.push([])
    linhas.push(['Matrículas'])
    linhas.push(['Data', 'Nº de estudante', 'Nome', 'Curso'])
    for (const m of data.matriculasNoMes) {
      linhas.push([m.data, m.numero_estudante, m.nome, m.curso])
    }
    linhas.push([])
    linhas.push(['Mensalidades'])
    linhas.push(['Referência', 'Aluno', 'Nº estudante', 'Valor', 'Estado', 'Método'])
    for (const p of data.pagamentos) {
      linhas.push([
        mesLabel(p.mes_referencia),
        p.alunos_matriculados?.inscricoes?.nome_completo ?? '',
        p.alunos_matriculados?.numero_estudante ?? '',
        Number(p.valor),
        ESTADO_PAGAMENTO_LABELS[p.estado],
        p.metodo ?? '',
      ])
    }
    const csv = linhas.map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `relatorio-mensal-${mes}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const imprimir = () => window.print()

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink">Relatório mensal</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {instituicao.nome} · {mesLabel(`${mes}-01`)}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 text-ink-muted hover:text-ink" aria-label="Fechar">
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-ink-muted">
            <Spinner /> <span className="text-sm">A gerar relatório...</span>
          </div>
        ) : erro ? (
          <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>
        ) : (
          data &&
          kpis && (
            <>
              {/* KPIs */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Inscrições</p>
                  <p className="mt-1 font-serif text-xl tnum">{kpis.totalInscricoes}</p>
                  <p className="text-[11px] text-ink-faint">{kpis.online} pelo site</p>
                </div>
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Matrículas</p>
                  <p className="mt-1 font-serif text-xl tnum">{kpis.matriculas}</p>
                </div>
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Recebido</p>
                  <p className="mt-1 font-serif text-xl tnum text-ok">{fmtMzn(kpis.recebido)}</p>
                </div>
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Taxa cobrança</p>
                  <p className="mt-1 font-serif text-xl tnum">{kpis.taxa}%</p>
                </div>
              </div>

              {/* Inscrições por estado */}
              <p className="label-section mt-5 mb-2">Inscrições por estado</p>
              <div className="flex flex-wrap gap-2">
                {(['pendente', 'em_analise', 'aprovado', 'rejeitado', 'com_pendencia'] as const).map((e) => {
                  const n = data.inscricoes.filter((i) => i.estado === e).length
                  if (n === 0) return null
                  return (
                    <span key={e} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink">
                      {ESTADO_LABELS[e]}: <strong className="tnum">{n}</strong>
                    </span>
                  )
                })}
                {data.inscricoes.length === 0 && <p className="text-xs text-ink-faint">Sem inscrições neste mês.</p>}
              </div>

              {/* Mensalidades */}
              <p className="label-section mt-5 mb-2">Mensalidades</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-ink-faint">Esperado</p>
                  <p className="tnum">{fmtMzn(kpis.esperado)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Recebido</p>
                  <p className="tnum text-ok">{fmtMzn(kpis.recebido)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Em falta</p>
                  <p className={`tnum ${kpis.emFalta > 0 ? 'text-warn' : ''}`}>{fmtMzn(kpis.emFalta)}</p>
                </div>
              </div>

              {/* Matrículas */}
              <p className="label-section mt-5 mb-2">Matrículas do mês ({kpis.matriculas})</p>
              {data.matriculasNoMes.length === 0 ? (
                <p className="text-xs text-ink-faint">Nenhuma matrícula neste mês.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-md border border-line">
                  <table className="w-full text-left text-[13px]">
                    <tbody className="divide-y divide-line">
                      {data.matriculasNoMes.map((m) => (
                        <tr key={m.numero_estudante}>
                          <td className="px-3 py-2 font-medium text-ink">{m.nome}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{m.numero_estudante}</td>
                          <td className="px-3 py-2 text-ink-muted">{m.curso}</td>
                          <td className="px-3 py-2 tnum text-ink-faint">{m.data}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        )}

        <div className="mt-6 flex gap-2 border-t border-line pt-4">
          <button onClick={exportarCsv} disabled={!data || loading} className="btn-primary flex-1">
            Exportar CSV
          </button>
          <button onClick={imprimir} disabled={!data || loading} className="btn-secondary flex-1">
            Imprimir
          </button>
          <button onClick={onClose} className="btn-secondary">
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
