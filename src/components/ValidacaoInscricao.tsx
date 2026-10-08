import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DocumentoInscricao, Inscricao, Turma } from '../types/database'
import { ESTADO_LABELS, TIPO_DOC_LABELS, TURNO_LABELS } from '../types/database'
import { Badge, EmptyState, Spinner } from './ui'
import { format } from '../lib/format'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  aprovarInscricao,
  rejeitarInscricao,
  obterDocumentoAssinado,
  validarDocumento,
} from '../lib/inscricoesService'
import { confirmarAcao } from '../lib/alerts'

interface Props {
  inscricao: Inscricao
  turmas: Turma[]
  onClose: () => void
  onChanged: () => void
}

/** Item de documento com visualização via Signed URL (bucket privado, 10 min). */
function DocumentoItem({
  doc,
  onValidacaoMudou,
}: {
  doc: DocumentoInscricao
  onValidacaoMudou: (agoraValidado: boolean) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const ehImagem = /\.(png|jpe?g|gif|webp)$/i.test(doc.url_ficheiro)
  const ehPdf = /\.pdf$/i.test(doc.url_ficheiro)

  useEffect(() => {
    let revogado = false
    obterDocumentoAssinado(doc.url_ficheiro)
      .then((u) => {
        if (!revogado) setUrl(u)
      })
      .catch((e: Error) => {
        if (!revogado) setErro(e.message)
      })
    return () => {
      revogado = true
    }
  }, [doc.url_ficheiro])

  const alternarValidacao = async (onResult: (novoEstado: boolean) => void) => {
    const ok = await confirmarAcao({
      title: doc.estado_validacao ? 'Remover validação' : 'Validar documento',
      message: `${TIPO_DOC_LABELS[doc.tipo_documento]} será marcado como ${
        doc.estado_validacao ? 'pendente' : 'validado'
      }.`,
      confirmLabel: 'Confirmar',
    })
    if (!ok) return
    const r = await validarDocumento(doc.id, !doc.estado_validacao)
    if (r.ok) onResult(!doc.estado_validacao)
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between px-3.5 py-2">
        <span className="text-[13px] font-medium text-ink">{TIPO_DOC_LABELS[doc.tipo_documento]}</span>
        <div className="flex items-center gap-2">
          {doc.estado_validacao ? (
            <Badge variant="aprovado">Validado</Badge>
          ) : (
            <Badge variant="neutro">Pendente</Badge>
          )}
          <button
            onClick={() => void alternarValidacao(onValidacaoMudou)}
            className="btn-secondary px-2 py-0.5 text-xs"
          >
            {doc.estado_validacao ? 'Desmarcar' : 'Validar'}
          </button>
        </div>
      </div>
      {erro ? (
        <div className="px-3.5 py-6 text-center text-xs text-danger">{erro}</div>
      ) : !url ? (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-faint">
          <Spinner className="h-4 w-4" /> <span className="text-xs">A gerar link seguro...</span>
        </div>
      ) : ehImagem ? (
        <img src={url} alt={doc.tipo_documento} className="max-h-72 w-full bg-canvas object-contain" />
      ) : ehPdf ? (
        <iframe src={url} title={doc.tipo_documento} className="h-72 w-full bg-canvas" />
      ) : (
        <div className="px-3.5 py-6 text-center">
          <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline">
            Abrir ficheiro (link válido por 10 min)
          </a>
        </div>
      )}
    </div>
  )
}

export default function ValidacaoInscricao({ inscricao, turmas, onClose, onChanged }: Props) {
  const [documentos, setDocumentos] = useState<DocumentoInscricao[] | null>(null)
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [pendentes, setPendentes] = useState(0)

  const [modoAlocacao, setModoAlocacao] = useState(false)
  const [turmaId, setTurmaId] = useState('')
  const [modoRejeitar, setModoRejeitar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [acaoLoading, setAcaoLoading] = useState<'aprovar' | 'rejeitar' | 'alocar' | null>(null)
  const [acaoError, setAcaoError] = useState<string | null>(null)

  useEscapeKey(onClose)

  useEffect(() => {
    let active = true
    ;(async () => {
      setDocsLoading(true)
      const { data, error } = await supabase
        .from('documentos_inscricao')
        .select('*')
        .eq('inscricao_id', inscricao.id)
        .order('created_at', { ascending: true })
      if (!active) return
      if (error) setDocsError(error.message)
      const lista = (data as DocumentoInscricao[]) ?? []
      setDocumentos(lista)
      setPendentes(lista.filter((d) => !d.estado_validacao).length)
      setDocsLoading(false)
    })()
    return () => {
      active = false
    }
  }, [inscricao.id])

  const handleAprovar = useCallback(
    async (comTurma: boolean) => {
      setAcaoError(null)

      // Regra de negócio: todos os documentos têm de estar validados
      if (pendentes > 0) {
        setAcaoError(
          `Bloqueado: ${pendentes} documento(s) ainda sem validação. Valide todos antes de aprovar.`,
        )
        return
      }

      if (comTurma && !turmaId) {
        setAcaoError('Seleccione uma turma primeiro.')
        return
      }

      const confirmado = await confirmarAcao({
        title: 'Aprovar inscrição',
        message: comTurma
          ? `Aprovar ${inscricao.nome_completo} e matricular na turma seleccionada?\n\nSerá gerado um nº de estudante e a vaga da turma será ocupada.`
          : `Aprovar ${inscricao.nome_completo} sem alocar turma agora?`,
        confirmLabel: 'Aprovar',
      })
      if (!confirmado) return

      setAcaoLoading(comTurma ? 'alocar' : 'aprovar')
      const r = await aprovarInscricao(inscricao.id, comTurma ? turmaId : null)
      setAcaoLoading(null)

      if (!r.ok) {
        setAcaoError(r.erro ?? 'Erro desconhecido.')
        return
      }
      onChanged()
      onClose()
    },
    [inscricao, turmaId, pendentes, onChanged, onClose],
  )

  const handleRejeitar = useCallback(async () => {
    if (!motivo.trim()) {
      setAcaoError('O motivo da rejeição é obrigatório.')
      return
    }
    setAcaoError(null)

    const confirmado = await confirmarAcao({
      title: 'Rejeitar inscrição',
      message: `Rejeitar a inscrição de ${inscricao.nome_completo}?\n\nMotivo: "${motivo.trim()}"`,
      confirmLabel: 'Rejeitar',
      danger: true,
    })
    if (!confirmado) return

    setAcaoLoading('rejeitar')
    const r = await rejeitarInscricao(inscricao.id, motivo)
    setAcaoLoading(null)

    if (!r.ok) {
      setAcaoError(r.erro ?? 'Erro desconhecido.')
      return
    }
    onChanged()
    onClose()
  }, [inscricao, motivo, onChanged, onClose])

  const turmasDoCurso = turmas.filter(
    (t) => t.curso_id === inscricao.curso_id && t.vagas_preenchidas < t.limite_vagas,
  )

  const dado = (label: string, valor: string | null | undefined) => (
    <div>
      <p className="label-section">{label}</p>
      <p className="tnum mt-0.5 text-sm text-ink">{valor || ''}</p>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <div className="overlay-in flex h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg border border-line bg-surface">
        {/* Painel esquerdo: dados do candidato */}
        <div className="flex w-1/2 flex-col border-r border-line">
          <div className="flex items-start justify-between border-b border-line px-5 py-3.5">
            <div>
              <p className="font-mono text-xs text-ink-muted">{inscricao.numero_inscricao}</p>
              <h2 className="mt-0.5 font-serif text-lg font-semibold text-ink">{inscricao.nome_completo}</h2>
            </div>
            <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Fechar">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <Badge variant={inscricao.estado}>{ESTADO_LABELS[inscricao.estado]}</Badge>

            <div className="grid grid-cols-2 gap-4">
              {dado('Bilhete de Identidade', inscricao.numero_bi)}
              {dado('Data de Nascimento', format.date(inscricao.data_nascimento))}
              {dado('Género', inscricao.genero)}
              {dado('Telefone WhatsApp', inscricao.telefone_whatsapp)}
              {dado('Email', inscricao.email)}
              {dado('Turno Pretendido', TURNO_LABELS[inscricao.turno_pretendido])}
            </div>

            {inscricao.estado === 'rejeitado' && inscricao.motivo_rejeicao && (
              <div className="rounded-md border border-danger bg-danger-soft px-3.5 py-2.5">
                <p className="label-section text-danger">Motivo da rejeição</p>
                <p className="mt-1 text-sm text-ink">{inscricao.motivo_rejeicao}</p>
              </div>
            )}

            {inscricao.estado === 'aprovado' && (
              <div className="rounded-md border border-ok bg-ok-soft px-3.5 py-2.5">
                <p className="text-sm text-ink">✓ Inscrição aprovada. Aloque o candidato numa turma para concluir a matrícula.</p>
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="border-t border-line px-5 py-3.5">
            {pendentes > 0 && (
              <p className="mb-3 rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs text-ink">
                ⚠ {pendentes} documento(s) pendente(s) de validação: a aprovação está bloqueada até validar tudo.
              </p>
            )}
            {acaoError && <p className="mb-3 text-sm text-danger">{acaoError}</p>}

            {modoAlocacao ? (
              <div className="space-y-3">
                <p className="text-[13px] font-medium text-ink">Alocar numa turma:</p>
                <select
                  value={turmaId}
                  onChange={(e) => setTurmaId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">Seleccionar turma com vagas...</option>
                  {turmasDoCurso.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome_turma}, {TURNO_LABELS[t.turno]}, {t.ano_lectivo} (
                      {t.limite_vagas - t.vagas_preenchidas} vagas)
                    </option>
                  ))}
                </select>
                {turmasDoCurso.length === 0 && (
                  <p className="text-xs text-warn">Nenhuma turma deste curso tem vagas disponíveis.</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAprovar(true)}
                    disabled={!turmaId || acaoLoading !== null}
                    className="btn-primary flex-1"
                  >
                    {acaoLoading === 'alocar' && <Spinner className="h-4 w-4" />}
                    {inscricao.estado === 'aprovado' ? 'Matricular' : 'Aprovar + Matricular'}
                  </button>
                  <button onClick={() => setModoAlocacao(false)} className="btn-secondary">
                    Voltar
                  </button>
                </div>
              </div>
            ) : modoRejeitar ? (
              <div className="space-y-3">
                <label className="label-section block">Motivo da rejeição:</label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  className="input w-full"
                  placeholder="Ex.: Documentos ilegíveis..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleRejeitar()}
                    disabled={!motivo.trim() || acaoLoading !== null}
                    className="btn flex-1 bg-danger text-surface hover:opacity-90"
                  >
                    {acaoLoading === 'rejeitar' && <Spinner className="h-4 w-4" />}
                    Confirmar rejeição
                  </button>
                  <button onClick={() => setModoRejeitar(false)} className="btn-secondary">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setModoAlocacao(true)}
                  disabled={acaoLoading !== null}
                  className="btn-primary flex-1"
                >
                  {acaoLoading === 'aprovar' && <Spinner className="h-4 w-4" />}
                  {inscricao.estado === 'aprovado' ? 'Matricular numa turma' : 'Aprovar Inscrição'}
                </button>
                <button
                  onClick={() => setModoRejeitar(true)}
                  disabled={acaoLoading !== null || inscricao.estado === 'rejeitado'}
                  className="btn flex-1 bg-danger text-surface hover:opacity-90"
                >
                  Rejeitar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Painel direito: visualizador de documentos com signed URLs */}
        <div className="flex w-1/2 flex-col bg-canvas">
          <div className="border-b border-line px-5 py-3.5">
            <h3 className="text-[13px] font-semibold text-ink">Documentos Anexados</h3>
            <p className="text-xs text-ink-faint">Links temporários e seguros (expiram em 10 minutos)</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {docsLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-ink-muted">
                <Spinner /> <span className="text-sm">A carregar documentos...</span>
              </div>
            ) : docsError ? (
              <p className="text-sm text-danger">{docsError}</p>
            ) : !documentos?.length ? (
              <EmptyState message="Nenhum documento anexado a esta inscrição." icon="📎" />
            ) : (
              documentos.map((doc) => (
                <DocumentoItem
                  key={doc.id}
                  doc={doc}
                  onValidacaoMudou={(validado) =>
                    setPendentes((p) => Math.max(0, p + (validado ? -1 : 1)))
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
