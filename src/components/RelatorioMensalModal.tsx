import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { Inscricao, Pagamento } from '../types/database'
import {
  ESTADO_LABELS,
  ESTADO_PAGAMENTO_LABELS,
  ITEM_POS_LABELS,
  METODO_LABELS,
  mesLabel,
  type MetodoPagamento,
} from '../types/database'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { Spinner } from './ui'
import { useInstituicao } from '../hooks/useInstituicao'

const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', maximumFractionDigits: 0 }).format(v)

const num = (v: unknown) => Number(v ?? 0)

interface MatriculaMes {
  numero_estudante: string
  nome: string
  curso: string
  turma: string
  data: string
}

interface CobrancaPaga {
  id: string
  nome: string
  aluno: string
  numero: string
  curso: string
  valor: number
  metodo: MetodoPagamento | null
  data: string | null
}

interface PosPago {
  id: string
  item: string
  aluno: string
  numero: string
  valor: number
  data: string | null
}

interface LinhaCurso {
  curso: string
  alunos: number
  esperado: number
  recebido: number
  emFalta: number
}

interface RelatorioData {
  inscricoes: Inscricao[]
  pagamentos: Pagamento[]
  matriculasNoMes: MatriculaMes[]
  cobrancasPagas: CobrancaPaga[]
  cobrancasPendentes: { quantidade: number; valor: number }
  posPagos: PosPago[]
}

