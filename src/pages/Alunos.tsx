import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { AlunoMatriculado, Inscricao, NotasResumo, Turma } from '../types/database'
import { ESTADO_ALUNO_LABELS, TURNO_LABELS, notaLabel } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { format } from '../lib/format'
import { exportToCsv } from '../lib/exportCsv'
import { confirmarAcao, showError, showSuccess } from '../lib/alerts'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { matricularEmTurma } from '../lib/inscricoesService'

// --- Modal de alocação de turma -----------------------------------------------

function AlocarTurmaModal({
  inscricao,
  turmas,
  onClose,
  onDone,
}: {
  inscricao: Inscricao
  turmas: Turma[]
  onClose: () => void
  onDone: () => void
}) {
  const [turmaId, setTurmaId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscapeKey(onClose)

  const alocar = async () => {
    if (!turmaId) return
    setLoading(true)
    setError(null)

    // Matrícula transacional via RPC (gera nº de estudante e ocupa a vaga)
    const r = await matricularEmTurma(inscricao.id, turmaId)

    setLoading(false)
    if (!r.ok) {
      setError(r.erro ?? 'Erro desconhecido.')
    } else {
      onDone()
      onClose()
    }
  }

  const turmasDoCurso = turmas.filter((t) => t.curso_id === inscricao.curso_id && t.vagas_preenchidas < t.limite_vagas)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <div className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-ink">Alocar em Turma</h3>
        <p className="mt-1 text-sm text-ink-muted">
          {inscricao.nome_completo}, <span className="font-mono text-xs">{inscricao.numero_inscricao}</span>
        </p>

        <select
          value={turmaId}
          onChange={(e) => setTurmaId(e.target.value)}
          className="input mt-4 w-full"
        >
          <option value="">Seleccionar turma com vagas...</option>
          {turmasDoCurso.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome_turma}, {TURNO_LABELS[t.turno]}, {t.ano_lectivo} ({t.limite_vagas - t.vagas_preenchidas} vagas)
            </option>
          ))}
        </select>

        {turmasDoCurso.length === 0 && (
          <p className="mt-2 text-xs text-warn">Nenhuma turma deste curso tem vagas disponíveis.</p>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={() => void alocar()} disabled={!turmaId || loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Confirmar matrícula
          </button>
          <button onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Nota final (vista notas_resumo_aluno, migração 015) -----------------------

/** Situação da avaliação em texto, para a tabela e o CSV. */
function situacaoAvaliacao(resumo: NotasResumo | undefined): string {
  if (!resumo || resumo.itens_total === 0) return ''
  if (!resumo.avaliacao_completa) return `Em curso (${resumo.itens_lancados}/${resumo.itens_total})`
  return resumo.aprovado ? 'Aprovado' : 'Reprovado'
}

function NotaFinal({ resumo }: { resumo?: NotasResumo }) {
  if (!resumo || resumo.itens_total === 0) return <span className="text-ink-faint">—</span>
  return (
    <span className="flex items-center gap-2">
      <span className="tnum font-medium text-ink">{notaLabel(resumo.nota_final)}</span>
      {resumo.avaliacao_completa ? (
        <span className="text-xs text-ink-faint">{resumo.aprovado ? 'Aprovado' : 'Reprovado'}</span>
      ) : (
        <span className="tnum text-xs text-ink-faint">
          {resumo.itens_lancados}/{resumo.itens_total}
        </span>
      )}
    </span>
  )
}

// --- Página principal ----------------------------------------------------------

const FILTROS_ESTADO_ALUNO = ['todos', 'ativo', 'concluido'] as const

export default function Alunos() {
  const navigate = useNavigate()
  const [turmaFiltro, setTurmaFiltro] = useState('todas')
  const [estadoFiltro, setEstadoFiltro] = useState<(typeof FILTROS_ESTADO_ALUNO)[number]>('todos')
  const [alocando, setAlocando] = useState<Inscricao | null>(null)
  const [exportando, setExportando] = useState(false)
  const [resumos, setResumos] = useState<Record<string, NotasResumo>>({})

  /** Nota final por aluno, da vista `notas_resumo_aluno` (a fórmula é do servidor). */
  const carregarResumos = useCallback(async (ids: string[]) => {
    const mapa: Record<string, NotasResumo> = {}
    if (ids.length === 0) return mapa

    const { data } = await supabase.from('notas_resumo_aluno').select('*').in('aluno_id', ids)
    for (const r of (data as NotasResumo[] | null) ?? []) mapa[r.aluno_id] = r
    return mapa
  }, [])

  const turmasFetcher = useCallback(
    async () =>
      (await supabase
        .from('turmas')
        .select('*, cursos(nome)')
        .order('ano_lectivo', { ascending: false })) as {
        data: (Turma & { cursos?: { nome: string } | null })[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: turmas } = useAsyncData<(Turma & { cursos?: { nome: string } | null })[]>(turmasFetcher, [])

  const alunosFetcher = useCallback(async () => {
    let query = supabase
      .from('alunos_matriculados')
      .select(
        '*, inscricoes(nome_completo, numero_inscricao, numero_bi, curso_id), turmas(nome_turma, turno, ano_lectivo)',
      )
      .order('created_at', { ascending: false })

    if (turmaFiltro !== 'todas') query = query.eq('turma_id', turmaFiltro)
    if (estadoFiltro !== 'todos') query = query.eq('estado_aluno', estadoFiltro)

    return query
  }, [turmaFiltro, estadoFiltro])

  const { data: alunos, loading, error, reload } = useAsyncData<AlunoMatriculado[]>(alunosFetcher, [
    turmaFiltro,
    estadoFiltro,
  ])

  // Inscrições aprovadas ainda sem matrícula (fila de alocação)
  const aprovadosSemTurmaFetcher = useCallback(async () => {
    const { data: matriculados, error: err1 } = await supabase.from('alunos_matriculados').select('inscricao_id')
    if (err1) return { data: null, error: err1 }
    const idsComTurma = (matriculados ?? []).map((m) => m.inscricao_id)

    let query = supabase
      .from('inscricoes')
      .select('*')
      .eq('estado', 'aprovado')
      .order('created_at', { ascending: false })

    if (idsComTurma.length > 0) {
      query = query.not('id', 'in', `(${idsComTurma.join(',')})`)
    }
    return query
  }, [])

  const { data: aprovadosSemTurma } = useAsyncData<Inscricao[]>(aprovadosSemTurmaFetcher, [])

  // Nota final da lista visível (uma consulta, sem N+1 na renderização)
  useEffect(() => {
    const ids = (alunos ?? []).map((a) => a.id)
    let activo = true
    void (async () => {
      const mapa = await carregarResumos(ids)
      if (activo) setResumos(mapa)
    })()
    return () => {
      activo = false
    }
  }, [alunos, carregarResumos])

  const cursoNome = useCallback(
    (cursoId: string) => {
      const t = (turmas ?? []).find((x) => x.curso_id === cursoId)
      return t?.cursos?.nome ?? ''
    },
    [turmas],
  )

  const estatisticas = useMemo(() => {
    const lista = alunos ?? []
    return {
      total: lista.length,
      ativos: lista.filter((a) => a.estado_aluno === 'ativo').length,
      concluidos: lista.filter((a) => a.estado_aluno === 'concluido').length,
    }
  }, [alunos])

  /** Apaga a matrícula: liberta a vaga e remove notas/pagamentos (cascata). */
  const apagarAluno = async (a: AlunoMatriculado) => {
    const nome = a.inscricoes?.nome_completo ?? a.numero_estudante
    const ok = await confirmarAcao({
      title: 'Apagar aluno',
      message: `Apagar "${nome}" (${a.numero_estudante})?\n\nA matrícula é removida, a vaga na turma fica livre e os registos de notas, pagamentos e pós-conclusão associados são apagados. A inscrição original continua aprovada, sem matrícula. Esta acção não pode ser desfeita.`,
      confirmLabel: 'Apagar',
      danger: true,
    })
    if (!ok) return

    const { error } = await supabase.from('alunos_matriculados').delete().eq('id', a.id)
    if (error) {
      showError(error.message)
      return
    }
    showSuccess('Aluno apagado. A vaga da turma ficou livre.')
    void reload()
  }

  const exportarCsv = async () => {
    setExportando(true)
    // Rebuscar dados completos (sem limite de página) para exportação
    const { data: todos, error } = await supabase
      .from('alunos_matriculados')
      .select(
        '*, inscricoes(nome_completo, numero_inscricao, numero_bi, curso_id), turmas(nome_turma, turno, ano_lectivo)',
      )
      .order('numero_estudante')

    if (error || !todos) {
      setExportando(false)
      alert(`Erro ao exportar: ${error?.message ?? 'dados indisponíveis'}`)
      return
    }

    const resumosExportacao = await carregarResumos(todos.map((a) => a.id))

    exportToCsv(
      'lista_alunos',
      [
        { header: 'Numero Estudante', value: (a) => a.numero_estudante },
        { header: 'Nome Completo', value: (a) => a.inscricoes?.nome_completo ?? '' },
        { header: 'Numero BI', value: (a) => a.inscricoes?.numero_bi ?? '' },
        { header: 'Curso', value: (a) => (a.inscricoes ? cursoNome(a.inscricoes.curso_id) : '') },
        { header: 'Turma', value: (a) => a.turmas?.nome_turma ?? '' },
        { header: 'Turno', value: (a) => (a.turmas ? TURNO_LABELS[a.turmas.turno] : '') },
        { header: 'Ano Lectivo', value: (a) => String(a.turmas?.ano_lectivo ?? '') },
        { header: 'Data Matricula', value: (a) => format.date(a.data_matricula) },
        { header: 'Estado', value: (a) => ESTADO_ALUNO_LABELS[a.estado_aluno] },
        { header: 'Nota Final', value: (a) => notaLabel(resumosExportacao[a.id]?.nota_final) },
        { header: 'Situacao Avaliacao', value: (a) => situacaoAvaliacao(resumosExportacao[a.id]) },
      ],
      todos as AlunoMatriculado[],
    )
    setExportando(false)
  }

  return (
    <>
      <PageHeader
        title="Alunos & Turmas"
        subtitle="Matrículas activas e alocação de turmas"
        actions={
          <button onClick={() => void exportarCsv()} disabled={exportando} className="btn-primary">
            {exportando && <Spinner className="h-4 w-4" />}
            Exportar CSV
          </button>
        }
      />

      {/* Fila de aprovados sem turma: secção delimitada, cor só no label */}
      {aprovadosSemTurma && aprovadosSemTurma.length > 0 && (
        <div className="cell mb-6 border-warn">
          <div className="cell-head">
            <p className="label-section text-warn">A aguardar alocação ({aprovadosSemTurma.length})</p>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {aprovadosSemTurma.map((i) => (
              <button
                key={i.id}
                onClick={() => setAlocando(i)}
                className="btn-secondary px-3 py-1.5 text-[13px]"
              >
                {i.nome_completo}
                <span className="ml-1.5 text-xs text-accent">Alocar</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={turmaFiltro} onChange={(e) => setTurmaFiltro(e.target.value)} className="input py-1.5">
          <option value="todas">Todas as turmas</option>
          {(turmas ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome_turma}, {TURNO_LABELS[t.turno]}, {t.ano_lectivo} ({t.cursos?.nome ?? ''})
            </option>
          ))}
        </select>

        <div className="flex rounded-md border border-line-strong p-0.5">
          {FILTROS_ESTADO_ALUNO.map((f) => (
            <button
              key={f}
              onClick={() => setEstadoFiltro(f)}
              className={`rounded px-2.5 py-1 text-[13px] font-medium ${
                estadoFiltro === f ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {f === 'todos' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="tnum ml-auto flex gap-4 text-[13px] text-ink-muted">
          <span>
            <strong className="font-semibold text-ink">{estatisticas.total}</strong> matrículas
          </span>
          <span>
            <strong className="font-semibold text-ok">{estatisticas.ativos}</strong> activos
          </span>
          <span>
            <strong className="font-semibold text-ink">{estatisticas.concluidos}</strong> concluídos
          </span>
        </div>
      </div>

      {/* Tabela */}
      <div className="cell">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorMessage message={error} onRetry={() => void reload()} />
        ) : (alunos ?? []).length === 0 ? (
          <EmptyState message="Nenhum aluno matriculado com os filtros actuais." icon="🎓" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Nº Estudante</th>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  <th className="px-4 py-2.5 font-medium">Curso</th>
                  <th className="px-4 py-2.5 font-medium">Turma</th>
                  <th className="px-4 py-2.5 font-medium">Matrícula</th>
                  <th className="px-4 py-2.5 font-medium">Nota final</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(alunos ?? []).map((a) => (
                  <tr
                    key={a.id}
                    className="cursor-pointer hover:bg-canvas"
                    onClick={() => navigate(`/admin/alunos/${a.id}`)}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{a.numero_estudante}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{a.inscricoes?.nome_completo ?? ''}</p>
                      <p className="font-mono text-xs text-ink-faint">{a.inscricoes?.numero_bi}</p>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{a.inscricoes ? cursoNome(a.inscricoes.curso_id) : ''}</td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {a.turmas ? `${a.turmas.nome_turma} (${TURNO_LABELS[a.turmas.turno]})` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{format.date(a.data_matricula)}</td>
                    <td className="px-4 py-2.5">
                      <NotaFinal resumo={resumos[a.id]} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={
                          a.estado_aluno === 'ativo' ? 'aprovado' : 'neutro'
                        }
                      >
                        {ESTADO_ALUNO_LABELS[a.estado_aluno]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => void apagarAluno(a)}
                        className="btn-danger px-2.5 py-1 text-xs"
                      >
                        Apagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {alocando &&
        createPortal(
          <AlocarTurmaModal
            inscricao={alocando}
            turmas={turmas ?? []}
            onClose={() => setAlocando(null)}
            onDone={() => void reload()}
          />,
          document.body,
        )}
    </>
  )
}
