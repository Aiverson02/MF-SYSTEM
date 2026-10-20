import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { DocumentoInscricao, Inscricao } from '../types/database'
import { ESTADO_LABELS, TIPO_DOC_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, PageHeader } from '../components/ui'
import { format } from '../lib/format'
import { pushToast } from '../components/ToastHost'

type FiltroOrigem = 'online' | 'todas'

interface Linha {
  inscricao: Inscricao
  docs: DocumentoInscricao[]
  /** assinatura do storage para o conjunto de documentos (renovada a cada reload) */
  docsAssinados: Map<string, string>
}

const STORAGE = 'documentos-inscricao'

export default function Candidaturas() {
  const [params] = useSearchParams()
  const validarId = params.get('validar')
  const [filtro, setFiltro] = useState<FiltroOrigem>('online')
  const [pesquisa, setPesquisa] = useState('')
  const [expandida, setExpandida] = useState<string | null>(validarId)

  const fetcher = useCallback(async (): Promise<
    { data: Inscricao[] | null; error: { message: string } | null }
  > => {
    return (await supabase
      .from('inscricoes')
      .select('*, cursos(nome, codigo)')
      .order('created_at', { ascending: false })
      .limit(500)) as { data: Inscricao[] | null; error: { message: string } | null }
  }, [])

  const { data: inscricoes, loading, error, reload } = useAsyncData<Inscricao[]>(fetcher, [])

  const linhas = useMemo<Linha[]>(() => {
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
    return base.map((i) => ({ inscricao: i, docs: [], docsAssinados: new Map() }))
  }, [inscricoes, filtro, pesquisa])

  const [docsCount, setDocsCount] = useState<Record<string, number>>({})

  const carregarDocs = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const { data } = await supabase
        .from('documentos_inscricao')
        .select('*')
        .in('inscricao_id', ids)
      if (data) {
        const counts: Record<string, number> = {}
        for (const d of data as DocumentoInscricao[]) {
          counts[d.inscricao_id] = (counts[d.inscricao_id] ?? 0) + 1
        }
        setDocsCount((prev) => ({ ...prev, ...counts }))
      }
    },
    [],
  )

  // Ver documento: cria signed URL a pedido (bucket privado)
  const verDocumento = async (doc: DocumentoInscricao) => {
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
                    <th className="px-4 py-2.5 font-medium">Documentos</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {linhas.map((l) => {
                    const i = l.inscricao
                    const ndocs = docsCount[i.id] ?? 0
                    const aberta = expandida === i.id
                    return (
                      <DocRow
                        key={i.id}
                        inscricao={i}
                        ndocs={ndocs}
                        aberta={aberta}
                        onToggle={async () => {
                          const nova = aberta ? null : i.id
                          setExpandida(nova)
                          if (nova && ndocs === 0) {
                            await carregarDocs([i.id])
                          }
                        }}
                        onVerDoc={verDocumento}
                        onEstado={alterarEstado}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function DocRow({
  inscricao: i,
  ndocs,
  aberta,
  onToggle,
  onVerDoc,
  onEstado,
}: {
  inscricao: Inscricao
  ndocs: number
  aberta: boolean
  onToggle: () => void
  onVerDoc: (doc: DocumentoInscricao) => void
  onEstado: (i: Inscricao, estado: Inscricao['estado']) => void
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
          <button
            onClick={toggle}
            className="text-[13px] font-medium text-accent hover:text-accent-strong"
          >
            {ndocs > 0 ? `${ndocs} documento(s)` : 'Ver / carregar'}
          </button>
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
              <button onClick={() => onEstado(i, 'rejeitado')} className="btn-danger px-2.5 py-1 text-xs">
                Rejeitar
              </button>
            )}
          </div>
        </td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={6} className="border-b border-line bg-raised/30 px-4 py-3">
            {loadingDocs ? (
              <p className="text-xs text-ink-muted">A carregar documentos...</p>
            ) : !docs || docs.length === 0 ? (
              <p className="text-xs text-ink-muted">Nenhum documento anexado a esta candidatura.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink"
                  >
                    <button onClick={() => onVerDoc(d)} className="flex items-center gap-2 hover:text-accent">
                      <span aria-hidden>📄</span>
                      <span className="font-medium">{TIPO_DOC_LABELS[d.tipo_documento]}</span>
                    </button>
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
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
