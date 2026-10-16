import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Avaliacao, Nota, NotasResumo, TipoAvaliacao } from '../types/database'
import { TIPO_AVALIACAO_LABELS, notaLabel } from '../types/database'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, Spinner } from './ui'
import { useAsyncData } from '../hooks/useAsyncData'
import { confirmarAcao, showError, showInfo, showSuccess } from '../lib/alerts'

/**
 * Notas e avaliações de um aluno.
 *
 * O catálogo de itens (avaliações + exame) é do CURSO; a nota é do aluno. Os
 * totais (média das avaliações, exame, nota final) vêm da vista
 * `notas_resumo_aluno` — a fórmula vive no servidor, para a secretaria e o
 * futuro portal dos formadores mostrarem sempre o mesmo número.
 */

interface Dados {
  avaliacoes: Avaliacao[]
  notas: Nota[]
  resumo: NotasResumo | null
}

interface Rascunho {
  nota: string
  data: string
  observacoes: string
}

const VAZIO: Rascunho = { nota: '', data: '', observacoes: '' }

/** 1 → "1"; 12.5 → "12,5" (pesos e escalas não precisam de casas fixas). */
function numero(valor: number | string): string {
  return String(valor).replace('.', ',')
}

/** Erros de tabela em falta (migração ainda não aplicada): sugere o passo. */
function dicaMigracao(mensagem: string): string {
  return /does not exist|schema cache|not find the table|not find the relation/i.test(mensagem)
    ? 'As tabelas de notas ainda não existem neste projeto — aplique supabase/migrations/015_avaliacoes_notas.sql.'
    : mensagem
}