/** Data do mês seguinte (exclusive) a partir de 'YYYY-MM-01'. */
function mesSeguinte(mesReferencia: string): string {
  const [y, m] = mesReferencia.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** 'YYYY-MM' → 'YYYY-MM-01' (aceita também 'YYYY-MM-01'). */
const primeiroDiaDe = (mes: string) => `${mes.slice(0, 7)}-01`

export default function RelatorioMensalModal({ mes, onClose }: { mes: string; onClose: () => void }) {
  useEscapeKey(onClose)
  const instituicao = useInstituicao()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [data, setData] = useState<RelatorioData | null>(null)

  const primeiroDia = primeiroDiaDe(mes)
  const seguinte = useMemo(() => mesSeguinte(primeiroDia), [primeiroDia])
  const ultimoDia = useMemo(() => {
    const d = new Date(`${seguinte}T12:00:00`)
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  }, [seguinte])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const [ins, pags, mats, cobPagas, cobPend, pos] = await Promise.all([
      supabase
        .from('inscricoes')
        .select('*, cursos(nome)')
        .gte('created_at', `${primeiroDia}T00:00:00Z`)
        .lt('created_at', `${seguinte}T00:00:00Z`)
        .order('created_at'),
      supabase
        .from('pagamentos')
        .select(
          '*, alunos_matriculados(numero_estudante, inscricoes(nome_completo), turmas(nome_turma, curso_id, cursos(nome)))',
        )
        .eq('mes_referencia', primeiroDia)
        .order('estado'),
      supabase
        .from('alunos_matriculados')
        .select('numero_estudante, data_matricula, inscricoes(nome_completo), turmas(nome_turma, cursos(nome))')
        .gte('data_matricula', primeiroDia)
        .lte('data_matricula', ultimoDia)
        .order('data_matricula'),
      supabase
        .from('cobrancas_alunos')
        .select(
          'id, valor, metodo, data_pagamento, cobrancas(nome), alunos_matriculados(numero_estudante, inscricoes(nome_completo), turmas(cursos(nome)))',
        )
        .eq('estado', 'pago')
        .gte('data_pagamento', primeiroDia)
        .lt('data_pagamento', seguinte)
        .order('data_pagamento'),
      supabase.from('cobrancas_alunos').select('valor').eq('estado', 'pendente'),
      supabase
        .from('pos_conclusao')
        .select(
          'id, item, valor, data_pagamento, alunos_matriculados(numero_estudante, inscricoes(nome_completo))',
        )
        .eq('pago', true)
        .gte('data_pagamento', primeiroDia)
        .lt('data_pagamento', seguinte)
        .order('data_pagamento'),
    ])

    const erroQuery = ins.error ?? pags.error ?? mats.error ?? cobPagas.error ?? cobPend.error ?? pos.error
    if (erroQuery) {
      setErro(erroQuery.message)
      setLoading(false)
      return
    }

    type LinhaBruta = Record<string, unknown>
    const alunoDe = (v: unknown) =>
      (v as { numero_estudante?: string; inscricoes?: { nome_completo?: string } | null } | null) ?? null

    setData({
      inscricoes: (ins.data ?? []) as Inscricao[],
      pagamentos: (pags.data ?? []) as Pagamento[],
      matriculasNoMes: ((mats.data ?? []) as LinhaBruta[]).map((m) => ({
        numero_estudante: String(m.numero_estudante ?? ''),
        nome: String((m.inscricoes as { nome_completo?: string } | null)?.nome_completo ?? '—'),
        curso: String((m.turmas as { cursos?: { nome?: string } | null } | null)?.cursos?.nome ?? '—'),
        turma: String((m.turmas as { nome_turma?: string } | null)?.nome_turma ?? '—'),
        data: String(m.data_matricula ?? ''),
      })),
      cobrancasPagas: ((cobPagas.data ?? []) as LinhaBruta[]).map((c) => {
        const a = alunoDe(c.alunos_matriculados)
        return {
          id: String(c.id),
          nome: String((c.cobrancas as { nome?: string } | null)?.nome ?? 'Cobrança'),
          aluno: a?.inscricoes?.nome_completo ?? '—',
          numero: a?.numero_estudante ?? '',
          curso: String(
            (a as { turmas?: { cursos?: { nome?: string } | null } | null } | null)?.turmas?.cursos?.nome ?? '',
          ),
          valor: num(c.valor),
          metodo: (c.metodo as MetodoPagamento | null) ?? null,
          data: (c.data_pagamento as string | null) ?? null,
        }
      }),
      cobrancasPendentes: {
        quantidade: (cobPend.data ?? []).length,
        valor: (cobPend.data ?? []).reduce((s, l) => s + num(l.valor), 0),
      },
      posPagos: ((pos.data ?? []) as LinhaBruta[]).map((p) => {
        const a = alunoDe(p.alunos_matriculados)
        return {
          id: String(p.id),
          item: ITEM_POS_LABELS[(p.item as 'certificado' | 'faixa') ?? 'certificado'],
          aluno: a?.inscricoes?.nome_completo ?? '—',
          numero: a?.numero_estudante ?? '',
          valor: num(p.valor),
          data: (p.data_pagamento as string | null) ?? null,
        }
      }),
    })
    setLoading(false)
  }, [primeiroDia, seguinte, ultimoDia])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const resumo = useMemo(() => {
    if (!data) return null
    const ins = data.inscricoes
    const mensalidades = data.pagamentos.filter((p) => p.estado !== 'cancelado')
    const esperadoMensalidades = mensalidades.reduce((s, p) => s + num(p.valor), 0)
    const pagas = mensalidades.filter((p) => p.estado === 'pago')
    const recebidoMensalidades = pagas.reduce((s, p) => s + num(p.valor), 0)
    const emFaltaMensalidades = mensalidades
      .filter((p) => p.estado === 'pendente')
      .reduce((s, p) => s + num(p.valor), 0)

    const recebidoCobrancas = data.cobrancasPagas.reduce((s, c) => s + c.valor, 0)
    const recebidoPos = data.posPagos.reduce((s, p) => s + p.valor, 0)

    const porCurso = new Map<string, LinhaCurso>()
    for (const p of mensalidades) {
      const curso = p.alunos_matriculados?.turmas?.cursos?.nome ?? 'Sem curso'
      const linha = porCurso.get(curso) ?? { curso, alunos: 0, esperado: 0, recebido: 0, emFalta: 0 }
      linha.alunos++
      linha.esperado += num(p.valor)
      if (p.estado === 'pago') linha.recebido += num(p.valor)
      if (p.estado === 'pendente') linha.emFalta += num(p.valor)
      porCurso.set(curso, linha)
    }

    const metodos = new Map<string, { quantidade: number; valor: number }>()
    const somarMetodo = (m: MetodoPagamento | null, valor: number) => {
      const chave = m ? METODO_LABELS[m] : 'Não indicado'
      const actual = metodos.get(chave) ?? { quantidade: 0, valor: 0 }
      metodos.set(chave, { quantidade: actual.quantidade + 1, valor: actual.valor + valor })
    }
    for (const p of pagas) somarMetodo(p.metodo, num(p.valor))
    for (const c of data.cobrancasPagas) somarMetodo(c.metodo, c.valor)

    return {
      totalInscricoes: ins.length,
      online: ins.filter((i) => i.origem === 'online').length,
      aprovadas: ins.filter((i) => i.estado === 'aprovado').length,
      rejeitadas: ins.filter((i) => i.estado === 'rejeitado').length,
      matriculas: data.matriculasNoMes.length,
      esperadoMensalidades,
      recebidoMensalidades,
      emFaltaMensalidades,
      taxa: esperadoMensalidades > 0 ? Math.round((recebidoMensalidades / esperadoMensalidades) * 100) : 100,
      nPagas: pagas.length,
      nPendentes: mensalidades.filter((p) => p.estado === 'pendente').length,
      recebidoCobrancas,
      nCobrancasPagas: data.cobrancasPagas.length,
      cobrancasPendentes: data.cobrancasPendentes,
      recebidoPos,
      nPos: data.posPagos.length,
      totalRecebido: recebidoMensalidades + recebidoCobrancas + recebidoPos,
      porReceber: emFaltaMensalidades + data.cobrancasPendentes.valor,
      porCurso: [...porCurso.values()].sort((a, b) => a.curso.localeCompare(b.curso)),
      metodos: [...metodos.entries()].sort((a, b) => b[1].valor - a[1].valor),
    }
  }, [data])

  const exportarCsv = () => {
    if (!data || !resumo) return
    const linhas: (string | number)[][] = []
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    linhas.push(['Relatório mensal — ' + instituicao.nome])
    linhas.push(['Período', mesLabel(primeiroDia)])
    linhas.push(['Gerado em', new Date().toLocaleString('pt-PT')])
    linhas.push([])

    linhas.push(['Resumo geral'])
    linhas.push(['Inscrições no mês', resumo.totalInscricoes, '— pelo site', resumo.online])
    linhas.push(['Matrículas no mês', resumo.matriculas])
    linhas.push(['Mensalidades esperadas', resumo.esperadoMensalidades])
    linhas.push(['Mensalidades recebidas', resumo.recebidoMensalidades])
    linhas.push(['Mensalidades em falta', resumo.emFaltaMensalidades])
    linhas.push(['Taxa de cobrança', resumo.taxa + '%'])
    linhas.push(['Cobranças avulsas recebidas', resumo.recebidoCobrancas, 'pagas', resumo.nCobrancasPagas])
    linhas.push(['Cobranças avulsas pendentes', resumo.cobrancasPendentes.valor, 'registos', resumo.cobrancasPendentes.quantidade])
    linhas.push(['Certificados/faixas recebidos', resumo.recebidoPos, 'itens', resumo.nPos])
    linhas.push(['TOTAL RECEBIDO', resumo.totalRecebido])
    linhas.push(['TOTAL POR RECEBER', resumo.porReceber])
    linhas.push([])

    linhas.push(['Mensalidades por curso'])
    linhas.push(['Curso', 'Alunos', 'Esperado', 'Recebido', 'Em falta', 'Taxa'])
    for (const c of resumo.porCurso) {
      linhas.push([
        c.curso,
        c.alunos,
        c.esperado,
        c.recebido,
        c.emFalta,
        c.esperado > 0 ? Math.round((c.recebido / c.esperado) * 100) + '%' : '100%',
      ])
    }
    linhas.push([])

    linhas.push(['Recebimentos por método'])
    linhas.push(['Método', 'Operações', 'Valor'])
    for (const [metodo, v] of resumo.metodos) linhas.push([metodo, v.quantidade, v.valor])
    linhas.push([])

    linhas.push(['Cobranças avulsas pagas no mês'])
    linhas.push(['Data', 'Aluno', 'Nº estudante', 'Curso', 'Cobrança', 'Método', 'Valor'])
    for (const c of data.cobrancasPagas) {
      linhas.push([c.data ?? '', c.aluno, c.numero, c.curso, c.nome, c.metodo ? METODO_LABELS[c.metodo] : '', c.valor])
    }
    linhas.push([])

    linhas.push(['Certificados e faixas pagos no mês'])
    linhas.push(['Data', 'Aluno', 'Nº estudante', 'Item', 'Valor'])
    for (const p of data.posPagos) linhas.push([p.data ?? '', p.aluno, p.numero, p.item, p.valor])
    linhas.push([])

    linhas.push(['Mensalidades do mês'])
    linhas.push(['Referência', 'Aluno', 'Nº estudante', 'Turma', 'Curso', 'Valor', 'Estado', 'Método', 'Data'])
    for (const p of data.pagamentos) {
      linhas.push([
        mesLabel(p.mes_referencia),
        p.alunos_matriculados?.inscricoes?.nome_completo ?? '',
        p.alunos_matriculados?.numero_estudante ?? '',
        p.alunos_matriculados?.turmas?.nome_turma ?? '',
        p.alunos_matriculados?.turmas?.cursos?.nome ?? '',
        num(p.valor),
        ESTADO_PAGAMENTO_LABELS[p.estado],
        p.metodo ? METODO_LABELS[p.metodo] : '',
        p.data_pagamento ?? '',
      ])
    }
    linhas.push([])

    linhas.push(['Matrículas do mês'])
    linhas.push(['Data', 'Nº de estudante', 'Nome', 'Curso', 'Turma'])
    for (const m of data.matriculasNoMes) linhas.push([m.data, m.numero_estudante, m.nome, m.curso, m.turma])
    linhas.push([])

    linhas.push(['Inscrições do mês'])
    linhas.push(['Número', 'Data', 'Candidato', 'Curso', 'Origem', 'Estado'])
    for (const i of data.inscricoes) {
      linhas.push([
        i.numero_inscricao,
        i.created_at.slice(0, 10),
        i.nome_completo,
        i.cursos?.nome ?? '',
        i.origem,
        ESTADO_LABELS[i.estado],
      ])
    }

    const csv = linhas.map((r) => r.map(esc).join(';')).join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `relatorio-mensal-${primeiroDia.slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink">Relatório mensal</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {instituicao.nome} · {mesLabel(primeiroDia)}
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
          <div className="mt-4">
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>
            <button onClick={() => void carregar()} className="btn-secondary mt-3">
              Tentar novamente
            </button>
          </div>
        ) : (
          data &&
          resumo && (
            <>
              {/* Totais principais */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Inscrições</p>
                  <p className="mt-1 font-serif text-xl tnum">{resumo.totalInscricoes}</p>
                  <p className="text-[11px] text-ink-faint">{resumo.online} pelo site</p>
                </div>
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Matrículas</p>
                  <p className="mt-1 font-serif text-xl tnum">{resumo.matriculas}</p>
                </div>
                <div className="rounded-md border border-line px-3 py-2.5">
                  <p className="label-section">Total recebido</p>
                  <p className="mt-1 font-serif text-xl tnum text-ok">{fmtMzn(resumo.totalRecebido)}</p>
                  <p className="text-[11px] text-ink-faint">mensalidades + cobranças + pós-conclusão</p>
                </div>
              </div>

              {/* Mensalidades */}
              <p className="label-section mt-5 mb-2">Mensalidades de {mesLabel(primeiroDia)}</p>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-ink-faint">Esperado</p>
                  <p className="tnum">{fmtMzn(resumo.esperadoMensalidades)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Recebido</p>
                  <p className="tnum text-ok">{fmtMzn(resumo.recebidoMensalidades)}</p>
                  <p className="text-[11px] text-ink-faint">
                    {resumo.nPagas} paga(s) · {resumo.nPendentes} pendente(s)
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Em falta</p>
                  <p className={`tnum ${resumo.emFaltaMensalidades > 0 ? 'text-warn' : ''}`}>
                    {fmtMzn(resumo.emFaltaMensalidades)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Taxa de cobrança</p>
                  <p className="tnum">{resumo.taxa}%</p>
                </div>
              </div>

              {/* Por curso */}
              <p className="label-section mt-5 mb-2">Mensalidades por curso</p>
              {resumo.porCurso.length === 0 ? (
                <p className="text-xs text-ink-faint">Sem mensalidades geradas neste mês.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-canvas">
                      <tr className="border-b border-line text-[10px] uppercase tracking-[0.05em] text-ink-faint">
                        <th className="px-3 py-2 font-medium">Curso</th>
                        <th className="px-3 py-2 font-medium text-right">Alunos</th>
                        <th className="px-3 py-2 font-medium text-right">Esperado</th>
                        <th className="px-3 py-2 font-medium text-right">Recebido</th>
                        <th className="px-3 py-2 font-medium text-right">Em falta</th>
                        <th className="px-3 py-2 font-medium text-right">Taxa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {resumo.porCurso.map((c) => (
                        <tr key={c.curso}>
                          <td className="px-3 py-1.5 text-ink">{c.curso}</td>
                          <td className="px-3 py-1.5 tnum text-right text-ink-muted">{c.alunos}</td>
                          <td className="px-3 py-1.5 tnum text-right text-ink-muted">{fmtMzn(c.esperado)}</td>
                          <td className="px-3 py-1.5 tnum text-right text-ok">{fmtMzn(c.recebido)}</td>
                          <td className={`px-3 py-1.5 tnum text-right ${c.emFalta > 0 ? 'text-warn' : 'text-ink-muted'}`}>
                            {fmtMzn(c.emFalta)}
                          </td>
                          <td className="px-3 py-1.5 tnum text-right text-ink-muted">
                            {c.esperado > 0 ? Math.round((c.recebido / c.esperado) * 100) : 100}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-canvas font-medium">
                        <td className="px-3 py-1.5 text-ink">Total</td>
                        <td className="px-3 py-1.5 tnum text-right text-ink">
                          {resumo.porCurso.reduce((s, c) => s + c.alunos, 0)}
                        </td>
                        <td className="px-3 py-1.5 tnum text-right text-ink">{fmtMzn(resumo.esperadoMensalidades)}</td>
                        <td className="px-3 py-1.5 tnum text-right text-ok">{fmtMzn(resumo.recebidoMensalidades)}</td>
                        <td className="px-3 py-1.5 tnum text-right text-ink">{fmtMzn(resumo.emFaltaMensalidades)}</td>
                        <td className="px-3 py-1.5 tnum text-right text-ink">{resumo.taxa}%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Cobranças avulsas */}
              <p className="label-section mt-5 mb-2">Cobranças avulsas (testes, material, exame)</p>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-ink-faint">Recebido no mês</p>
                  <p className="tnum text-ok">{fmtMzn(resumo.recebidoCobrancas)}</p>
                  <p className="text-[11px] text-ink-faint">{resumo.nCobrancasPagas} cobrança(s) paga(s)</p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Pendente (acumulado)</p>
                  <p className={`tnum ${resumo.cobrancasPendentes.valor > 0 ? 'text-warn' : ''}`}>
                    {fmtMzn(resumo.cobrancasPendentes.valor)}
                  </p>
                  <p className="text-[11px] text-ink-faint">{resumo.cobrancasPendentes.quantidade} por pagar</p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Total por receber</p>
                  <p className="tnum">{fmtMzn(resumo.porReceber)}</p>
                  <p className="text-[11px] text-ink-faint">mensalidades do mês + cobranças</p>
                </div>
              </div>

              {data.cobrancasPagas.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-line">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-canvas">
                      <tr className="border-b border-line text-[10px] uppercase tracking-[0.05em] text-ink-faint">
                        <th className="px-3 py-1.5 font-medium">Data</th>
                        <th className="px-3 py-1.5 font-medium">Aluno</th>
                        <th className="px-3 py-1.5 font-medium">Cobrança</th>
                        <th className="px-3 py-1.5 font-medium">Método</th>
                        <th className="px-3 py-1.5 font-medium text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.cobrancasPagas.map((c) => (
                        <tr key={c.id}>
                          <td className="px-3 py-1.5 tnum text-ink-faint">{c.data ?? ''}</td>
                          <td className="px-3 py-1.5 text-ink">{c.aluno}</td>
                          <td className="px-3 py-1.5 text-ink-muted">{c.nome}</td>
                          <td className="px-3 py-1.5 text-ink-muted">{c.metodo ? METODO_LABELS[c.metodo] : ''}</td>
                          <td className="px-3 py-1.5 tnum text-right text-ink">{fmtMzn(c.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pós-conclusão */}
              <p className="label-section mt-5 mb-2">Certificados e faixas pagos no mês</p>
              {data.posPagos.length === 0 ? (
                <p className="text-xs text-ink-faint">Nenhum item de pós-conclusão pago neste mês.</p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="tnum text-ok">{fmtMzn(resumo.recebidoPos)}</span>
                    <span className="text-ink-faint"> · {resumo.nPos} item(ns)</span>
                  </p>
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-line">
                    <table className="w-full text-left text-[12px]">
                      <tbody className="divide-y divide-line">
                        {data.posPagos.map((p) => (
                          <tr key={p.id}>
                            <td className="px-3 py-1.5 tnum text-ink-faint">{p.data ?? ''}</td>
                            <td className="px-3 py-1.5 text-ink">{p.aluno}</td>
                            <td className="px-3 py-1.5 font-mono text-[11px] text-ink-muted">{p.numero}</td>
                            <td className="px-3 py-1.5 text-ink-muted">{p.item}</td>
                            <td className="px-3 py-1.5 tnum text-right text-ink">{fmtMzn(p.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Métodos */}
              <p className="label-section mt-5 mb-2">Recebimentos por método</p>
              {resumo.metodos.length === 0 ? (
                <p className="text-xs text-ink-faint">Nenhum recebimento neste mês.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {resumo.metodos.map(([metodo, v]) => (
                    <span key={metodo} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink">
                      {metodo}: <strong className="tnum">{fmtMzn(v.valor)}</strong>{' '}
                      <span className="text-ink-faint">({v.quantidade})</span>
                    </span>
                  ))}
                </div>
              )}

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

              {/* Matrículas */}
              <p className="label-section mt-5 mb-2">Matrículas do mês ({resumo.matriculas})</p>
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

              {/* Fecho */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-3 text-sm">
                <p>
                  <span className="label-section">Total recebido</span>
                  <span className="ml-2 font-serif text-lg tnum text-ok">{fmtMzn(resumo.totalRecebido)}</span>
                </p>
                <p>
                  <span className="label-section">Total por receber</span>
                  <span className="ml-2 font-serif text-lg tnum text-warn">{fmtMzn(resumo.porReceber)}</span>
                </p>
                <p>
                  <span className="label-section">Previsão</span>
                  <span className="ml-2 font-serif text-lg tnum text-ink">
                    {fmtMzn(resumo.totalRecebido + resumo.porReceber)}
                  </span>
                </p>
              </div>
            </>
          )
        )}

        <div className="mt-6 flex gap-2 border-t border-line pt-4">
          <button onClick={exportarCsv} disabled={!data || loading} className="btn-primary flex-1">
            Exportar CSV
          </button>
          <button onClick={() => window.print()} disabled={!data || loading} className="btn-secondary flex-1">
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
