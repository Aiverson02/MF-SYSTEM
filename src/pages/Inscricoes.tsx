import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Curso, EstadoInscricao, Inscricao, Turma } from '../types/database'
import { ESTADO_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, PageHeader } from '../components/ui'
import { format } from '../lib/format'
import { confirmarAcao, showError, showSuccess } from '../lib/alerts'
import ValidacaoInscricao from '../components/ValidacaoInscricao'
import NovaInscricaoModal from '../components/NovaInscricaoModal'

const PAGE_SIZE = 15

const FILTROS_ESTADO: { valor: EstadoInscricao | 'todos'; label: string }[] = [
  { valor: 'todos', label: 'Todos' },
  { valor: 'pendente', label: 'Pendentes' },
  { valor: 'aprovado', label: 'Aprovados' },
  { valor: 'rejeitado', label: 'Rejeitados' },
]

export default function Inscricoes() {
  const [searchParams, setSearchParams] = useSearchParams()
  const validarId = searchParams.get('validar')

  const [pesquisa, setPesquisa] = useState('')
  const [pesquisaInput, setPesquisaInput] = useState('')
  const [cursoFiltro, setCursoFiltro] = useState('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoInscricao | 'todos'>('todos')
  const [pagina, setPagina] = useState(0)
  const [novaInscricao, setNovaInscricao] = useState(false)

  // Turmas para o modal de alocação
  const turmasFetcher = useCallback(
    async () =>
      (await supabase.from('turmas').select('*').order('ano_lectivo', { ascending: false })) as {
        data: Turma[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: turmas } = useAsyncData<Turma[]>(turmasFetcher, [])

  // Cursos para o filtro
  const cursosFetcher = useCallback(
    async () =>
      (await supabase.from('cursos').select('*').eq('ativo', true).order('nome')) as {
        data: Curso[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cursos } = useAsyncData<Curso[]>(cursosFetcher, [])

  // Lista paginada + filtrada de inscrições
  const fetcher = useCallback(async () => {
    let query = supabase
      .from('inscricoes')
      .select('*, cursos(nome, codigo)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE - 1)

    if (pesquisa) {
      query = query.or(`nome_completo.ilike.%${pesquisa}%,numero_bi.ilike.%${pesquisa}%`)
    }
    if (cursoFiltro !== 'todos') query = query.eq('curso_id', cursoFiltro)
    if (estadoFiltro !== 'todos') query = query.eq('estado', estadoFiltro)

    const { data: lista, count, error } = await query
    if (error) return { data: null, error }
    return { data: { lista: (lista ?? []) as Inscricao[], total: count ?? 0 }, error: null }
  }, [pagina, pesquisa, cursoFiltro, estadoFiltro])

  const { data, loading, error, reload, setData } = useAsyncData(fetcher, [pagina, pesquisa, cursoFiltro, estadoFiltro])

  const inscricoes = data?.lista ?? []
  const total = data?.total ?? 0
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // --- Realtime: novas inscrições chegam em tempo real ------------------------
  const [notificacao, setNotificacao] = useState<string | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel('novas-inscricoes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inscricoes' },
        (payload) => {
          const nova = payload.new as Inscricao
          setNotificacao(`Nova inscrição: ${nova.nome_completo} (${nova.numero_inscricao})`)
          // Se estamos na primeira página sem filtros, insere directamente no topo
          if (pagina === 0 && !pesquisa && cursoFiltro === 'todos' && estadoFiltro === 'todos') {
            setData((prev) =>
              prev
                ? { lista: [nova, ...prev.lista], total: prev.total + 1 }
                : prev,
            )
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [pagina, pesquisa, cursoFiltro, estadoFiltro, setData])

  useEffect(() => {
    if (!notificacao) return
    const t = setTimeout(() => setNotificacao(null), 8000)
    return () => clearTimeout(t)
  }, [notificacao])

  // --- Debounce da pesquisa ----------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      setPesquisa(pesquisaInput)
      setPagina(0)
    }, 400)
    return () => clearTimeout(t)
  }, [pesquisaInput])

  const mudarFiltro = (fn: () => void) => {
    fn()
    setPagina(0)
  }

  const inscricaoSelecionada = useMemo(
    () => inscricoes.find((i) => i.id === validarId) ?? null,
    [inscricoes, validarId],
  )

  const abrirValidacao = (id: string) => {
    setSearchParams({ validar: id })
  }

  /** Elimina a inscrição (cascata: documentos, aluno matriculado, notas e pagamentos). */
  const eliminarInscricao = async (i: Inscricao) => {
    const ok = await confirmarAcao({
      title: 'Eliminar inscrição',
      message: `Eliminar a inscrição ${i.numero_inscricao} de "${i.nome_completo}"?\n\nApaga os documentos anexados e, se o candidato já estiver matriculado, também o aluno associado (com notas e pagamentos). Esta acção não pode ser desfeita.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return

    const { error } = await supabase.from('inscricoes').delete().eq('id', i.id)
    if (error) {
      showError(error.message)
      return
    }

    // Depois da BD: limpar os ficheiros do bucket privado (melhor esforço).
    const { data: ficheiros } = await supabase.storage.from('documentos-inscricao').list(i.id)
    if (ficheiros && ficheiros.length > 0) {
      const { error: errStore } = await supabase.storage
        .from('documentos-inscricao')
        .remove(ficheiros.map((f) => `${i.id}/${f.name}`))
      if (errStore) {
        showError(`Inscrição eliminada, mas nem todos os ficheiros puderam ser removidos: ${errStore.message}`)
      }
    }

    showSuccess('Inscrição eliminada.')
    if (validarId === i.id) fecharValidacao()
    void reload()
  }

  const fecharValidacao = () => {
    setSearchParams({}, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Inscrições"
        subtitle={`${total} inscrição(ões) encontrada(s)`}
        actions={
          <button onClick={() => setNovaInscricao(true)} className="btn-primary">
            Nova Inscrição
          </button>
        }
      />

      {/* Notificação realtime */}
      {notificacao && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-line bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">
          <span>{notificacao}</span>
          <button onClick={() => void reload()} className="font-semibold underline">
            Recarregar lista
          </button>
        </div>
      )}

      {/* Barra de ferramentas: sem animação (filtros e busca são acções rápidas) */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={pesquisaInput}
            onChange={(e) => setPesquisaInput(e.target.value)}
            placeholder="Pesquisar por nome ou BI..."
            className="input w-full py-1.5 pl-9"
          />
        </div>

        <select
          value={cursoFiltro}
          onChange={(e) => mudarFiltro(() => setCursoFiltro(e.target.value))}
          className="input py-1.5"
        >
          <option value="todos">Todos os cursos</option>
          {(cursos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>

        <div className="flex rounded-md border border-line-strong p-0.5">
          {FILTROS_ESTADO.map((f) => (
            <button
              key={f.valor}
              onClick={() => mudarFiltro(() => setEstadoFiltro(f.valor))}
              className={`rounded px-2.5 py-1 text-[13px] font-medium ${
                estadoFiltro === f.valor ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela: assenta na célula, sem cartão dentro de cartão */}
      <div className="cell">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorMessage message={error} onRetry={() => void reload()} />
        ) : inscricoes.length === 0 ? (
          <EmptyState message="Nenhuma inscrição encontrada com os filtros actuais." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="px-4 py-2.5 font-medium">Nº / Data</th>
                    <th className="px-4 py-2.5 font-medium">Candidato</th>
                    <th className="px-4 py-2.5 font-medium">Curso</th>
                    <th className="px-4 py-2.5 font-medium">Turno</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inscricoes.map((i) => (
                    <tr key={i.id} className="hover:bg-canvas">
                      <td className="px-4 py-2.5">
                        <p className="font-mono text-xs text-ink-muted">{i.numero_inscricao}</p>
                        <p className="text-xs text-ink-faint">{format.dateTime(i.created_at)}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{i.nome_completo}</p>
                        <p className="font-mono text-xs text-ink-faint">{i.numero_bi}</p>
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{i.cursos?.nome ?? ''}</td>
                      <td className="px-4 py-2.5 text-ink-muted">
                        {i.turno_pretendido === 'manha' ? 'Manhã' : i.turno_pretendido === 'tarde' ? 'Tarde' : 'Pós-Laboral'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={i.estado}>{ESTADO_LABELS[i.estado]}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => abrirValidacao(i.id)} className="btn-secondary px-2.5 py-1 text-xs">
                            Validar
                          </button>
                          <button
                            onClick={() => void eliminarInscricao(i)}
                            className="btn-danger px-2.5 py-1 text-xs"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
              <p className="tnum text-xs text-ink-muted">
                Página {pagina + 1} de {totalPaginas}, {total} registos
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagina((p) => Math.max(0, p - 1))}
                  disabled={pagina === 0}
                  className="btn-secondary px-2.5 py-1 text-xs"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
                  disabled={pagina >= totalPaginas - 1}
                  className="btn-secondary px-2.5 py-1 text-xs"
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal de nova inscrição (staff) */}
      {novaInscricao && (
        <NovaInscricaoModal onClose={() => setNovaInscricao(false)} onDone={() => void reload()} />
      )}

      {/* Modal de validação */}
      {inscricaoSelecionada && (
        <ValidacaoInscricao
          inscricao={inscricaoSelecionada}
          turmas={turmas ?? []}
          onClose={fecharValidacao}
          onChanged={() => void reload()}
        />
      )}
    </>
  )
}