export default function NotasAvaliacoes({ alunoId, cursoId }: { alunoId: string; cursoId: string | null }) {
  const fetcher = useCallback(async () => {
    if (!cursoId) {
      return { data: { avaliacoes: [], notas: [], resumo: null } as Dados, error: null }
    }

    const [av, nt, rs] = await Promise.all([
      supabase
        .from('avaliacoes')
        .select('*')
        .eq('curso_id', cursoId)
        .eq('ativo', true)
        .order('ordem')
        .order('nome'),
      supabase.from('notas').select('*').eq('aluno_id', alunoId),
      supabase.from('notas_resumo_aluno').select('*').eq('aluno_id', alunoId).maybeSingle(),
    ])

    const erro = av.error ?? nt.error ?? rs.error
    if (erro) return { data: null, error: { message: erro.message } }

    return {
      data: {
        avaliacoes: (av.data as Avaliacao[]) ?? [],
        notas: (nt.data as Nota[]) ?? [],
        resumo: (rs.data as NotasResumo | null) ?? null,
      },
      error: null,
    }
  }, [alunoId, cursoId])

  const { data, loading, error, reload } = useAsyncData<Dados>(fetcher, [alunoId, cursoId])

  const guardadas = useMemo(() => {
    const mapa: Record<string, Nota> = {}
    for (const n of data?.notas ?? []) mapa[n.avaliacao_id] = n
    return mapa
  }, [data])

  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({})
  const [guardando, setGuardando] = useState(false)
  const [aGerir, setAGerir] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  // Repõe os rascunhos a partir do que está gravado (inclui depois de guardar).
  useEffect(() => {
    const novo: Record<string, Rascunho> = {}
    for (const a of data?.avaliacoes ?? []) {
      novo[a.id] = {
        nota: a.id in guardadas && guardadas[a.id].nota != null ? String(guardadas[a.id].nota) : '',
        data: guardadas[a.id]?.data_avaliacao ?? '',
        observacoes: guardadas[a.id]?.observacoes ?? '',
      }
    }
    setRascunhos(novo)
  }, [data, guardadas])

  const editar = (avaliacaoId: string, campo: keyof Rascunho, valor: string) =>
    setRascunhos((r) => ({ ...r, [avaliacaoId]: { ...(r[avaliacaoId] ?? VAZIO), [campo]: valor } }))

  const alterado = (a: Avaliacao) => {
    const r = rascunhos[a.id] ?? VAZIO
    const g = guardadas[a.id]
    const notaGuardada = g?.nota != null ? String(g.nota) : ''
    return (
      r.nota.trim().replace(',', '.') !== notaGuardada ||
      r.data !== (g?.data_avaliacao ?? '') ||
      r.observacoes !== (g?.observacoes ?? '')
    )
  }

  const porGuardar = (data?.avaliacoes ?? []).filter(alterado).length

  // --- Lançamento ------------------------------------------------------------
  const guardar = async () => {
    if (!data) return
    setFalha(null)

    const registos: {
      aluno_id: string
      avaliacao_id: string
      nota: number
      data_avaliacao: string | null
      observacoes: string | null
    }[] = []
    const limpar: string[] = []

    for (const a of data.avaliacoes) {
      const r = rascunhos[a.id] ?? VAZIO
      const bruto = r.nota.trim().replace(',', '.')

      if (bruto === '') {
        // Campo vazio = nota por lançar: se havia nota gravada, remove-se.
        if (guardadas[a.id]) limpar.push(a.id)
        continue
      }

      const valor = Number(bruto)
      if (!Number.isFinite(valor) || valor < 0 || valor > a.nota_maxima) {
        setFalha(`Nota de "${a.nome}" fora do intervalo (0 a ${a.nota_maxima}).`)
        return
      }

      const g = guardadas[a.id]
      if (g && g.nota === valor && (g.data_avaliacao ?? '') === r.data && (g.observacoes ?? '') === r.observacoes) {
        continue
      }

      registos.push({
        aluno_id: alunoId,
        avaliacao_id: a.id,
        nota: valor,
        data_avaliacao: r.data || null,
        observacoes: r.observacoes.trim() || null,
      })
    }

    if (registos.length === 0 && limpar.length === 0) {
      showInfo('Sem alterações para guardar.')
      return
    }

    setGuardando(true)

    if (registos.length > 0) {
      const { error: err } = await supabase.from('notas').upsert(registos, { onConflict: 'aluno_id,avaliacao_id' })
      if (err) {
        setGuardando(false)
        setFalha(dicaMigracao(err.message))
        return
      }
    }

    if (limpar.length > 0) {
      const { error: err } = await supabase.from('notas').delete().eq('aluno_id', alunoId).in('avaliacao_id', limpar)
      if (err) {
        setGuardando(false)
        setFalha(err.message)
        return
      }
    }

    setGuardando(false)
    showSuccess('Notas actualizadas.')
    void reload()
  }

  // --- Gestão do catálogo de avaliações (por curso) --------------------------
  const criarPadrao = async () => {
    if (!cursoId) return
    setFalha(null)
    setGuardando(true)
    const { data: r, error: err } = await supabase.rpc('criar_avaliacoes_padrao', { p_curso_id: cursoId })
    setGuardando(false)

    if (err) {
      setFalha(dicaMigracao(err.message))
      return
    }
    const linha = (r as { sucesso: boolean; mensagem: string }[] | null)?.[0]
    if (!linha?.sucesso) {
      setFalha(linha?.mensagem ?? 'Não foi possível criar as avaliações padrão.')
      return
    }
    showSuccess(linha.mensagem)
    void reload()
  }

  const eliminar = async (a: Avaliacao) => {
    const ok = await confirmarAcao({
      title: 'Eliminar item de avaliação',
      message: `Eliminar "${a.nome}" de todas as fichas deste curso? As notas lançadas neste item são apagadas.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return

    setFalha(null)
    const { error: err } = await supabase.from('avaliacoes').delete().eq('id', a.id)
    if (err) {
      setFalha(err.message)
      showError('Não foi possível eliminar o item.')
      return
    }
    showSuccess('Item eliminado.')
    void reload()
  }

  const resumo = data?.resumo ?? null
  const total = data?.avaliacoes.length ?? 0

  const estado =
    total === 0 ? (
      <Badge variant="neutro">Sem avaliações definidas</Badge>
    ) : !resumo ? (
      <Badge variant="neutro">Por lançar</Badge>
    ) : !resumo.avaliacao_completa ? (
      <Badge variant="em_analise">
        {resumo.itens_lancados}/{resumo.itens_total} lançados
      </Badge>
    ) : resumo.aprovado ? (
      <Badge variant="aprovado">Aprovado</Badge>
    ) : (
      <Badge variant="rejeitado">Reprovado</Badge>
    )

  return (
    <div className="cell mt-3">
      <div className="cell-head">
        <p className="label-section">Notas e avaliações</p>
        <div className="flex items-center gap-3">
          {porGuardar > 0 && <span className="text-[12px] text-warn">{porGuardar} por guardar</span>}
          <button
            onClick={() => setAGerir((v) => !v)}
            className="btn-ghost px-2 py-1 text-[13px]"
            aria-expanded={aGerir}
          >
            {aGerir ? 'Fechar' : 'Gerir avaliações'}
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="A carregar notas..." />
      ) : error ? (
        <ErrorMessage message={dicaMigracao(error)} onRetry={() => void reload()} />
      ) : !cursoId ? (
        <p className="p-4 text-sm text-ink-muted">Aluno sem curso associado.</p>
      ) : total === 0 ? (
        <div>
          <EmptyState message="Este curso ainda não tem avaliações definidas." icon="📝" />
          <div className="flex flex-wrap items-center justify-center gap-2 pb-4">
            <button onClick={() => void criarPadrao()} disabled={guardando} className="btn-primary">
              {guardando && <Spinner className="h-4 w-4" />}
              Criar 3 avaliações + exame
            </button>
            <button onClick={() => setAGerir(true)} className="btn-secondary">
              Definir manualmente
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Peso</th>
                  <th className="px-4 py-2.5 font-medium">Nota</th>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-4 py-2.5 font-medium">Observações</th>
                  {aGerir && <th className="px-4 py-2.5 font-medium"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.avaliacoes.map((a) => {
                  const r = rascunhos[a.id] ?? VAZIO
                  return (
                    <tr key={a.id} className={alterado(a) ? 'bg-warn-soft/40' : undefined}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{a.nome}</p>
                        <p className="text-xs text-ink-faint">
                          {TIPO_AVALIACAO_LABELS[a.tipo]} · máxima {numero(a.nota_maxima)}
                        </p>
                      </td>
                      <td className="tnum px-4 py-2.5 text-ink-muted">{numero(a.peso)}</td>
                      <td className="px-4 py-2.5">
                        <input
                          value={r.nota}
                          onChange={(e) => editar(a.id, 'nota', e.target.value)}
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Nota de ${a.nome}`}
                          className="input tnum w-20 py-1 text-center"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="date"
                          value={r.data}
                          onChange={(e) => editar(a.id, 'data', e.target.value)}
                          aria-label={`Data de ${a.nome}`}
                          className="input py-1"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={r.observacoes}
                          onChange={(e) => editar(a.id, 'observacoes', e.target.value)}
                          placeholder="Ex.: recuperação"
                          aria-label={`Observações de ${a.nome}`}
                          className="input w-44 py-1"
                        />
                      </td>
                      {aGerir && (
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => void eliminar(a)}
                            className="btn-ghost px-2 py-1 text-[12px] text-danger"
                          >
                            Eliminar
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {aGerir && <NovoItem cursoId={cursoId} onCriado={() => void reload()} onErro={setFalha} />}

          {falha && <p className="border-t border-line px-4 py-2 text-sm text-danger">{falha}</p>}

          {/* Totais: calculados no servidor (vista notas_resumo_aluno) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-4 py-3 text-[13px] text-ink-muted">
            <span>
              Média das avaliações{' '}
              <strong className="tnum font-semibold text-ink">{notaLabel(resumo?.media_avaliacoes)}</strong>
            </span>
            <span>
              Exame <strong className="tnum font-semibold text-ink">{notaLabel(resumo?.nota_exame)}</strong>
            </span>
            <span>
              Nota final{' '}
              <strong className="tnum text-[15px] font-semibold text-ink">{notaLabel(resumo?.nota_final)}</strong>
            </span>
            <span className="ml-auto flex items-center gap-3">
              {estado}
              <button onClick={() => void guardar()} disabled={guardando} className="btn-primary">
                {guardando && <Spinner className="h-4 w-4" />}
                Guardar notas
              </button>
            </span>
          </div>
        </>
      )}

      {falha && total === 0 && <p className="px-4 pb-4 text-sm text-danger">{falha}</p>}
    </div>
  )
}

// --- Adicionar um item de avaliação ao curso ---------------------------------

function NovoItem({
  cursoId,
  onCriado,
  onErro,
}: {
  cursoId: string
  onCriado: () => void
  onErro: (mensagem: string) => void
}) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoAvaliacao>('avaliacao')
  const [peso, setPeso] = useState('1')
  const [notaMaxima, setNotaMaxima] = useState('20')
  const [aCriar, setACriar] = useState(false)

  const criar = async () => {
    const nomeLimpo = nome.trim()
    const pesoNum = Number(peso.replace(',', '.'))
    const maxNum = Number(notaMaxima.replace(',', '.'))

    if (!nomeLimpo) {
      onErro('Indique o nome do item de avaliação.')
      return
    }
    if (!Number.isFinite(pesoNum) || pesoNum <= 0) {
      onErro('O peso tem de ser maior que zero.')
      return
    }
    if (!Number.isFinite(maxNum) || maxNum <= 0) {
      onErro('A nota máxima tem de ser maior que zero.')
      return
    }

    setACriar(true)
    const { error } = await supabase
      .from('avaliacoes')
      .insert({ curso_id: cursoId, nome: nomeLimpo, tipo, peso: pesoNum, nota_maxima: maxNum, ordem: 99 })
    setACriar(false)

    if (error) {
      onErro(/duplicate|unique/i.test(error.message) ? 'Já existe um item com este nome neste curso.' : error.message)
      return
    }
    setNome('')
    setPeso('1')
    setNotaMaxima('20')
    onCriado()
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line bg-canvas px-4 py-3">
      <label className="flex-1">
        <span className="label-section">Novo item</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Avaliação 4, Trabalho prático"
          className="input mt-1 w-full py-1"
        />
      </label>
      <label>
        <span className="label-section">Tipo</span>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoAvaliacao)}
          className="input mt-1 py-1"
        >
          <option value="avaliacao">Avaliação</option>
          <option value="exame">Exame</option>
        </select>
      </label>
      <label>
        <span className="label-section">Peso</span>
        <input
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
          inputMode="decimal"
          className="input tnum mt-1 w-16 py-1 text-center"
        />
      </label>
      <label>
        <span className="label-section">Máxima</span>
        <input
          value={notaMaxima}
          onChange={(e) => setNotaMaxima(e.target.value)}
          inputMode="decimal"
          className="input tnum mt-1 w-16 py-1 text-center"
        />
      </label>
      <button onClick={() => void criar()} disabled={aCriar} className="btn-secondary">
        {aCriar && <Spinner className="h-4 w-4" />}
        Adicionar
      </button>
    </div>
  )
}
