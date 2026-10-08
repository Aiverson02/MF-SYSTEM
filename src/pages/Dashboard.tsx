import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Inscricao, Pagamento, Turma } from '../types/database'
import { ESTADO_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { Badge, ErrorMessage } from '../components/ui'
import { format } from '../lib/format'
import RelatorioMensalModal from '../components/RelatorioMensalModal'

interface DashboardData {
  aprovadasMes: number
  matriculas: number
  concluidos: number
  turmas: (Turma & { cursos?: { nome: string } | null })[]
  recentes: Inscricao[]
  inscricoesMes: { total: number; online: number }
  pagamentos: Pagamento[]
  /** pendências visíveis sem entrar nas finanças: documentos por validar */
  docsPendentes: number
}

const inicioMes = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}
const mesActualDia1 = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', maximumFractionDigits: 0 }).format(v)

function Cell({ label, action, children }: { label?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="cell flex min-w-0 flex-col">
      {label && (
        <div className="cell-head">
          <p className="label-section">{label}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function Kpi({
  label,
  value,
  apoio,
  tone = 'text-ink',
  barra,
}: {
  label: string
  value: string
  apoio?: string
  tone?: string
  barra?: { pct: number; cor: string }
}) {
  return (
    <div className="cell min-w-0 px-4 py-3.5">
      <p className="label-section">{label}</p>
      <p className={`mt-1.5 font-serif text-[28px] leading-none tnum ${tone}`}>{value}</p>
      {barra && (
        <div className="mt-2.5 h-1 rounded-full bg-raised">
          <div className={`h-full rounded-full ${barra.cor}`} style={{ width: `${Math.min(barra.pct, 100)}%` }} />
        </div>
      )}
      {apoio && <p className="mt-2 truncate text-xs text-ink-faint">{apoio}</p>}
    </div>
  )
}

function OrigemTag({ origem }: { origem: 'online' | 'presencial' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] ${
        origem === 'online' ? 'bg-accent-soft text-accent-ink' : 'bg-raised text-ink-muted'
      }`}
    >
      {origem === 'online' ? 'Site' : 'Presencial'}
    </span>
  )
}

export default function Dashboard() {
  const [collapsed, setCollapsed] = useState(false)
  const [relatorioAberto, setRelatorioAberto] = useState(false)

  const fetcher = useCallback(async (): Promise<{ data: DashboardData | null; error: { message: string } | null }> => {
    const [docsPend, aprovMes, alunos, turmas, recentes, todas, pagsMes] = await Promise.all([
      supabase.from('documentos_inscricao').select('id', { count: 'exact', head: true }).eq('estado_validacao', false),
      supabase
        .from('inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'aprovado')
        .gte('created_at', inicioMes()),
      supabase.from('alunos_matriculados').select('estado_aluno'),
      supabase.from('turmas').select('*, cursos(nome)').order('nome_turma'),
      supabase.from('inscricoes').select('*, cursos(nome, codigo)').order('created_at', { ascending: false }).limit(6),
      supabase.from('inscricoes').select('estado, origem, created_at').gte('created_at', inicioMes()),
      supabase.from('pagamentos').select('*').eq('mes_referencia', mesActualDia1()),
    ])

    const err = docsPend.error ?? aprovMes.error ?? alunos.error ?? turmas.error ?? recentes.error ?? todas.error ?? pagsMes.error
    if (err) return { data: null, error: { message: err.message } }

    const listaAlunos = (alunos.data ?? []) as { estado_aluno: string }[]
    let online = 0
    for (const i of (todas.data ?? []) as { origem: string }[]) {
      if (i.origem === 'online') online++
    }

    return {
      data: {
        aprovadasMes: aprovMes.count ?? 0,
        matriculas: listaAlunos.filter((a) => a.estado_aluno === 'ativo').length,
        concluidos: listaAlunos.filter((a) => a.estado_aluno === 'concluido').length,
        turmas: (turmas.data ?? []) as (Turma & { cursos?: { nome: string } | null })[],
        recentes: (recentes.data ?? []) as Inscricao[],
        inscricoesMes: { total: (todas.data ?? []).length, online },
        pagamentos: (pagsMes.data ?? []) as Pagamento[],
        docsPendentes: docsPend.count ?? 0,
      },
      error: null,
    }
  }, [])

  const { data, loading, error, reload } = useAsyncData<DashboardData>(fetcher, [])

  const fin = useMemo(() => {
    const activos = (data?.pagamentos ?? []).filter((p) => p.estado !== 'cancelado')
    const esperado = activos.reduce((s, p) => s + Number(p.valor), 0)
    const recebido = activos.filter((p) => p.estado === 'pago').reduce((s, p) => s + Number(p.valor), 0)
    return { esperado, recebido, taxa: esperado > 0 ? Math.round((recebido / esperado) * 100) : 100 }
  }, [data])

  const turmasOrdenadas = useMemo(
    () =>
      [...(data?.turmas ?? [])]
        .sort((a, b) => b.vagas_preenchidas / b.limite_vagas - a.vagas_preenchidas / a.limite_vagas)
        .slice(0, 6),
    [data],
  )

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-raised" />
        ))}
      </div>
    )
  }
  if (error) return <ErrorMessage message={error} onRetry={() => void reload()} />
  if (!data) return null

  return (
    <div className="space-y-3">
      {collapsed ? (
        <div className="cell flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="label-section">Dashboard</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Resumo de {new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })} ·{' '}
              {data.matriculas} alunos activos · {fmtMzn(fin.recebido)} recebidos este mês
            </p>
          </div>
          <button
            onClick={() => setCollapsed(false)}
            className="btn-secondary flex items-center gap-1.5"
            aria-label="Abrir dashboard"
            title="Abrir dashboard"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Abrir dashboard
          </button>
        </div>
      ) : (
        <>
      {relatorioAberto && (
        <RelatorioMensalModal mes={new Date().toISOString().slice(0, 7)} onClose={() => setRelatorioAberto(false)} />
      )}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          Resumo de {new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCollapsed(true)}
            className="btn-ghost flex h-7 w-7 items-center justify-center text-[13px]"
            aria-label="Recolher dashboard"
            title="Recolher dashboard"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={() => setRelatorioAberto(true)}
            className="btn-secondary"
            title="Abrir relatório mensal"
          >
            Relatório mensal
          </button>
        </div>
      </div>

      {/* Faixa de KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Receita deste mês"
          value={fmtMzn(fin.recebido)}
          apoio={`${fmtMzn(fin.esperado)} em cobrança · ${fin.taxa}% cobrado`}
          barra={{ pct: fin.taxa, cor: fin.taxa >= 80 ? 'bg-ok' : fin.taxa >= 50 ? 'bg-warn' : 'bg-danger' }}
        />
        <Kpi
          label="Alunos activos"
          value={String(data.matriculas)}
          apoio={`${data.concluidos} concluído(s)`}
        />
        <Kpi
          label="Candidaturas (mês)"
          value={String(data.inscricoesMes.total)}
          apoio={`${data.inscricoesMes.online} pelo site · ${data.aprovadasMes} aprovada(s)`}
        />
        <Kpi
          label="Pendências"
          value={String(data.docsPendentes)}
          tone={data.docsPendentes > 0 ? 'text-warn' : 'text-ok'}
          apoio={`${data.docsPendentes} documento(s) por validar`}
        />
      </div>

      {/* Duas colunas: actividade recente + ocupação das turmas */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Cell
          label="Inscritos recentes"
          action={
            <Link to="/admin/inscricoes" className="text-[13px] font-medium text-accent hover:text-accent-strong">
              Ver todas
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {data.recentes.map((i) => (
                  <tr key={i.id} className="hover:bg-canvas">
                    <td className="px-4 py-2 font-medium text-ink">{i.nome_completo}</td>
                    <td className="px-4 py-2 text-ink-muted">{i.cursos?.nome}</td>
                    <td className="px-4 py-2">
                      <OrigemTag origem={i.origem ?? 'presencial'} />
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={i.estado}>{ESTADO_LABELS[i.estado]}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right tnum text-ink-faint">{format.dateTime(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cell>

        <Cell label="Ocupação das turmas" action={<Link to="/admin/alunos" className="text-[13px] font-medium text-accent hover:text-accent-strong">Ver turmas</Link>}>
          <div className="space-y-2.5 px-4 py-3">
            {turmasOrdenadas.map((t) => {
              const pct = t.limite_vagas > 0 ? Math.round((t.vagas_preenchidas / t.limite_vagas) * 100) : 0
              return (
                <div key={t.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {t.nome_turma}
                      <span className="ml-1.5 font-normal text-ink-faint">{t.cursos?.nome}</span>
                    </p>
                    <div className="mt-1 h-1 rounded-full bg-raised">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="shrink-0 font-mono text-[11px] text-ink-muted">
                    {t.vagas_preenchidas}/{t.limite_vagas}
                  </p>
                </div>
              )
            })}
            {turmasOrdenadas.length === 0 && (
              <p className="py-6 text-center text-sm text-ink-muted">Sem turmas registadas.</p>
            )}
          </div>
        </Cell>
      </div>

      {/* Recolher dashboard */}
      <div className="flex justify-end">
        <button
          onClick={() => setCollapsed(true)}
          className="btn-ghost flex items-center gap-1.5 text-[13px] text-ink-muted"
          aria-label="Recolher dashboard"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
          Recolher
        </button>
      </div>
        </>
      )}
    </div>
  )
}
