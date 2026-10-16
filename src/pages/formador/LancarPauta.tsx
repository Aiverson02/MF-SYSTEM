import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { PautaAluno, PautaFormador, ResumoTurma } from '../../types/database'
import { ESTADO_PAUTA_LABELS, TIPO_AVALIACAO_LABELS, TURNO_LABELS, notaLabel } from '../../types/database'
import { Badge, ErrorMessage, LoadingBlock, Spinner } from '../../components/ui'
import { useAsyncData } from '../../hooks/useAsyncData'
import { showError, showSuccess } from '../../lib/alerts'
import { exportPautaCsv, type PautaLinha } from '../../lib/exportCsv'
import { format } from '../../lib/format'

/**
 * Lançamento das notas de uma pauta (turma + item).
 *
 * O ecrã assume o telemóvel: nomes a negrito, números grandes, uma barra de
 * gravação sempre à mão. Toda a validação é repetida no servidor
 * (`guardar_notas_pauta`): aqui só evitamos erros óbvios.
 */

interface Dados {
  alunos: PautaAluno[]
  pauta: PautaFormador | null
  resumo: ResumoTurma[]
}

interface Linha {
  nota: string
  observacoes: string
}

export default function LancarPauta() {
  const { turmaId = '', avaliacaoId = '' } = useParams<{ turmaId: string; avaliacaoId: string }>()

  const fetcher = useCallback(async () => {
    const [alunos, pautas, resumo] = await Promise.all([
      supabase.rpc('pauta_da_turma', { p_turma_id: turmaId, p_avaliacao_id: avaliacaoId }),
      supabase.rpc('pautas_do_formador'),
      supabase.rpc('resumo_turma', { p_turma_id: turmaId }),
    ])

    const erro = alunos.error ?? pautas.error ?? resumo.error
    if (erro) return { data: null, error: { message: erro.message } }

    const lista = (pautas.data as PautaFormador[] | null) ?? []
    return {
      data: {
        alunos: (alunos.data as PautaAluno[] | null) ?? [],
        pauta: lista.find((p) => p.turma_id === turmaId && p.avaliacao_id === avaliacaoId) ?? null,
        resumo: (resumo.data as ResumoTurma[] | null) ?? [],
      },
      error: null,
    }
  }, [turmaId, avaliacaoId])

  const { data, loading, error, reload } = useAsyncData<Dados>(fetcher, [turmaId, avaliacaoId])

  const guardadas = useMemo(() => {
    const mapa: Record<string, PautaAluno> = {}
    for (const a of data?.alunos ?? []) mapa[a.aluno_id] = a
    return mapa
  }, [data])

  const [linhas, setLinhas] = useState<Record<string, Linha>>({})
  const [dataProva, setDataProva] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  // Repõe o formulário a partir do que está gravado (também depois de guardar).
  useEffect(() => {
    const novo: Record<string, Linha> = {}
    let dataComum = ''
    for (const a of data?.alunos ?? []) {
      novo[a.aluno_id] = {
        nota: a.nota != null ? String(a.nota) : '',
        observacoes: a.observacoes ?? '',
      }
      if (!dataComum && a.data_avaliacao) dataComum = a.data_avaliacao
    }
    setLinhas(novo)
    setDataProva(dataComum)
  }, [data])

  const pauta = data?.pauta ?? null
  const alunos = data?.alunos ?? []
  const resumo = data?.resumo ?? []
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const editavel = !!pauta?.pode_editar && !offline

  const preenchidas = alunos.filter((a) => (linhas[a.aluno_id]?.nota ?? '').trim() !== '').length

  const editar = (alunoId: string, campo: keyof Linha, valor: string) =>
    setLinhas((l) => ({ ...l, [alunoId]: { ...(l[alunoId] ?? { nota: '', observacoes: '' }), [campo]: valor } }))

  /** Linha alterada desde a última gravação (para o destaque e o botão por linha). */
  const alterada = (alunoId: string) => {
    const linha = linhas[alunoId] ?? { nota: '', observacoes: '' }
    const gravada = guardadas[alunoId]
    const notaGravada = gravada?.nota != null ? String(gravada.nota) : ''
    return (
      linha.nota.trim().replace(',', '.') !== notaGravada ||
      linha.observacoes !== (gravada?.observacoes ?? '')
    )
  }

  /**
   * Grava. `apenas` limita a gravação a um aluno — é o botão de cada linha,
   * para lançar uma nota de cada vez sem tocar nas outras.
   */
  const guardar = async (apenas?: string[]) => {
    if (!pauta) return
    setFalha(null)

    if (offline) {
      setFalha('Sem ligação à internet — o lançamento de notas exige rede.')
      return
    }

    const entradas: {
      aluno_id: string
      nota: number | null
      data_avaliacao: string | null
      observacoes: string | null
    }[] = []

    for (const a of alunos) {
      if (apenas && !apenas.includes(a.aluno_id)) continue
      const linha = linhas[a.aluno_id] ?? { nota: '', observacoes: '' }
      const bruto = linha.nota.trim().replace(',', '.')
      const tinhaNota = guardadas[a.aluno_id]?.nota != null

      if (bruto === '') {
        // Campo vazio: apaga a nota que existia, se existia.
        if (tinhaNota) entradas.push({ aluno_id: a.aluno_id, nota: null, data_avaliacao: null, observacoes: null })
        continue
      }

      const valor = Number(bruto)
      if (!Number.isFinite(valor) || valor < 0 || valor > pauta.nota_maxima) {
        setFalha(`Nota de ${guardadas[a.aluno_id]?.nome_completo ?? 'aluno'} fora do intervalo (0 a ${pauta.nota_maxima}).`)
        return
      }

      entradas.push({
        aluno_id: a.aluno_id,
        nota: valor,
        data_avaliacao: dataProva || null,
        observacoes: linha.observacoes.trim() || null,
      })
    }

    if (entradas.length === 0) {
      setFalha(
        apenas?.length === 1
          ? 'Esta linha não tem nada para guardar (nota vazia e sem alterações).'
          : 'Não há nada para guardar.',
      )
      return
    }

    setGuardando(true)
    const { data: resposta, error: err } = await supabase.rpc('guardar_notas_pauta', {
      p_turma_id: turmaId,
      p_avaliacao_id: avaliacaoId,
      p_notas: entradas,
    })
    setGuardando(false)

    if (err) {
      setFalha(err.message)
      showError('Não foi possível guardar as notas.')
      return
    }

    const r = (resposta as { sucesso: boolean; mensagem: string; guardadas: number }[] | null)?.[0]
    if (!r?.sucesso) {
      setFalha(r?.mensagem ?? 'A pauta não foi aceite pelo servidor.')
      showError('As notas não foram guardadas.')
      return
    }

    showSuccess(r.mensagem)
    void reload()
  }

  /** Exporta a pauta visível (nº, aluno, nota, data, observações) para CSV. */
  const exportar = () => {
    const paraCsv: PautaLinha[] = alunos.map((a) => {
      const l = linhas[a.aluno_id] ?? { nota: '', observacoes: '' }
      return {
        numero: a.numero_estudante,
        nome: a.nome_completo ?? '—',
        nota: l.nota.trim(),
        data: dataProva,
        observacoes: l.observacoes,
      }
    })
    exportPautaCsv(`${pauta?.item ?? 'pauta'}_${pauta?.turma ?? ''}`, paraCsv)
    showSuccess('Pauta exportada em CSV.')
  }

  if (loading) return <LoadingBlock label="A carregar a pauta..." />
  if (error) return <ErrorMessage message={error} onRetry={() => void reload()} />
  if (!pauta) {
    return (
      <ErrorMessage
        message="Pauta não encontrada ou não atribuída a si. Confirme com a secretaria."
      />
    )
  }

  return (
    <>
      <Link to="/formador/pautas" className="btn-ghost -ml-2 mb-2 px-2 py-1 text-[13px]">
        Voltar às pautas
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] leading-tight text-ink">{pauta.item}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {pauta.curso} — {pauta.turma} ({TURNO_LABELS[pauta.turno]}, {pauta.ano_lectivo})
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pauta.estado === 'fechada' ? (
            <Badge variant="neutro">{ESTADO_PAUTA_LABELS.fechada}</Badge>
          ) : pauta.pode_editar ? (
            <Badge variant="aprovado">Aberta</Badge>
          ) : (
            <Badge variant="rejeitado">Prazo terminado</Badge>
          )}
          <span className="tnum text-[13px] text-ink-muted">
            {preenchidas}/{alunos.length} preenchidas
          </span>
          <button onClick={exportar} className="btn-secondary px-3 py-1.5 text-[13px]">
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2 text-[13px] text-ink-muted">
        <span>
          {TIPO_AVALIACAO_LABELS[pauta.tipo]} · peso {String(pauta.peso).replace('.', ',')} · escala{' '}
          {String(pauta.nota_maxima).replace('.', ',')}
        </span>
        {pauta.prazo && <span>Prazo: {format.date(pauta.prazo)}</span>}
        <label className="flex items-center gap-2">
          <span className="label-section">Data da prova</span>
          <input
            type="date"
            value={dataProva}
            onChange={(e) => setDataProva(e.target.value)}
            disabled={!editavel}
            className="input py-1"
          />
        </label>
      </div>

      {!editavel && (
        <p className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-ink">
          {offline
            ? 'Sem ligação à internet: pode consultar as notas, mas não guardar.'
            : pauta.estado === 'fechada'
              ? 'Pauta fechada pela secretaria — já não pode ser alterada. Fale com a secretaria se precisar de corrigir uma nota.'
              : 'O prazo desta pauta terminou. Fale com a secretaria se precisar de corrigir uma nota.'}
        </p>
      )}

      <div className="cell mt-4">
        <div className="divide-y divide-line">
          {alunos.map((a) => (
            <div
              key={a.aluno_id}
              className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${alterada(a.aluno_id) ? 'bg-warn-soft/40' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{a.nome_completo ?? '—'}</p>
                <p className="font-mono text-xs text-ink-faint">{a.numero_estudante}</p>
              </div>

              <input
                value={linhas[a.aluno_id]?.nota ?? ''}
                onChange={(e) => editar(a.aluno_id, 'nota', e.target.value)}
                disabled={!editavel}
                inputMode="decimal"
                placeholder="—"
                aria-label={`Nota de ${a.nome_completo ?? a.numero_estudante}`}
                className="input tnum w-20 py-1.5 text-center text-[15px]"
              />

              <input
                value={linhas[a.aluno_id]?.observacoes ?? ''}
                onChange={(e) => editar(a.aluno_id, 'observacoes', e.target.value)}
                disabled={!editavel}
                placeholder="Observações"
                aria-label={`Observações de ${a.nome_completo ?? a.numero_estudante}`}
                className="input w-full py-1.5 sm:w-52"
              />

              {editavel && (
                <button
                  onClick={() => void guardar([a.aluno_id])}
                  disabled={guardando}
                  className="btn-secondary px-2.5 py-1.5 text-[12px]"
                  aria-label={`Guardar nota de ${a.nome_completo ?? a.numero_estudante}`}
                >
                  {guardando ? '...' : 'Guardar'}
                </button>
              )}
            </div>
          ))}

          {alunos.length === 0 && <p className="p-4 text-sm text-ink-muted">Esta turma não tem alunos.</p>}
        </div>

        {falha && <p className="border-t border-line px-4 py-2 text-sm text-danger">{falha}</p>}

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
          <span className="text-[13px] text-ink-muted">
            {pauta.notas_lancadas}/{pauta.total_alunos} já lançadas
          </span>
          <button onClick={() => void guardar()} disabled={!editavel || guardando} className="btn-primary">
            {guardando && <Spinner className="h-4 w-4" />}
            Guardar pauta
          </button>
        </div>
      </div>

      {resumo.length > 0 && (
        <div className="cell mt-3">
          <div className="cell-head">
            <p className="label-section">Situação da turma (só leitura)</p>
            <span className="text-xs text-ink-faint">Média das avaliações, exame e nota final</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Nº</th>
                  <th className="px-4 py-2.5 font-medium">Aluno</th>
                  <th className="px-4 py-2.5 font-medium">Avaliações</th>
                  <th className="px-4 py-2.5 font-medium">Exame</th>
                  <th className="px-4 py-2.5 font-medium">Recurso</th>
                  <th className="px-4 py-2.5 font-medium">Nota final</th>
                  <th className="px-4 py-2.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {resumo.map((r) => (
                  <tr key={r.aluno_id}>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{r.numero_estudante}</td>
                    <td className="px-4 py-2.5 text-ink">{r.nome_completo ?? '—'}</td>
                    <td className="tnum px-4 py-2.5 text-ink-muted">{notaLabel(r.media_avaliacoes)}</td>
                    <td className="tnum px-4 py-2.5 text-ink-muted">{notaLabel(r.nota_exame)}</td>
                    <td className="tnum px-4 py-2.5 text-ink-muted">{notaLabel(r.nota_recurso)}</td>
                    <td className="tnum px-4 py-2.5 font-semibold text-ink">{notaLabel(r.nota_final)}</td>
                    <td className="px-4 py-2.5">
                      {!r.avaliacao_completa ? (
                        <span className="text-xs text-ink-faint">Por completar</span>
                      ) : r.aprovado ? (
                        <Badge variant="aprovado">Aprovado</Badge>
                      ) : (
                        <Badge variant="rejeitado">Reprovado</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
