import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Curso, Turno } from '../types/database'
import { TURNO_LABELS } from '../types/database'
import { supabase } from '../lib/supabase'
import { useAsyncData } from '../hooks/useAsyncData'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { LoadingBlock, ErrorMessage, Spinner } from './ui'
import { confirmarAcao, showError, showInfo, showSuccess } from '../lib/alerts'
import {
  MODELO_CSV,
  importarInscricoes,
  lerFicheiro,
  mapearLinhas,
  type ResumoImportacao,
  type ResultadoLeitura,
} from '../lib/importarAlunos'

/**
 * Importação de alunos por CSV/Excel: a secretaria escolhe o ficheiro, o curso
 * e o turno; o sistema cria as inscrições e matricula cada candidato na turma
 * do curso+turno com vagas.
 */
export default function ImportarInscricoesModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)

  const cursosFetcher = useCallback(
    async () =>
      (await supabase.from('cursos').select('*').eq('ativo', true).order('nome')) as {
        data: Curso[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cursos, loading: loadingCursos, error: erroCursos, reload } = useAsyncData<Curso[]>(cursosFetcher, [])

  const [cursoId, setCursoId] = useState('')
  const [turno, setTurno] = useState<Turno | ''>('')
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null)
  const [nomeFicheiro, setNomeFicheiro] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aProcessar, setAProcessar] = useState(false)
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null)
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null)
  const ficheiroRef = useRef<HTMLInputElement>(null)

  const validas = useMemo(() => (leitura?.linhas ?? []).filter((l) => !l.erro).length, [leitura])
  const invalidas = useMemo(() => (leitura?.linhas ?? []).filter((l) => l.erro).length, [leitura])
  const preenchido = Boolean(leitura) && Boolean(cursoId) && Boolean(turno)

  const escolherFicheiro = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErro(null)
    setResumo(null)
    setLeitura(null)
    setNomeFicheiro('')
    if (file.size > 5 * 1024 * 1024) {
      setErro('O ficheiro deve ter no máximo 5MB.')
      return
    }
    try {
      const rows = await lerFicheiro(file)
      const r = mapearLinhas(rows)
      setLeitura(r)
      setNomeFicheiro(file.name)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível ler o ficheiro.')
    }
  }

  const descarregarModelo = () => {
    const blob = new Blob(['\uFEFF' + MODELO_CSV], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'modelo-importar-alunos.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importar = async () => {
    if (!leitura || !cursoId || !turno) return
    setErro(null)
    setResumo(null)
    const r = await importarInscricoes({
      linhas: leitura.linhas,
      cursoId,
      turno,
      confirmar: async ({ validas: v, invalidas: inv }) => {
        const curso = (cursos ?? []).find((c) => c.id === cursoId)?.nome ?? 'curso'
        const ok = await confirmarAcao({
          title: 'Importar alunos',
          message:
            `Serão criadas ${v} inscrição(ões) em "${curso}" — ${TURNO_LABELS[turno]}.\n\n` +
            'Cada candidato é aprovado e matriculado na primeira turma deste curso e turno com vagas livres. ' +
            'Quem não encontrar turma fica inscrito e pendente, e aparece no resumo.' +
            (inv > 0 ? `\n\n${inv} linha(s) com dados inválidos serão ignoradas.` : ''),
          confirmLabel: 'Importar',
        })
        if (!ok) return false
        setAProcessar(true)
        return true
      },
      onProgresso: (feitas, total) => setProgresso({ feitas, total }),
    })
    setAProcessar(false)
    setProgresso(null)

    if (r.estado === 'cancelado') return
    if (r.estado === 'erro') {
      showError(r.erro)
      return
    }

    setResumo(r.resumo)
    onDone()
    if (r.resumo.matriculados > 0) {
      showSuccess(`${r.resumo.matriculados} aluno(s) importado(s) e matriculado(s).`)
    } else if (r.resumo.inscritos > 0) {
      showInfo(`${r.resumo.inscritos} inscrição(ões) criada(s), mas sem turma com vagas no turno escolhido.`)
    } else {
      showError('Nenhuma linha foi importada — veja os erros no resumo.')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <div className="overlay-in flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h3 className="font-serif text-lg font-semibold text-ink">Importar alunos (CSV / Excel)</h3>
            <p className="text-xs text-ink-faint">
              Todos os candidatos do ficheiro entram no curso e turno escolhidos e são encaixados na turma com vagas.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Fechar">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loadingCursos ? (
            <LoadingBlock label="A carregar cursos..." />
          ) : erroCursos ? (
            <ErrorMessage message={erroCursos} onRetry={() => void reload()} />
          ) : resumo ? (
            <ResumoImportacaoView resumo={resumo} />
          ) : (
            <>
              {/* 1. Curso e turno */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-section mb-1 block">Curso dos alunos importados *</label>
                  <select
                    value={cursoId}
                    onChange={(e) => setCursoId(e.target.value)}
                    className="input w-full"
                    required
                  >
                    <option value="">Seleccionar curso...</option>
                    {(cursos ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} ({c.codigo})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-section mb-1 block">Turno *</label>
                  <select
                    value={turno}
                    onChange={(e) => setTurno(e.target.value as Turno | '')}
                    className="input w-full"
                    required
                  >
                    <option value="">Seleccionar turno...</option>
                    {(Object.keys(TURNO_LABELS) as Turno[]).map((t) => (
                      <option key={t} value={t}>
                        {TURNO_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                O turno define em que turma cada aluno é encaixado. Todos os alunos deste ficheiro ficam com o mesmo
                curso e turno.
              </p>

              {/* 2. Ficheiro */}
              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="label-section">Ficheiro *</label>
                  <button type="button" onClick={descarregarModelo} className="text-xs text-accent hover:text-accent-strong">
                    Descarregar modelo CSV
                  </button>
                </div>
                <input
                  ref={ficheiroRef}
                  type="file"
                  accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => void escolherFicheiro(e)}
                />
                <button
                  type="button"
                  onClick={() => ficheiroRef.current?.click()}
                  className="mt-1 flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong px-4 py-6 text-sm text-ink-muted hover:border-accent hover:text-ink"
                >
                  <span className="text-lg" aria-hidden>
                    📄
                  </span>
                  <span className="font-medium text-ink">{nomeFicheiro || 'Escolher ficheiro CSV ou Excel (.xlsx)'}</span>
                  <span className="text-xs text-ink-faint">
                    Colunas: Nome, Telefone (obrigatórias); BI, Email, Género, Data de Nascimento (opcionais).
                  </span>
                </button>
              </div>

              {leitura && leitura.avisos.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-warn">
                  {leitura.avisos.map((a) => (
                    <li key={a}>· {a}</li>
                  ))}
                </ul>
              )}

              {leitura && leitura.linhas.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-ink">
                    <strong className="tnum">{leitura.linhas.length}</strong> linha(s) lida(s):{' '}
                    <span className="text-ok">{validas} válida(s)</span>
                    {invalidas > 0 && (
                      <>
                        {' · '}
                        <span className="text-danger">{invalidas} com erro</span>
                      </>
                    )}
                    {leitura.ignoradas > 0 && (
                      <>
                        {' · '}
                        <span className="text-ink-faint">{leitura.ignoradas} vazia(s) ignorada(s)</span>
                      </>
                    )}
                  </p>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line">
                    <table className="w-full text-left text-[12px]">
                      <thead className="sticky top-0 bg-canvas">
                        <tr className="border-b border-line text-[10px] uppercase tracking-[0.05em] text-ink-faint">
                          <th className="px-3 py-2 font-medium">Linha</th>
                          <th className="px-3 py-2 font-medium">Nome</th>
                          <th className="px-3 py-2 font-medium">BI</th>
                          <th className="px-3 py-2 font-medium">Telefone</th>
                          <th className="px-3 py-2 font-medium">Email</th>
                          <th className="px-3 py-2 font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {leitura.linhas.slice(0, 50).map((l) => (
                          <tr key={l.linha} className={l.erro ? 'bg-danger-soft/40' : ''}>
                            <td className="px-3 py-1.5 tnum text-ink-faint">{l.linha}</td>
                            <td className="px-3 py-1.5 text-ink">{l.nome_completo || '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-ink-muted">{l.numero_bi ?? ''}</td>
                            <td className="px-3 py-1.5 font-mono text-ink-muted">{l.telefone_whatsapp || '—'}</td>
                            <td className="px-3 py-1.5 text-ink-muted">{l.email ?? ''}</td>
                            <td className={`px-3 py-1.5 ${l.erro ? 'text-danger' : 'text-ok'}`}>
                              {l.erro ?? 'Pronta'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {leitura.linhas.length > 50 && (
                    <p className="mt-1 text-xs text-ink-faint">
                      Pré-visualização das 50 primeiras linhas — a importação processa todas.
                    </p>
                  )}
                </div>
              )}

              {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {resumo ? (
            <button onClick={onClose} className="btn-primary flex-1">
              Concluir
            </button>
          ) : (
            <>
              <button
                onClick={() => void importar()}
                disabled={!preenchido || aProcessar || validas === 0}
                className="btn-primary flex-1"
              >
                {aProcessar && <Spinner className="h-4 w-4" />}
                {progresso
                  ? `A importar… ${progresso.feitas}/${progresso.total}`
                  : validas > 0
                    ? `Importar ${validas} aluno(s)`
                    : 'Importar'}
              </button>
              <button onClick={onClose} disabled={aProcessar} className="btn-secondary">
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ResumoImportacaoView({ resumo }: { resumo: ResumoImportacao }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-canvas p-4">
        <p className="font-serif text-lg font-semibold text-ink">Importação concluída</p>
        <p className="mt-1 text-sm text-ink-muted">
          {resumo.inscritos} de {resumo.total} inscrição(ões) criada(s) · {resumo.matriculados} matriculado(s)
        </p>
        {resumo.semTurma.length > 0 && (
          <p className="mt-1 text-xs text-warn">
            {resumo.semTurma.length} sem turma com vagas — ficaram inscritas e pendentes; aloque-as em Inscrições.
          </p>
        )}
        {resumo.erros.length > 0 && (
          <p className="mt-1 text-xs text-danger">{resumo.erros.length} linha(s) falharam — detalhe abaixo.</p>
        )}
      </div>

      {resumo.semTurma.length > 0 && (
        <div>
          <p className="label-section mb-1">Sem turma</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-line p-2 text-[13px]">
            {resumo.semTurma.map((i) => (
              <li key={`${i.linha}-${i.numero}`} className="text-ink">
                <span className="font-mono text-xs text-ink-faint">{i.numero}</span> · {i.nome}{' '}
                <span className="text-ink-faint">(linha {i.linha})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(resumo.erros.length > 0 || resumo.invalidas.length > 0) && (
        <div>
          <p className="label-section mb-1">Linhas não importadas</p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line p-2 text-[13px]">
            {resumo.invalidas.map((i) => (
              <li key={`inv-${i.linha}`} className="text-danger">
                Linha {i.linha} ({i.nome}): {i.erro}
              </li>
            ))}
            {resumo.erros.map((i) => (
              <li key={`err-${i.linha}`} className="text-danger">
                Linha {i.linha} ({i.nome}): {i.erro}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
