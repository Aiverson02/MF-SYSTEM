import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { AlunoMatriculado, DocumentoInscricao, Turma } from '../types/database'
import { ESTADO_ALUNO_LABELS, TURNO_LABELS } from '../types/database'
import { Badge, ErrorMessage, LoadingBlock, Spinner } from '../components/ui'
import { format } from '../lib/format'
import { showSuccess, confirmarAcao } from '../lib/alerts'

type AlunoCompleto = AlunoMatriculado & {
  inscricoes?: {
    nome_completo: string
    numero_inscricao: string
    numero_bi: string
    data_nascimento: string
    genero: string | null
    email: string | null
    telefone_whatsapp: string
    curso_id: string
  } | null
  turmas?: { nome_turma: string; turno: string; ano_lectivo: number; curso_id: string } | null
}

const ESTADO_VARIANTS = {
  ativo: 'aprovado',
  trancado: 'neutro',
  concluido: 'neutro',
} as const

export default function FichaAluno() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [aluno, setAluno] = useState<AlunoCompleto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [documentos, setDocumentos] = useState<DocumentoInscricao[]>([])
  const [turmas, setTurmas] = useState<Turma[]>([])

  const [modoTransferir, setModoTransferir] = useState(false)
  const [turmaDestino, setTurmaDestino] = useState('')
  const [acaoLoading, setAcaoLoading] = useState<string | null>(null)
  const [acaoError, setAcaoError] = useState<string | null>(null)

  // --- Carregamento -----------------------------------------------------------
  const carregar = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('alunos_matriculados')
      .select(
        '*, inscricoes(nome_completo, numero_inscricao, numero_bi, data_nascimento, genero, email, telefone_whatsapp, curso_id), turmas(nome_turma, turno, ano_lectivo, curso_id)',
      )
      .eq('id', id)
      .single()

    if (err) {
      setError(err.message)
      setAluno(null)
    } else {
      setAluno(data as AlunoCompleto)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    if (!aluno?.inscricoes) return
    ;(async () => {
      const [docs, trm] = await Promise.all([
        supabase
          .from('documentos_inscricao')
          .select('*')
          .eq('inscricao_id', aluno.inscricao_id)
          .order('created_at', { ascending: true }),
        supabase.from('turmas').select('*').order('ano_lectivo', { ascending: false }),
      ])
      setDocumentos((docs.data as DocumentoInscricao[]) ?? [])
      setTurmas((trm.data as Turma[]) ?? [])
    })()
  }, [aluno])

  const turmasDoCurso = useMemo(
    () =>
      turmas.filter(
        (t) => aluno?.turmas?.curso_id === t.curso_id && t.vagas_preenchidas < t.limite_vagas && t.id !== aluno.turma_id,
      ),
    [turmas, aluno],
  )

  // --- Acções ------------------------------------------------------------------
  const mudarEstado = async (novo: 'ativo' | 'concluido') => {
    if (!aluno) return
    const acao = novo === 'concluido' ? 'concluir' : 'reactivar'
    const ok = await confirmarAcao({
      title: `${acao.charAt(0).toUpperCase() + acao.slice(1)} matrícula`,
      message: `${ESTADO_ALUNO_LABELS[novo]} a matrícula de ${aluno.inscricoes?.nome_completo} (${aluno.numero_estudante})?`,
      confirmLabel: 'Confirmar',
      danger: false,
    })
    if (!ok) return

    setAcaoLoading(novo)
    setAcaoError(null)
    const { error: err } = await supabase.from('alunos_matriculados').update({ estado_aluno: novo }).eq('id', aluno.id)
    setAcaoLoading(null)

    if (err) {
      setAcaoError(err.message)
      return
    }
    showSuccess(`Matrícula ${novo === 'concluido' ? 'concluída' : 'reactivada'}.`)
    void carregar()
  }

  const transferir = async () => {
    if (!aluno || !turmaDestino) return
    const destino = turmas.find((t) => t.id === turmaDestino)
    const ok = await confirmarAcao({
      title: 'Transferir de turma',
      message: `Mover ${aluno.inscricoes?.nome_completo} para ${destino?.nome_turma} (${destino ? TURNO_LABELS[destino.turno] : ''})?`,
      confirmLabel: 'Transferir',
    })
    if (!ok) return

    setAcaoLoading('transferir')
    setAcaoError(null)
    const { error: err } = await supabase.from('alunos_matriculados').update({ turma_id: turmaDestino }).eq('id', aluno.id)
    setAcaoLoading(null)

    if (err) {
      setAcaoError(err.message)
      return
    }
    showSuccess('Aluno transferido de turma.')
    setModoTransferir(false)
    setTurmaDestino('')
    void carregar()
  }

  const whatsappUrl = aluno?.inscricoes?.telefone_whatsapp
    ? `https://wa.me/${aluno.inscricoes.telefone_whatsapp.replace(/[^0-9]/g, '')}`
    : null

  // --- Render ------------------------------------------------------------------
  if (loading) return <LoadingBlock label="A carregar ficha..." />
  if (error || !aluno)
    return <ErrorMessage message={error ?? 'Aluno não encontrado.'} onRetry={() => void carregar()} />

  const insc = aluno.inscricoes
  const turma = aluno.turmas

  const dado = (label: string, valor: string | null | undefined) => (
    <div>
      <p className="label-section">{label}</p>
      <p className="tnum mt-0.5 text-sm text-ink">{valor || ''}</p>
    </div>
  )

  return (
    <>
      {/* Cabeçalho com voltar */}
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="btn-ghost -ml-2 mb-2 px-2 py-1 text-[13px]">
          Voltar
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] leading-tight text-ink">{insc?.nome_completo ?? ''}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <span className="font-mono text-xs">{aluno.numero_estudante}</span>
              <Badge variant={ESTADO_VARIANTS[aluno.estado_aluno]}>{ESTADO_ALUNO_LABELS[aluno.estado_aluno]}</Badge>
            </p>
          </div>
          {whatsappUrl && (
            <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn-secondary">
              Contactar no WhatsApp
            </a>
          )}
        </div>
      </div>

      {acaoError && (
        <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{acaoError}</p>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Dados pessoais */}
        <div className="cell">
          <div className="cell-head">
            <p className="label-section">Dados pessoais</p>
            <Link to={`/admin/inscricoes?validar=${aluno.inscricao_id}`} className="text-[13px] font-medium text-accent hover:text-accent-strong">
              Ver inscrição
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4">
            {dado('Nº de Inscrição', insc?.numero_inscricao)}
            {dado('Bilhete de Identidade', insc?.numero_bi)}
            {dado('Data de Nascimento', format.date(insc?.data_nascimento))}
            {dado('Género', insc?.genero)}
            {dado('Telefone WhatsApp', insc?.telefone_whatsapp)}
            {dado('Email', insc?.email)}
          </div>
        </div>

        {/* Matrícula */}
        <div className="cell">
          <div className="cell-head">
            <p className="label-section">Matrícula</p>
            <p className="text-[13px] text-ink-faint">{format.date(aluno.data_matricula)}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4">
            {dado('Turma', turma?.nome_turma)}
            {dado('Turno', turma ? TURNO_LABELS[turma.turno as keyof typeof TURNO_LABELS] : null)}
            {dado('Ano Lectivo', turma?.ano_lectivo?.toString())}
            {dado('Data de Matrícula', format.date(aluno.data_matricula))}
          </div>

          {/* Acções de estado e transferência */}
          <div className="border-t border-line p-4">
            {modoTransferir ? (
              <div className="space-y-2.5">
                <p className="text-[13px] font-medium text-ink">Transferir para:</p>
                <select value={turmaDestino} onChange={(e) => setTurmaDestino(e.target.value)} className="input w-full">
                  <option value="">Seleccionar turma com vagas...</option>
                  {turmasDoCurso.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome_turma}, {TURNO_LABELS[t.turno]} ({t.limite_vagas - t.vagas_preenchidas} vagas)
                    </option>
                  ))}
                </select>
                {turmasDoCurso.length === 0 && (
                  <p className="text-xs text-warn">Nenhuma outra turma deste curso tem vagas disponíveis.</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => void transferir()}
                    disabled={!turmaDestino || acaoLoading !== null}
                    className="btn-primary flex-1"
                  >
                    {acaoLoading === 'transferir' && <Spinner className="h-4 w-4" />}
                    Confirmar transferência
                  </button>
                  <button onClick={() => setModoTransferir(false)} className="btn-secondary">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {aluno.estado_aluno === 'ativo' && (
                  <>
                    <button
                      onClick={() => setModoTransferir(true)}
                      disabled={acaoLoading !== null}
                      className="btn-secondary"
                    >
                      Transferir de turma
                    </button>
                    <button
                      onClick={() => void mudarEstado('concluido')}
                      disabled={acaoLoading !== null}
                      className="btn-primary"
                    >
                      {acaoLoading === 'concluido' && <Spinner className="h-4 w-4" />}
                      Concluir curso
                    </button>
                  </>
                )}
                {aluno.estado_aluno === 'concluido' && (
                  <p className="text-sm text-ink-muted">Curso concluído: a matrícula é histórica.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Documentos */}
      <div className="cell mt-3">
        <div className="cell-head">
          <p className="label-section">Documentos da inscrição ({documentos.length})</p>
        </div>
        {documentos.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">Nenhum documento anexado.</p>
        ) : (
          <div className="divide-y divide-line">
            {documentos.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[13px] text-ink">{d.tipo_documento}</span>
                <Badge variant={d.estado_validacao ? 'aprovado' : 'neutro'}>
                  {d.estado_validacao ? 'Validado' : 'Pendente'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
