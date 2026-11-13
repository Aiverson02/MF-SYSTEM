import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { showSuccess } from '../lib/alerts'
import { METODO_LABELS, type MetodoPagamento } from '../types/database'
import { fmtMzn, hojeIso } from '../lib/financas'

const TIPOS = [
  { chave: 'mensalidade', label: 'Mensalidade' },
  { chave: 'inscricao', label: 'Inscrição' },
  { chave: 'apoio_aula', label: 'Apoio de aula' },
  { chave: 'avaliacao', label: 'Taxa de avaliação' },
  { chave: 'touca_avental', label: 'Touca e avental' },
] as const

type TipoRecebimento = (typeof TIPOS)[number]['chave']

interface AlunoOpcao {
  id: string
  numero_estudante: string
  nome: string
  curso_id: string | null
  curso: string | null
  turma: string | null
}

interface CobrancaCatalogo {
  categoria: string
  curso_id: string | null
  valor: number
}

type LinhaBruta = {
  id: string
  numero_estudante: string
  inscricoes?: { nome_completo?: string } | null
  turmas?: {
    nome_turma?: string
    curso_id?: string | null
    cursos?: { nome?: string } | null
  } | null
}

const MENSALIDADE_PADRAO = 170

/**
 * Registo rápido de um valor recebido no dia, sem sair do caixa.
 * Grava nas tabelas existentes através da RPC `registar_recebimento`:
 * mensalidades em `pagamentos`; as restantes taxas em `cobrancas_alunos`.
 */
