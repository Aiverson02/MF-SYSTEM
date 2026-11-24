import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { DocumentoInscricao, Inscricao, TipoDocumento } from '../types/database'
import { ESTADO_LABELS, TIPO_DOC_LABELS, TURNO_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, PageHeader } from '../components/ui'
import { format } from '../lib/format'
import { pushToast } from '../components/ToastHost'
import { useEdicao } from '../hooks/useEdicao'

type FiltroOrigem = 'online' | 'todas'

const STORAGE = 'documentos-inscricao'

export default function Candidaturas() {
  const [params] = useSearchParams()
  const validarId = params.get('validar')
  // Candidaturas da edição escolhida no cabeçalho.
  const { edicaoId } = useEdicao()
  const [filtro, setFiltro] = useState<FiltroOrigem>('online')
  const [pesquisa, setPesquisa] = useState('')
  const [expandida, setExpandida] = useState<string | null>(validarId)

  const fetcher = useCallback(async (): Promise<
    { data: Inscricao[] | null; error: { message: string } | null }
  > => {
    let query = supabase
      .from('inscricoes')
      .select('*, cursos(nome, codigo), turmas(nome_turma, turno, ano_lectivo)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (edicaoId) query = query.eq('edicao_id', edicaoId)
    return (await query) as { data: Inscricao[] | null; error: { message: string } | null }
  }, [edicaoId])

  const { data: inscricoes, loading, error, reload } = useAsyncData<Inscricao[]>(fetcher, [edicaoId])

  // Tipos de documento por inscrição — alimenta os selos BI/recibo da lista.
  // Uma leitura só, em vez de um pedido por linha.
  const [docsPorInscricao, setDocsPorInscricao] = useState<Record<string, TipoDocumento[]>>({})

  const carregarDocs = useCallback(async () => {
    const { data } = await supabase
      .from('documentos_inscricao')
      .select('inscricao_id, tipo_documento')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (!data) return
    const mapa: Record<string, TipoDocumento[]> = {}
    for (const d of data as { inscricao_id: string; tipo_documento: TipoDocumento }[]) {
      mapa[d.inscricao_id] = [...(mapa[d.inscricao_id] ?? []), d.tipo_documento]
    }
    setDocsPorInscricao(mapa)
  }, [])

  useEffect(() => {
    void carregarDocs()
  }, [carregarDocs])

  const linhas = useMemo<Inscricao[]>(() => {
    let base = inscricoes ?? []
    if (filtro === 'online') base = base.filter((i) => i.origem === 'online')
    const q = pesquisa.trim().toLowerCase()
    if (q) {
      base = base.filter(
        (i) =>
          i.nome_completo.toLowerCase().includes(q) ||
          (i.numero_bi ?? '').toLowerCase().includes(q) ||
          i.numero_inscricao.toLowerCase().includes(q),
      )
    }
    return base
  }, [inscricoes, filtro, pesquisa])

  // Ver documento: cria signed URL a pedido (bucket privado)
  const verDocumento = async (doc: DocumentoInscricao) => {
    if (!doc.url_ficheiro) return
    const { data, error } = await supabase.storage
      .from(STORAGE)
      .createSignedUrl(doc.url_ficheiro, 300)
    if (error || !data) {
      pushToast(error?.message ?? 'Não foi possível abrir o documento.', 'erro')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const alterarEstado = async (i: Inscricao, novoEstado: Inscricao['estado']) => {
    const { error } = await supabase.from('inscricoes').update({ estado: novoEstado }).eq('id', i.id)
    if (error) {
      // Ex.: "Aprovação bloqueada: N documento(s) ainda sem validação" (regra 003)
      pushToast(error.message.replace('Aprovação bloqueada: ', '') + '. Valide os documentos na linha expandida.', 'erro')
      return
    }
    pushToast(`${i.nome_completo}: ${ESTADO_LABELS[novoEstado]}.`, 'sucesso')
    void reload()
  }

  // Rejeição: a base exige motivo_rejeicao preenchido com estado = 'rejeitado'
  // (constraint da 001). Sem o motivo, o UPDATE falhava sempre.
  const [rejeitando, setRejeitando] = useState<Inscricao | null>(null)
  const [motivo, setMotivo] = useState('')
  const [aRejeitar, setARejeitar] = useState(false)

  const abrirRejeicao = (i: Inscricao) => {
    setMotivo('')
    setRejeitando(i)
  }

  const confirmarRejeicao = async () => {
    if (!rejeitando) return
    const motivoLimpo = motivo.trim()
    if (!motivoLimpo) {
      pushToast('Indique o motivo da rejeição.', 'erro')
      return
    }
    setARejeitar(true)
    const { error } = await supabase
      .from('inscricoes')
      .update({ estado: 'rejeitado', motivo_rejeicao: motivoLimpo })
      .eq('id', rejeitando.id)
    setARejeitar(false)
    if (error) {
      pushToast(error.message, 'erro')
      return
    }
    pushToast(`${rejeitando.nome_completo}: rejeitada.`, 'sucesso')
    setRejeitando(null)
    void reload()
  }

  return (
    <>
      <PageHeader
        title="Candidaturas Online"
        subtitle="Formulários submetidos pelo site da instituição"
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => void reload()} />
      ) : (
        <div className="cell">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <div className="flex w-fit gap-0.5 rounded-md border border-line p-0.5">
              {(['online', 'todas'] as FiltroOrigem[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`rounded px-3 py-1 text-[13px] font-medium ${
                    filtro === f ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  {f === 'online' ? 'Do site' : 'Todas'}
                </button>
              ))}
            </div>
            <input
              value={pesquisa}
              onChange={(e) => setPesquisa(e.target.value)}
              className="input ml-auto w-64"
              placeholder="Pesquisar por nome, BI ou nº..."
            />
          </div>

          {linhas.length === 0 ? (
            <EmptyState
              message="Nenhuma candidatura encontrada. As submissões do site aparecem aqui automaticamente."
              icon="🌐"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="px-4 py-2.5 font-medium">Nº / Data</th>
                    <th className="px-4 py-2.5 font-medium">Candidato</th>
                    <th className="px-4 py-2.5 font-medium">Curso</th>
                    <th className="px-4 py-2.5 font-medium">Turma / Edição</th>
                    <th className="px-4 py-2.5 font-medium">Documentos</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {linhas.map((i) => {
                    const tipos = docsPorInscricao[i.id] ?? []
                    const aberta = expandida === i.id
                    return (
                      <DocRow
                        key={i.id}
                        inscricao={i}
                        tipos={tipos}
                        aberta={aberta}
                        onToggle={() => setExpandida(aberta ? null : i.id)}
                        onVerDoc={verDocumento}
                        onEstado={alterarEstado}
                        onRejeitar={abrirRejeicao}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {rejeitando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
          <div className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-5">
            <h3 className="font-serif text-lg font-semibold text-ink">Rejeitar candidatura</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              {rejeitando.nome_completo} · <span className="font-mono text-xs">{rejeitando.numero_inscricao}</span>
            </p>
            <label className="label-section mb-1 mt-4 block">Motivo da rejeição *</label>
            <textarea
              autoFocus
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="input w-full"
              placeholder="Ex.: Documentos ilegíveis ou em falta."
            />
            <p className="mt-1 text-xs text-ink-faint">O motivo fica registado na candidatura.</p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void confirmarRejeicao()}
                disabled={aRejeitar || !motivo.trim()}
                className="btn-danger flex-1"
              >
                {aRejeitar ? 'A rejeitar...' : 'Rejeitar candidatura'}
              </button>
              <button onClick={() => setRejeitando(null)} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DocRow({
  inscricao: i,
  tipos,
  aberta,
  onToggle,
  onVerDoc,
  onEstado,
  onRejeitar,
}: {
  inscricao: Inscricao
  tipos: TipoDocumento[]
  aberta: boolean
  onToggle: () => void
  onVerDoc: (doc: DocumentoInscricao) => void
  onEstado: (i: Inscricao, estado: Inscricao['estado']) => void
  onRejeitar: (i: Inscricao) => void
}) {
  const [docs, setDocs] = useState<DocumentoInscricao[] | null>(null)
  const [loadingDocs, setLoadingDocs] = useState(false)

  const carregar = async () => {
    if (docs || loadingDocs) return
    setLoadingDocs(true)
    const { data } = await supabase
      .from('documentos_inscricao')
      .select('*')
      .eq('inscricao_id', i.id)
      .order('created_at')
    setDocs((data ?? []) as DocumentoInscricao[])
    setLoadingDocs(false)
  }

  const toggle = () => {
    onToggle()
    if (!aberta) void carregar()
  }

  const validarDoc = async (doc: DocumentoInscricao) => {
    const { error } = await supabase
      .from('documentos_inscricao')
      .update({ estado_validacao: true })
      .eq('id', doc.id)
    if (error) {
      pushToast(error.message, 'erro')
      return
    }
    setDocs((prev) => (prev ?? []).map((d) => (d.id === doc.id ? { ...d, estado_validacao: true } : d)))
    pushToast(`${TIPO_DOC_LABELS[doc.tipo_documento]} validado.`, 'sucesso')
  }

  const temBi = tipos.includes('bi')
  const temRecibo = tipos.includes('comprovativo_pagamento')

  return (
    <>
      <tr className={`hover:bg-canvas ${aberta ? 'bg-raised/50' : ''}`}>
        <td className="px-4 py-2.5">
          <p className="font-mono text-xs text-ink-muted">{i.numero_inscricao}</p>
          <p className="text-xs text-ink-faint">{format.dateTime(i.created_at)}</p>
        </td>
        <td className="px-4 py-2.5">
          <p className="font-medium text-ink">{i.nome_completo}</p>
          <p className="font-mono text-[11px] text-ink-faint">{i.numero_bi}</p>
        </td>
        <td className="px-4 py-2.5 text-ink-muted">
          {i.cursos?.nome}
          <span className="block text-xs text-ink-faint">{i.telefone_whatsapp}</span>
        </td>
        <td className="px-4 py-2.5">
          {i.turmas ? (
            <>
              <p className="text-ink">{i.turmas.nome_turma}</p>
              <p className="text-xs text-ink-faint">
                {TURNO_LABELS[i.turmas.turno]} · {i.turmas.ano_lectivo}
              </p>
            </>
          ) : (
            <span className="text-xs text-ink-faint">— a alocar</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex flex-col items-start gap-1">
            <button
              onClick={toggle}
              className="text-left text-[13px] font-medium text-accent hover:text-accent-strong"
            >
              {tipos.length > 0 ? `${tipos.length} documento(s)` : 'Ver / carregar'}
            </button>
            <span className="flex gap-2.5 text-[11px] text-ink-faint">
              <span className={temBi ? 'text-ok' : ''}>
                <span aria-hidden>{temBi ? '✓' : '·'}</span> BI
              </span>
              <span className={temRecibo ? 'text-ok' : ''}>
                <span aria-hidden>{temRecibo ? '✓' : '·'}</span> Recibo
              </span>
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <Badge variant={i.estado}>{ESTADO_LABELS[i.estado]}</Badge>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex justify-end gap-2">
            <Link to={`/admin/inscricoes?validar=${i.id}`} className="btn-secondary px-2.5 py-1 text-xs">
              Validar
            </Link>
            {i.estado !== 'aprovado' && (
              <button onClick={() => onEstado(i, 'aprovado')} className="btn-primary px-2.5 py-1 text-xs">
                Aprovar
              </button>
            )}
            {i.estado !== 'rejeitado' && (
              <button onClick={() => onRejeitar(i)} className="btn-danger px-2.5 py-1 text-xs">
                Rejeitar
              </button>
            )}
          </div>
        </td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={7} className="border-b border-line bg-raised/30 px-4 py-3">
            {loadingDocs ? (
              <p className="text-xs text-ink-muted">A carregar documentos...</p>
            ) : !docs || docs.length === 0 ? (
              <p className="text-xs text-ink-muted">Nenhum documento anexado a esta candidatura.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex max-w-sm flex-col gap-1 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink"
                  >
                    <div className="flex items-center gap-2">
                      {d.url_ficheiro ? (
                        <button onClick={() => onVerDoc(d)} className="flex items-center gap-2 hover:text-accent">
                          <span aria-hidden>📄</span>
                          <span className="font-medium">{TIPO_DOC_LABELS[d.tipo_documento]}</span>
                        </button>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span aria-hidden>✎</span>
                          <span className="font-medium">{TIPO_DOC_LABELS[d.tipo_documento]}</span>
                        </span>
                      )}
                      {d.estado_validacao ? (
                        <span className="text-ok">✓</span>
                      ) : (
                        <button
                          onClick={() => void validarDoc(d)}
                          className="rounded bg-warn-soft px-1.5 py-0.5 font-medium text-warn hover:opacity-80"
                          title="Marcar como validado"
                        >
                          Validar
                        </button>
                      )}
                    </div>
                    {d.texto && <p className="text-[11px] italic text-ink-muted">“{d.texto}”</p>}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
