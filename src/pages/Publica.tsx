import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Curso, TipoDocumento } from '../types/database'
import { TIPO_DOC_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { useInstituicao } from '../hooks/useInstituicao'
import InscricaoForm from '../components/InscricaoForm'
import { LoadingBlock, ErrorMessage, Spinner } from '../components/ui'

interface Consulta {
  numero_inscricao: string
  nome_completo: string
  curso: string
  estado: string
  motivo_rejeicao: string | null
  created_at: string
}

const ESTADO_PUBLICO: Record<string, { label: string; cor: string }> = {
  pendente: { label: 'Pendente: aguarda análise pela secretaria.', cor: 'text-warn' },
  em_analise: { label: 'Em análise: os seus documentos estão a ser verificados.', cor: 'text-accent' },
  aprovado: { label: 'Aprovado! Contacte a secretaria para concluir a matrícula.', cor: 'text-ok' },
  rejeitado: { label: 'Não aprovada.', cor: 'text-danger' },
  com_pendencia: { label: 'Com pendência: verifique os seus documentos com a secretaria.', cor: 'text-warn' },
}

const TODOS_TIPOS: TipoDocumento[] = ['bi', 'foto_passe', 'certificado', 'comprovativo_pagamento']

// ---------------------------------------------------------------------------
// Aba: anexar documentos a uma inscrição existente (pendente / incompleta)
// ---------------------------------------------------------------------------

function AnexarDocs() {
  const [numero, setNumero] = useState('')
  const [bi, setBi] = useState('')
  const [localizada, setLocalizada] = useState<{ id: string; estado: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aLocalizar, setALocalizar] = useState(false)
  const [ficheiros, setFicheiros] = useState<{ file: File; tipo: TipoDocumento }[]>([])
  const [aEnviar, setAEnviar] = useState(false)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const localizar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setLocalizada(null)
    setSucesso(null)
    if (!numero.trim() || !bi.trim()) {
      setErro('Indique o número de inscrição e o nº do BI.')
      return
    }
    setALocalizar(true)
    const { data, error } = await supabase.rpc('localizar_inscricao_para_docs', {
      p_numero_inscricao: numero.trim(),
      p_numero_bi: bi.trim().toUpperCase(),
    })
    setALocalizar(false)
    if (error) {
      setErro(error.message)
      return
    }
    const r = (data as { inscricao_id: string; estado: string }[])?.[0]
    if (!r) {
      setErro('Nenhuma inscrição encontrada com esse número e BI. Confirme os dados.')
      return
    }
    if (!['pendente', 'com_pendencia', 'em_analise'].includes(r.estado)) {
      setErro(
        r.estado === 'aprovado'
          ? 'A sua inscrição já foi aprovada — não é necessário enviar mais documentos.'
          : 'Esta inscrição já não aceita documentos. Contacte a secretaria.',
      )
      return
    }
    setLocalizada({ id: r.inscricao_id, estado: r.estado })
  }

  const adicionar = (lista: FileList | null) => {
    if (!lista) return
    const novos: { file: File; tipo: TipoDocumento }[] = []
    for (const file of Array.from(lista)) {
      const ok = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)
      if (!ok) {
        setErro(`Ficheiro "${file.name}": formato não suportado (use PNG, JPEG, WebP ou PDF).`)
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        setErro(`Ficheiro "${file.name}" excede 10MB.`)
        continue
      }
      const nome = file.name.toLowerCase()
      const tipo: TipoDocumento = nome.includes('bi') || nome.includes('bilhete')
        ? 'bi'
        : nome.includes('certificado')
          ? 'certificado'
          : nome.includes('comprovativo') || nome.includes('pagamento')
            ? 'comprovativo_pagamento'
            : 'foto_passe'
      novos.push({ file, tipo })
    }
    setFicheiros((prev) => [...prev, ...novos])
  }

  const enviar = async () => {
    if (!localizada || ficheiros.length === 0) return
    setErro(null)
    setAEnviar(true)
    try {
      for (const f of ficheiros) {
        const ext = f.file.name.split('.').pop() ?? 'bin'
        const path = `${localizada.id}/${f.tipo}-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`
        const { error: errUp } = await supabase.storage.from('documentos-inscricao').upload(path, f.file, {
          contentType: f.file.type,
          upsert: false,
        })
        if (errUp) throw errUp
        const { data: docId, error: errDoc } = await supabase.rpc('anexar_documento_inscricao', {
          p_inscricao_id: localizada.id,
          p_tipo_documento: f.tipo,
          p_url_ficheiro: path,
        })
        if (errDoc || !docId) throw errDoc ?? new Error('Não foi possível registar o documento.')
      }
      setSucesso(`${ficheiros.length} documento(s) enviado(s) com sucesso. A secretaria irá analisá-los.`)
      setFicheiros([])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar documentos.')
    } finally {
      setAEnviar(false)
    }
  }

  if (sucesso) {
    return (
      <div className="cell p-8 text-center">
        <p className="font-serif text-xl font-semibold text-ok">Documentos recebidos!</p>
        <p className="mt-2 text-sm text-ink-muted">{sucesso}</p>
        <button
          onClick={() => {
            setSucesso(null)
            setLocalizada(null)
            setNumero('')
            setBi('')
          }}
          className="btn-secondary mt-4"
        >
          Enviar mais documentos
        </button>
      </div>
    )
  }

  return (
    <div className="cell p-5">
      <p className="prose-reading text-sm text-ink-muted">
        A sua inscrição está pendente ou incompleta? Identifique-se com o número de inscrição e o BI
        para anexar documentos que faltam (BI, certificado, comprovativo, etc.).
      </p>

      <form onSubmit={localizar} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label-section mb-1 block">Nº de inscrição</label>
          <input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="INS-2026-000123"
            className="input w-full font-mono"
          />
        </div>
        <div>
          <label className="label-section mb-1 block">Nº do BI</label>
          <input value={bi} onChange={(e) => setBi(e.target.value)} className="input w-full font-mono" />
        </div>
        <button type="submit" disabled={aLocalizar} className="btn-primary h-[38px]">
          {aLocalizar && <Spinner className="h-4 w-4" />}
          {aLocalizar ? 'A localizar...' : 'Localizar inscrição'}
        </button>
      </form>

      {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

      {localizada && (
        <div className="mt-4 rounded-md border border-line bg-canvas p-4">
          <p className="text-sm">
            <span className="font-medium text-ink">Inscrição {numero.toUpperCase()}</span>
            <span className="ml-2 text-warn">aceita documentos</span>
          </p>

          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              adicionar(e.target.files)
              e.target.value = ''
            }}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="btn-primary mt-3 w-full sm:w-auto"
          >
            + Anexar documentos
          </button>
          <p className="mt-1.5 text-xs text-ink-faint">
            PNG, JPEG, WebP ou PDF até 10MB cada. O tipo de cada documento pode ser ajustado abaixo.
          </p>

          {ficheiros.length > 0 && (
            <div className="mt-3 space-y-2">
              {ficheiros.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">📄 {f.file.name}</span>
                  <select
                    value={f.tipo}
                    onChange={(e) =>
                      setFicheiros((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoDocumento } : x)),
                      )
                    }
                    className="input h-8 w-44 text-xs"
                  >
                    {TODOS_TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {TIPO_DOC_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFicheiros((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-danger hover:opacity-80"
                    title="Remover"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button onClick={() => void enviar()} disabled={aEnviar} className="btn-primary">
                {aEnviar && <Spinner className="h-4 w-4" />}
                {aEnviar ? 'A enviar...' : `Enviar ${ficheiros.length} documento(s)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function Publica() {
  const [tab, setTab] = useState<'inscricao' | 'consulta' | 'docs'>('inscricao')
  const instituicao = useInstituicao()

  // Cursos activos para o formulário
  const cursosFetcher = useCallback(
    async () =>
      (await supabase.from('cursos').select('*').eq('ativo', true).order('nome')) as {
        data: Curso[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cursos, loading: loadingCursos, error: errorCursos, reload: reloadCursos } = useAsyncData<Curso[]>(cursosFetcher, [])

  // Consulta de estado
  const [cNumero, setCNumero] = useState('')
  const [cBi, setCBi] = useState('')
  const [consulta, setConsulta] = useState<Consulta | null>(null)
  const [consultaErro, setConsultaErro] = useState<string | null>(null)
  const [consultando, setConsultando] = useState(false)

  const consultar = async (e: React.FormEvent) => {
    e.preventDefault()
    setConsultaErro(null)
    setConsulta(null)
    if (!cNumero.trim() || !cBi.trim()) {
      setConsultaErro('Indique o número de inscrição e o BI.')
      return
    }
    setConsultando(true)
    const { data, error } = await supabase.rpc('consultar_inscricao_publica', {
      p_numero: cNumero.trim(),
      p_bi: cBi.trim().toUpperCase(),
    })
    setConsultando(false)
    if (error) {
      setConsultaErro(error.message)
      return
    }
    const r = (data as Consulta[])?.[0]
    if (!r) setConsultaErro('Nenhuma inscrição encontrada com esses dados. Confirme o número e o BI.')
    else setConsulta(r)
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Cabeçalho público */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          {instituicao.logo_url ? (
            <img
              src={instituicao.logo_url}
              alt={`Logótipo de ${instituicao.nome}`}
              className="h-9 w-9 rounded-md border border-line object-contain bg-surface"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-surface">
              {instituicao.nome
                .split(/\s+/)
                .filter((p) => p.length > 2)
                .slice(0, 2)
                .map((s) => s[0]?.toUpperCase())
                .join('') || 'CF'}
            </div>
          )}
          <div>
            <p className="text-[15px] font-semibold text-ink">{instituicao.nome}</p>
            <p className="label-section text-[10px]">Inscrições abertas</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-3xl font-semibold text-ink">Candidate-se a um curso</h1>
        <p className="prose-reading mt-2 text-[15px] text-ink-muted">
          Preencha o formulário, anexe os seus documentos e submeta. Receberá um número de inscrição para acompanhar o estado da sua candidatura.
        </p>

        {/* Abas */}
        <div className="mt-6 flex w-fit gap-0.5 rounded-md border border-line p-0.5">
          {(['inscricao', 'consulta', 'docs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-[13px] font-medium ${
                tab === t ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {t === 'inscricao' ? 'Nova inscrição' : t === 'consulta' ? 'Consultar estado' : 'Anexar documentos'}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'inscricao' ? (
            loadingCursos ? (
              <LoadingBlock label="A carregar cursos..." />
            ) : errorCursos ? (
              <ErrorMessage message={errorCursos} onRetry={() => void reloadCursos()} />
            ) : (cursos ?? []).length === 0 ? (
              <div className="cell p-8 text-center text-sm text-ink-muted">
                De momento não há cursos com inscrições abertas. Volte em breve.
              </div>
            ) : (
              <InscricaoForm cursos={cursos ?? []} />
            )
          ) : tab === 'consulta' ? (
            <div className="cell p-5">
              <form onSubmit={consultar} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <label className="label-section mb-1 block">Nº de inscrição</label>
                  <input
                    value={cNumero}
                    onChange={(e) => setCNumero(e.target.value)}
                    placeholder="INS-2026-000123"
                    className="input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="label-section mb-1 block">Nº do BI</label>
                  <input value={cBi} onChange={(e) => setCBi(e.target.value)} className="input w-full font-mono" />
                </div>
                <button type="submit" disabled={consultando} className="btn-primary h-[38px]">
                  {consultando ? 'A consultar...' : 'Consultar'}
                </button>
              </form>

              {consultaErro && <p className="mt-3 text-sm text-danger">{consultaErro}</p>}

              {consulta && (
                <div className="mt-4 rounded-md border border-line bg-canvas p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">{consulta.nome_completo}</p>
                    <p className="font-mono text-xs text-ink-muted">{consulta.numero_inscricao}</p>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">Curso: {consulta.curso}</p>
                  <p className={`mt-2 text-sm font-medium ${ESTADO_PUBLICO[consulta.estado]?.cor ?? 'text-ink'}`}>
                    {ESTADO_PUBLICO[consulta.estado]?.label ?? consulta.estado}
                  </p>
                  {consulta.motivo_rejeicao && (
                    <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-ink">
                      Motivo: {consulta.motivo_rejeicao}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <AnexarDocs />
          )}
        </div>
      </main>

      <footer className="mx-auto max-w-3xl px-4 py-8 text-center text-xs text-ink-faint sm:px-6">
        <p>{instituicao.nome}: gestão de inscrições académicas</p>
        {(instituicao.telefone || instituicao.email || instituicao.endereco) && (
          <p className="mt-1">
            {[instituicao.telefone, instituicao.email, instituicao.endereco].filter(Boolean).join(' · ')}
          </p>
        )}
      </footer>
    </div>
  )
}