export default function RegistarRecebimentoModal({
  dia,
  onClose,
  onDone,
}: {
  dia: string
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)
  const [alunos, setAlunos] = useState<AlunoOpcao[] | null>(null)
  const [erroAlunos, setErroAlunos] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState<CobrancaCatalogo[]>([])
  const [pesquisa, setPesquisa] = useState('')
  const [aluno, setAluno] = useState<AlunoOpcao | null>(null)
  const [tipo, setTipo] = useState<TipoRecebimento>('mensalidade')
  const [valor, setValor] = useState(String(MENSALIDADE_PADRAO))
  const [data, setData] = useState(dia)
  const [metodo, setMetodo] = useState<MetodoPagamento>('numerario')
  const [referencia, setReferencia] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const [resAlunos, resCat] = await Promise.all([
        supabase
          .from('alunos_matriculados')
          .select('id, numero_estudante, inscricoes(nome_completo), turmas(nome_turma, curso_id, cursos(nome))')
          .eq('estado_aluno', 'ativo')
          .order('numero_estudante'),
        supabase.from('cobrancas').select('categoria, curso_id, valor').eq('ativo', true),
      ])
      if (!vivo) return
      if (resAlunos.error) {
        setErroAlunos(resAlunos.error.message)
        setAlunos([])
      } else {
        setAlunos(
          ((resAlunos.data ?? []) as unknown as LinhaBruta[]).map((a) => ({
            id: a.id,
            numero_estudante: a.numero_estudante,
            nome: a.inscricoes?.nome_completo ?? 'Aluno sem nome',
            curso_id: a.turmas?.curso_id ?? null,
            curso: a.turmas?.cursos?.nome ?? null,
            turma: a.turmas?.nome_turma ?? null,
          })),
        )
      }
      setCatalogo((resCat.data ?? []) as CobrancaCatalogo[])
    })()
    return () => {
      vivo = false
    }
  }, [])

  // Valor sugerido: 170 na mensalidade; nas restantes, o valor já configurado
  // no catálogo (por curso, no caso do apoio de aula).
  useEffect(() => {
    if (tipo === 'mensalidade') {
      setValor(String(MENSALIDADE_PADRAO))
      return
    }
    const categoria =
      tipo === 'apoio_aula' ? 'material_aula' : tipo === 'inscricao' ? 'inscricao' : tipo === 'avaliacao' ? 'avaliacao' : 'touca_avental'
    const encontrada = catalogo.find((c) =>
      tipo === 'apoio_aula' && aluno
        ? c.categoria === categoria && c.curso_id === aluno.curso_id
        : c.categoria === categoria && c.curso_id === null,
    )
    // Sem valor de catálogo, o campo fica vazio para a secretaria escrever o
    // valor recebido (nunca herda o 170 da mensalidade anterior).
    setValor(encontrada ? String(encontrada.valor) : '')
  }, [tipo, aluno, catalogo])

  const filtrados = useMemo(() => {
    const q = pesquisa.trim().toLowerCase()
    if (!q) return (alunos ?? []).slice(0, 6)
    return (alunos ?? [])
      .filter(
        (a) =>
          a.nome.toLowerCase().includes(q) ||
          a.numero_estudante.toLowerCase().includes(q) ||
          (a.curso ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [alunos, pesquisa])

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!aluno) {
      setErro('Escolha o aluno que pagou.')
      return
    }
    const v = Number(valor)
    if (!Number.isFinite(v) || v <= 0) {
      setErro('O valor tem de ser maior do que zero.')
      return
    }
    setErro(null)
    setLoading(true)
    const { data: resultado, error } = await supabase.rpc('registar_recebimento', {
      p_aluno_id: aluno.id,
      p_tipo: tipo,
      p_valor: v,
      p_data: data,
      p_metodo: metodo,
      p_referencia: referencia.trim() || null,
    })
    setLoading(false)
    if (error) {
      setErro(error.message)
      return
    }
    const r = (resultado as { sucesso: boolean; mensagem: string | null }[] | null)?.[0]
    if (!r?.sucesso) {
      setErro(r?.mensagem ?? 'Não foi possível registar o recebimento.')
      return
    }
    showSuccess(r.mensagem ?? 'Recebimento registado.')
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form
        onSubmit={guardar}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg"
      >
        <h2 className="font-serif text-lg font-semibold text-ink">Registar recebimento</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Fica guardado no caixa do dia e na conta do aluno.
        </p>

        <div className="mt-4">
          <label className="label-section mb-1 block">O que foi pago</label>
          <div className="grid grid-cols-2 gap-1.5">
            {TIPOS.map((t) => (
              <button
                key={t.chave}
                type="button"
                onClick={() => setTipo(t.chave)}
                aria-pressed={tipo === t.chave}
                className={`rounded-md border px-2.5 py-2 text-[12px] font-medium ${
                  tipo === t.chave
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line text-ink-muted hover:bg-raised hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="label-section mb-1 block">Aluno que pagou</label>
          {aluno ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">{aluno.nome}</p>
                <p className="font-mono text-[11px] text-ink-faint">
                  {aluno.numero_estudante}
                  {aluno.curso ? ` · ${aluno.curso}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAluno(null)
                  setPesquisa('')
                }}
                className="shrink-0 text-[12px] font-medium text-accent hover:text-accent-strong"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                className="input w-full"
                placeholder="Escreva o nome ou o nº de estudante..."
                value={pesquisa}
                onChange={(e) => setPesquisa(e.target.value)}
                autoFocus
              />
              {alunos === null ? (
                <p className="mt-2 text-[12px] text-ink-faint">A carregar alunos...</p>
              ) : erroAlunos ? (
                <p className="mt-2 text-[12px] text-danger">{erroAlunos}</p>
              ) : filtrados.length === 0 ? (
                <p className="mt-2 text-[12px] text-ink-faint">Nenhum aluno encontrado.</p>
              ) : (
                <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-line">
                  {filtrados.map((a) => (
                    <li key={a.id} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => {
                          setAluno(a)
                          setPesquisa('')
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-raised"
                      >
                        <span className="block text-[13px] text-ink">{a.nome}</span>
                        <span className="block font-mono text-[10px] text-ink-faint">
                          {a.numero_estudante}
                          {a.curso ? ` · ${a.curso}` : ''}
                          {a.turma ? ` · ${a.turma}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label-section mb-1 block">Valor (MZN)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              className="input w-full tnum"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Data</label>
            <input
              type="date"
              className="input w-full"
              value={data}
              max={hojeIso()}
              onChange={(e) => e.target.value && setData(e.target.value)}
              required
            />
          </div>
        </div>

        <p className="mt-1 text-[11px] text-ink-faint">
          {tipo === 'mensalidade'
            ? 'Mensalidade habitual: 170 MT — pode registar 180 MT ou outro valor.'
            : tipo === 'apoio_aula'
              ? aluno?.curso
                ? `Valor do apoio de aula do curso ${aluno.curso}; ajuste se o aluno pagou outro valor.`
                : 'Escolha o aluno para usar o valor do curso; pode escrever outro valor.'
              : 'O valor sugerido vem do catálogo de cobranças; pode ser alterado.'}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label-section mb-1 block">Forma</label>
            <select
              className="input w-full"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as MetodoPagamento)}
            >
              {(Object.keys(METODO_LABELS) as MetodoPagamento[]).map((m) => (
                <option key={m} value={m}>
                  {METODO_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-section mb-1 block">Referência</label>
            <input
              className="input w-full"
              placeholder="Opcional"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
        </div>

        {aluno && (
          <p className="mt-3 rounded-md bg-raised px-3 py-2 text-[12px] text-ink-muted">
            {aluno.nome} · {TIPOS.find((t) => t.chave === tipo)?.label} ·{' '}
            <span className="tnum text-ink">{fmtMzn(Number(valor) || 0)}</span>
          </p>
        )}

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading ? 'A registar...' : 'Registar recebimento'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
