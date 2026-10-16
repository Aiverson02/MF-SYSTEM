import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Avaliacao, Formador, Pauta, PautaAluno, Turma } from '../types/database'
import {
  ESTADO_PAUTA_LABELS,
  TIPO_AVALIACAO_LABELS,
  TURNO_LABELS,
} from '../types/database'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { useAsyncData } from '../hooks/useAsyncData'
import { confirmarAcao, showError, showSuccess } from '../lib/alerts'
import { exportPautaCsv, type PautaLinha } from '../lib/exportCsv'

/**
 * Pautas & formadores de uma turma.
 *
 * É aqui que a secretaria decide quem lecciona a turma e abre (ou fecha) cada
 * item de avaliação ao formador. Sem pauta aberta, o portal do formador não
 * deixa escrever — a autorização é verificada no servidor, não aqui.
 */

interface ItemTurma {
  avaliacao: Avaliacao
  pauta: Pauta | null
  lancadas: number
}

interface Dados {
  turmas: (Turma & { cursos?: { nome: string } | null })[]
  formadores: Formador[]
  atribuicoes: { turma_id: string; formador_id: string }[]
}

export default function Pautas() {
  const [turmaId, setTurmaId] = useState('')

  const fetcher = useCallback(async () => {
    const [turmas, formadores, atribuicoes] = await Promise.all([
      supabase.from('turmas').select('*, cursos(nome)').order('ano_lectivo', { ascending: false }).order('nome_turma'),
      supabase.from('formadores').select('*').order('nome'),
      supabase.from('turma_formadores').select('turma_id, formador_id'),
    ])

    const erro = turmas.error ?? formadores.error ?? atribuicoes.error
    if (erro) return { data: null, error: { message: erro.message } }

    return {
      data: {
        turmas: (turmas.data as Dados['turmas']) ?? [],
        formadores: (formadores.data as Formador[]) ?? [],
        atribuicoes: (atribuicoes.data as Dados['atribuicoes']) ?? [],
      },
      error: null,
    }
  }, [])

  const { data, loading, error, reload } = useAsyncData<Dados>(fetcher, [])

  const turma = useMemo(() => (data?.turmas ?? []).find((t) => t.id === turmaId) ?? null, [data, turmaId])

  // Primeira turma como valor por omissão.
  useEffect(() => {
    if (!turmaId && data?.turmas?.length) setTurmaId(data.turmas[0].id)
  }, [data, turmaId])

  // --- Itens + pautas + progresso da turma seleccionada ---------------------
  const [itens, setItens] = useState<ItemTurma[]>([])
  const [carregandoItens, setCarregandoItens] = useState(false)
  const [itensError, setItensError] = useState<string | null>(null)
  const [aGravar, setAGravar] = useState<string | null>(null)

  const carregarItens = useCallback(async () => {
    if (!turma) {
      setItens([])
      return
    }
    setCarregandoItens(true)
    setItensError(null)

    const [avaliacoes, pautas, alunos, notas] = await Promise.all([
      supabase.from('avaliacoes').select('*').eq('curso_id', turma.curso_id).eq('ativo', true).order('ordem').order('nome'),
      supabase.from('pautas').select('*').eq('turma_id', turma.id),
      supabase.from('alunos_matriculados').select('id').eq('turma_id', turma.id),
      supabase.from('notas').select('aluno_id, avaliacao_id'),
    ])

    const erro = avaliacoes.error ?? pautas.error ?? alunos.error ?? notas.error
    if (erro) {
      setCarregandoItens(false)
      setItensError(erro.message)
      return
    }

    const idsAlunos = new Set(((alunos.data as { id: string }[]) ?? []).map((a) => a.id))
    const porItem: Record<string, number> = {}
    for (const n of (notas.data as { aluno_id: string; avaliacao_id: string }[]) ?? []) {
      if (!idsAlunos.has(n.aluno_id)) continue
      porItem[n.avaliacao_id] = (porItem[n.avaliacao_id] ?? 0) + 1
    }

    const listaPautas = (pautas.data as Pauta[]) ?? []
    setItens(
      ((avaliacoes.data as Avaliacao[]) ?? []).map((av) => ({
        avaliacao: av,
        pauta: listaPautas.find((p) => p.avaliacao_id === av.id) ?? null,
        lancadas: porItem[av.id] ?? 0,
      })),
    )
    setCarregandoItens(false)
  }, [turma])

  useEffect(() => {
    void carregarItens()
  }, [carregarItens])

  // --- Acções ---------------------------------------------------------------
  const abrirPauta = async (item: ItemTurma, formadorId: string, prazo: string) => {
    if (!turma) return
    setAGravar(item.avaliacao.id)
    const { error: err } = await supabase.from('pautas').upsert(
      {
        turma_id: turma.id,
        avaliacao_id: item.avaliacao.id,
        formador_id: formadorId || null,
        prazo: prazo || null,
        estado: 'aberta',
      },
      { onConflict: 'turma_id,avaliacao_id' },
    )
    setAGravar(null)

    if (err) {
      showError(err.message)
      return
    }
    showSuccess(`Pauta "${item.avaliacao.nome}" aberta ao formador.`)
    void carregarItens()
  }

  const mudarEstado = async (item: ItemTurma, estado: 'aberta' | 'fechada') => {
    if (!turma || !item.pauta) return

    if (estado === 'fechada') {
      const ok = await confirmarAcao({
        title: 'Fechar pauta',
        message: `Fechar "${item.avaliacao.nome}" (${turma.nome_turma})? O formador deixa de poder alterar as notas; a secretaria continua a poder corrigir na ficha do aluno.`,
        confirmLabel: 'Fechar pauta',
      })
      if (!ok) return
    }

    setAGravar(item.avaliacao.id)
    const { error: err } = await supabase
      .from('pautas')
      .update({ estado })
      .eq('id', item.pauta.id)
    setAGravar(null)

    if (err) {
      showError(err.message)
      return
    }
    showSuccess(estado === 'fechada' ? 'Pauta fechada.' : 'Pauta reaberta.')
    void carregarItens()
  }

  const apagarPauta = async (item: ItemTurma) => {
    if (!item.pauta) return
    const ok = await confirmarAcao({
      title: 'Remover pauta',
      message: `Remover a pauta de "${item.avaliacao.nome}"? As notas já lançadas mantêm-se; o formador deixa de ter acesso a este item.`,
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return

    setAGravar(item.avaliacao.id)
    const { error: err } = await supabase.from('pautas').delete().eq('id', item.pauta.id)
    setAGravar(null)

    if (err) {
      showError(err.message)
      return
    }
    showSuccess('Pauta removida.')
    void carregarItens()
  }

  /** Pauta de um item (alunos + notas) em CSV — mesmo conteúdo que o formador vê. */
  const exportarPauta = async (item: ItemTurma) => {
    const { data, error: err } = await supabase.rpc('pauta_da_turma', {
      p_turma_id: turmaId,
      p_avaliacao_id: item.avaliacao.id,
    })
    if (err) {
      showError(err.message)
      return
    }

    const linhas: PautaLinha[] = ((data as PautaAluno[] | null) ?? []).map((a) => ({
      numero: a.numero_estudante,
      nome: a.nome_completo ?? '—',
      nota: a.nota != null ? String(a.nota).replace('.', ',') : '',
      data: a.data_avaliacao ?? '',
      observacoes: a.observacoes ?? '',
    }))
    exportPautaCsv(`${item.avaliacao.nome}_${turma?.nome_turma ?? ''}`, linhas)
    showSuccess('Pauta exportada em CSV.')
  }

  const atribuirFormador = async (formadorId: string) => {
    if (!turma || !formadorId) return
    setAGravar('atribuir')
    const { error: err } = await supabase
      .from('turma_formadores')
      .insert({ turma_id: turma.id, formador_id: formadorId })
    setAGravar(null)

    if (err) {
      showError(err.message)
      return
    }
    showSuccess('Formador atribuído à turma.')
    void reload()
  }

  const removerFormador = async (formadorId: string, nome: string) => {
    if (!turma) return
    const ok = await confirmarAcao({
      title: 'Remover formador da turma',
      message: `Remover ${nome} de ${turma.nome_turma}? Deixa de ver as pautas desta turma.`,
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return

    setAGravar('atribuir')
    const { error: err } = await supabase
      .from('turma_formadores')
      .delete()
      .eq('turma_id', turma.id)
      .eq('formador_id', formadorId)
    setAGravar(null)

    if (err) {
      showError(err.message)
      return
    }
    showSuccess('Formador removido da turma.')
    void reload()
  }

  if (loading) return <LoadingBlock />
  if (error) return <ErrorMessage message={error} onRetry={() => void reload()} />

  const formadoresDaTurma = (data?.atribuicoes ?? []).filter((a) => a.turma_id === turmaId)
  const disponiveis = (data?.formadores ?? []).filter(
    (f) => f.ativo && !formadoresDaTurma.some((a) => a.formador_id === f.id),
  )

  return (
    <>
      <PageHeader
        title="Pautas & formadores"
        subtitle="Quem lecciona cada turma e que itens de avaliação estão abertos ao formador"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label>
          <span className="label-section">Turma</span>
          <select value={turmaId} onChange={(e) => setTurmaId(e.target.value)} className="input mt-1 py-1.5">
            {(data?.turmas ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome_turma}, {TURNO_LABELS[t.turno]}, {t.ano_lectivo} ({t.cursos?.nome ?? ''})
              </option>
            ))}
          </select>
        </label>
      </div>

      {!turma ? (
        <div className="cell">
          <EmptyState message="Ainda não há turmas criadas." icon="🏫" />
        </div>
      ) : (
        <>
          {/* Formadores da turma */}
          <div className="cell">
            <div className="cell-head">
              <p className="label-section">Formadores desta turma</p>
              <span className="text-xs text-ink-faint">{turma.curso_id ? turma.cursos?.nome : ''}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 p-4">
              {formadoresDaTurma.length === 0 && (
                <p className="text-sm text-warn">
                  Sem formador atribuído — o portal não mostra esta turma a ninguém.
                </p>
              )}

              {formadoresDaTurma.map((a) => {
                const f = (data?.formadores ?? []).find((x) => x.id === a.formador_id)
                return (
                  <span key={a.formador_id} className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5">
                    <span className="text-[13px] text-ink">{f?.nome ?? '—'}</span>
                    <button
                      onClick={() => void removerFormador(a.formador_id, f?.nome ?? '')}
                      className="text-xs text-danger"
                      aria-label={`Remover ${f?.nome ?? ''}`}
                    >
                      remover
                    </button>
                  </span>
                )
              })}

              {disponiveis.length > 0 && (
                <select
                  value=""
                  onChange={(e) => void atribuirFormador(e.target.value)}
                  disabled={aGravar === 'atribuir'}
                  className="input py-1.5"
                  aria-label="Atribuir formador à turma"
                >
                  <option value="">Atribuir formador...</option>
                  {disponiveis.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Itens e pautas */}
          <div className="cell mt-3">
            <div className="cell-head">
              <p className="label-section">Itens de avaliação do curso</p>
              <button onClick={() => void carregarItens()} className="btn-ghost px-2 py-1 text-[13px]">
                Actualizar
              </button>
            </div>

            {carregandoItens ? (
              <LoadingBlock label="A carregar itens..." />
            ) : itensError ? (
              <ErrorMessage message={itensError} onRetry={() => void carregarItens()} />
            ) : itens.length === 0 ? (
              <EmptyState
                message="Este curso ainda não tem avaliações definidas. Crie-as na ficha de um aluno, em “Notas e avaliações”."
                icon="📝"
              />
            ) : (
              <div className="divide-y divide-line">
                {itens.map((item) => (
                  <LinhaItem
                    key={item.avaliacao.id}
                    item={item}
                    formadores={data?.formadores ?? []}
                    aGravar={aGravar === item.avaliacao.id}
                    onAbrir={(formadorId, prazo) => void abrirPauta(item, formadorId, prazo)}
                    onEstado={(estado) => void mudarEstado(item, estado)}
                    onApagar={() => void apagarPauta(item)}
                    onExportar={() => void exportarPauta(item)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

// --- Linha de item ----------------------------------------------------------

function LinhaItem({
  item,
  formadores,
  aGravar,
  onAbrir,
  onEstado,
  onApagar,
  onExportar,
}: {
  item: ItemTurma
  formadores: Formador[]
  aGravar: boolean
  onAbrir: (formadorId: string, prazo: string) => void
  onEstado: (estado: 'aberta' | 'fechada') => void
  onApagar: () => void
  onExportar: () => void
}) {
  const [formadorId, setFormadorId] = useState('')
  const [prazo, setPrazo] = useState('')
  const pauta = item.pauta

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{item.avaliacao.nome}</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          {TIPO_AVALIACAO_LABELS[item.avaliacao.tipo]} · peso {String(item.avaliacao.peso).replace('.', ',')} · escala{' '}
          {String(item.avaliacao.nota_maxima).replace('.', ',')} · {item.lancadas} nota(s) lançada(s)
        </p>
      </div>

      {pauta ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={pauta.estado === 'aberta' ? 'aprovado' : 'neutro'}>{ESTADO_PAUTA_LABELS[pauta.estado]}</Badge>
          {pauta.prazo && <span className="text-xs text-ink-faint">prazo {pauta.prazo}</span>}
          <span className="text-xs text-ink-muted">
            {pauta.formador_id
              ? formadores.find((f) => f.id === pauta.formador_id)?.nome ?? 'formador'
              : 'qualquer formador da turma'}
          </span>
          {pauta.estado === 'aberta' ? (
            <button onClick={() => onEstado('fechada')} disabled={aGravar} className="btn-secondary px-3 py-1.5 text-[13px]">
              {aGravar && <Spinner className="h-3.5 w-3.5" />}
              Fechar
            </button>
          ) : (
            <button onClick={() => onEstado('aberta')} disabled={aGravar} className="btn-secondary px-3 py-1.5 text-[13px]">
              Reabrir
            </button>
          )}
          <button onClick={onApagar} disabled={aGravar} className="btn-ghost px-2 py-1 text-[12px] text-danger">
            Remover pauta
          </button>
          <button onClick={onExportar} className="btn-ghost px-2 py-1 text-[12px]">
            Exportar CSV
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={formadorId}
            onChange={(e) => setFormadorId(e.target.value)}
            className="input py-1.5"
            aria-label={`Formador para ${item.avaliacao.nome}`}
          >
            <option value="">Qualquer formador da turma</option>
            {formadores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            className="input py-1.5"
            aria-label={`Prazo para ${item.avaliacao.nome}`}
          />
          <button onClick={() => onAbrir(formadorId, prazo)} disabled={aGravar} className="btn-primary px-3 py-1.5 text-[13px]">
            {aGravar && <Spinner className="h-3.5 w-3.5" />}
            Abrir pauta
          </button>
        </div>
      )}
    </div>
  )
}
