import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { Curso, Formador, Turno, Turma } from '../types/database'
import { TURNO_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { EmptyState, ErrorMessage, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { showSuccess, showError, confirmarAcao } from '../lib/alerts'

// ---------------------------------------------------------------------------
// Modal de curso (criar / editar)
// ---------------------------------------------------------------------------

interface CursoForm {
  id?: string
  nome: string
  codigo: string
  duracao: string
  descricao: string
  ativo: boolean
  formador_id: string
}

const cursoVazio: CursoForm = { nome: '', codigo: '', duracao: '', descricao: '', ativo: true, formador_id: '' }

function CursoModal({
  inicial,
  formadores,
  onClose,
  onDone,
}: {
  inicial: CursoForm
  formadores: Formador[]
  onClose: () => void
  onDone: () => void
}) {
  const [form, setForm] = useState<CursoForm>(inicial)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const editando = Boolean(form.id)
  useEscapeKey(onClose)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErro(null)
    try {
      const payload = {
        nome: form.nome.trim(),
        codigo: form.codigo.trim().toUpperCase(),
        duracao: form.duracao.trim() || null,
        descricao: form.descricao.trim() || null,
        ativo: form.ativo,
        formador_id: form.formador_id || null,
      }
      const { error } = form.id
        ? await supabase.from('cursos').update(payload).eq('id', form.id)
        : await supabase.from('cursos').insert(payload)
      if (error) throw error
      showSuccess(editando ? 'Curso actualizado.' : 'Curso criado.')
      onDone()
      onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao guardar o curso.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <form
        onSubmit={guardar}
        className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-6"
      >
        <h3 className="font-serif text-lg font-semibold text-ink">{editando ? 'Editar Curso' : 'Novo Curso'}</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label-section mb-1 block">Nome *</label>
            <input
              required
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className="input w-full"
              placeholder="Ex.: Informática Básica"
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Código *</label>
            <input
              required
              value={form.codigo}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })}
              className="input w-full font-mono"
              placeholder="Ex.: INF-BAS"
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Duração</label>
            <input
              value={form.duracao}
              onChange={(e) => setForm({ ...form, duracao: e.target.value })}
              className="input w-full"
              placeholder="Ex.: 6 meses"
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Descrição</label>
            <textarea
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              rows={3}
              className="input w-full"
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Formador</label>
            <select
              value={form.formador_id}
              onChange={(e) => setForm({ ...form, formador_id: e.target.value })}
              className="input w-full"
            >
              <option value="">Sem formador atribuído</option>
              {formadores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}{f.especialidade ? ` (${f.especialidade})` : ''}
                </option>
              ))}
            </select>
            {formadores.length === 0 && (
              <p className="mt-1 text-xs text-warn">Nenhum formador registado: crie na aba Formadores.</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong accent-[oklch(var(--c-accent))]"
            />
            Curso activo (visível no formulário público)
          </label>
        </div>

        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Guardar
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal de turma (criar / editar)
// ---------------------------------------------------------------------------

interface TurmaForm {
  id?: string
  curso_id: string
  nome_turma: string
  turno: Turno
  limite_vagas: number
  ano_lectivo: number
}

function TurmaModal({
  cursos,
  formadores,
  turma,
  formadoresIniciais,
  onClose,
  onDone,
}: {
  cursos: Curso[]
  formadores: Formador[]
  turma: Turma | null
  /** formador_id já atribuídos à turma (turma_formadores) ao abrir o modal. */
  formadoresIniciais: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [formadoresSel, setFormadoresSel] = useState<string[]>(formadoresIniciais)
  const [form, setForm] = useState<TurmaForm>(
    turma ?? {
      curso_id: cursos[0]?.id ?? '',
      nome_turma: '',
      turno: 'manha',
      limite_vagas: 30,
      ano_lectivo: new Date().getFullYear(),
    },
  )
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEscapeKey(onClose)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErro(null)
    try {
      const payload = {
        curso_id: form.curso_id,
        nome_turma: form.nome_turma.trim(),
        turno: form.turno,
        limite_vagas: Number(form.limite_vagas),
        ano_lectivo: Number(form.ano_lectivo),
      }
      let turmaId = turma?.id
      if (turma) {
        const { error } = await supabase.from('turmas').update(payload).eq('id', turma.id)
        if (error) throw error
      } else {
        const { data: criada, error } = await supabase.from('turmas').insert(payload).select('id').single()
        if (error) throw error
        turmaId = criada.id as string
      }

      // Formadores da turma (016): substituir a atribuição — o mesmo curso
      // pode ter formadores diferentes por turno (manhã/tarde).
      const { error: errDel } = await supabase.from('turma_formadores').delete().eq('turma_id', turmaId)
      if (errDel) throw errDel
      if (formadoresSel.length > 0) {
        const { error: errIns } = await supabase
          .from('turma_formadores')
          .insert(formadoresSel.map((fid) => ({ turma_id: turmaId, formador_id: fid })))
        if (errIns) throw errIns
      }
      showSuccess(turma ? 'Turma actualizada.' : 'Turma criada.')
      onDone()
      onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao guardar a turma.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <form onSubmit={guardar} className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-ink">{turma ? 'Editar Turma' : 'Nova Turma'}</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label-section mb-1 block">Curso *</label>
            <select
              required
              value={form.curso_id}
              onChange={(e) => setForm({ ...form, curso_id: e.target.value })}
              className="input w-full"
            >
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.codigo})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-section mb-1 block">Nome da turma *</label>
            <input
              required
              value={form.nome_turma}
              onChange={(e) => setForm({ ...form, nome_turma: e.target.value })}
              className="input w-full"
              placeholder="Ex.: Turma A"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-section mb-1 block">Turno *</label>
              <select
                value={form.turno}
                onChange={(e) => setForm({ ...form, turno: e.target.value as Turno })}
                className="input w-full"
              >
                {(Object.keys(TURNO_LABELS) as Turno[]).map((t) => (
                  <option key={t} value={t}>
                    {TURNO_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-section mb-1 block">Vagas *</label>
              <input
                required
                type="number"
                min={1}
                value={form.limite_vagas}
                onChange={(e) => setForm({ ...form, limite_vagas: Number(e.target.value) })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="label-section mb-1 block">Ano *</label>
              <input
                required
                type="number"
                min={2000}
                max={2100}
                value={form.ano_lectivo}
                onChange={(e) => setForm({ ...form, ano_lectivo: Number(e.target.value) })}
                className="input w-full"
              />
            </div>
          </div>

          <div>
            <label className="label-section mb-1 block">Formadores da turma</label>
            <p className="mb-2 text-xs text-ink-faint">
              O mesmo curso pode ter formadores diferentes por turno (ex.: manhã e tarde). Marque todos os que
              leccionam esta turma.
            </p>
            {formadores.length === 0 ? (
              <p className="text-xs text-warn">Nenhum formador registado: crie na aba Formadores.</p>
            ) : (
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-line p-2">
                {formadores.map((f) => (
                  <label key={f.id} className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      checked={formadoresSel.includes(f.id)}
                      onChange={() =>
                        setFormadoresSel((s) => (s.includes(f.id) ? s.filter((x) => x !== f.id) : [...s, f.id]))
                      }
                    />
                    <span>{f.nome}</span>
                    {f.especialidade && <span className="text-xs text-ink-faint">· {f.especialidade}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading || cursos.length === 0} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Guardar
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

/** Turma com as relações lidas na página: curso e formadores atribuídos (016). */
type TurmaComRelacoes = Turma & {
  cursos?: { nome: string; codigo: string } | null
  turma_formadores?: { formador_id: string }[] | null
}

type Tab = 'cursos' | 'turmas' | 'formadores'

export default function CursosTurmas() {
  const [tab, setTab] = useState<Tab>('cursos')
  const [modalCurso, setModalCurso] = useState<CursoForm | null>(null)
  const [modalTurma, setModalTurma] = useState<TurmaComRelacoes | null>(null)
  const [turmaNova, setTurmaNova] = useState(false)
  const [modalFormador, setModalFormador] = useState<Formador | null>(null)
  const [formadorNovo, setFormadorNovo] = useState(false)

  const cursosFetcher = useCallback(
    async () =>
      (await supabase.from('cursos').select('*').order('nome')) as {
        data: Curso[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: cursos, loading: loadingCursos, error: errorCursos, reload: reloadCursos } = useAsyncData<Curso[]>(
    cursosFetcher,
    [],
  )

  const turmasFetcher = useCallback(
    async () =>
      (await supabase
        .from('turmas')
        .select('*, cursos(nome, codigo), turma_formadores(formador_id)')
        .order('ano_lectivo', { ascending: false })
        .order('nome_turma')) as {
        data: TurmaComRelacoes[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: turmas, loading: loadingTurmas, error: errorTurmas, reload: reloadTurmas } = useAsyncData<
    TurmaComRelacoes[]
  >(turmasFetcher, [])

  const formadoresFetcher = useCallback(
    async () =>
      (await supabase.from('formadores').select('*').order('nome')) as {
        data: Formador[] | null
        error: { message: string } | null
      },
    [],
  )
  const { data: formadores, loading: loadingFormadores, error: errorFormadores, reload: reloadFormadores } = useAsyncData<
    Formador[]
  >(formadoresFetcher, [])

  const eliminarFormador = async (f: Formador) => {
    const ok = await confirmarAcao({
      title: 'Eliminar formador',
      message: `Eliminar "${f.nome}"?\n\nOs cursos que ele lecciona ficarão sem formador atribuído.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('formadores').delete().eq('id', f.id)
    if (error) showError(error.message)
    else {
      showSuccess('Formador eliminado.')
      void reloadFormadores()
      void reloadCursos()
    }
  }

  const eliminarCurso = async (c: Curso) => {
    const ok = await confirmarAcao({
      title: 'Eliminar curso',
      message: `Eliminar "${c.nome}"?\n\nSó é possível se não houver turmas ou inscrições associadas.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('cursos').delete().eq('id', c.id)
    if (error) showError(error.message)
    else {
      showSuccess('Curso eliminado.')
      void reloadCursos()
    }
  }

  const eliminarTurma = async (t: Turma) => {
    const ok = await confirmarAcao({
      title: 'Eliminar turma',
      message: `Eliminar a turma "${t.nome_turma}"?\n\nSó é possível se não houver alunos matriculados.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('turmas').delete().eq('id', t.id)
    if (error) showError(error.message)
    else {
      showSuccess('Turma eliminada.')
      void reloadTurmas()
    }
  }

  return (
    <>
      <PageHeader
        title="Cursos & Turmas"
        subtitle="Catálogo de formações e planeamento de vagas"
        actions={
          tab === 'cursos' ? (
            <button onClick={() => setModalCurso(cursoVazio)} className="btn-primary">
              Novo Curso
            </button>
          ) : tab === 'formadores' ? (
            <button onClick={() => setFormadorNovo(true)} className="btn-primary">
              Novo Formador
            </button>
          ) : (
            <button
              onClick={() => setTurmaNova(true)}
              disabled={(cursos ?? []).length === 0}
              className="btn-primary"
              title={(cursos ?? []).length === 0 ? 'Crie um curso primeiro' : undefined}
            >
              Nova Turma
            </button>
          )
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex w-fit gap-0.5 rounded-md border border-line p-0.5">
        {(['cursos', 'turmas', 'formadores'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1 text-[13px] font-medium ${
              tab === t ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {t === 'cursos' ? 'Cursos' : t === 'turmas' ? 'Turmas' : 'Formadores'}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {tab === 'cursos' ? (
        <div className="cell">
          {loadingCursos ? (
            <LoadingBlock />
          ) : errorCursos ? (
            <ErrorMessage message={errorCursos} onRetry={() => void reloadCursos()} />
          ) : (cursos ?? []).length === 0 ? (
            <EmptyState message="Nenhum curso criado. Comece por criar o primeiro curso." icon="📚" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="px-4 py-2.5 font-medium">Código</th>
                    <th className="px-4 py-2.5 font-medium">Nome</th>
                    <th className="px-4 py-2.5 font-medium">Duração</th>
                    <th className="px-4 py-2.5 font-medium">Formador</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(cursos ?? []).map((c) => (
                    <tr key={c.id} className="hover:bg-canvas">
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{c.codigo}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{c.nome}</p>
                        {c.descricao && <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint">{c.descricao}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{c.duracao ?? ''}</td>
                      <td className="px-4 py-2.5 text-ink-muted">
                        {(formadores ?? []).find((f) => f.id === c.formador_id)?.nome ?? ''}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2 text-[13px] text-ink">
                          <span className={`dot ${c.ativo ? 'bg-ok' : 'bg-ink-faint'}`} aria-hidden />
                          {c.ativo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() =>
                              setModalCurso({
                                id: c.id,
                                nome: c.nome,
                                codigo: c.codigo,
                                duracao: c.duracao ?? '',
                                descricao: c.descricao ?? '',
                                ativo: c.ativo,
                                formador_id: c.formador_id ?? '',
                              })
                            }
                            className="btn-secondary px-2.5 py-1 text-xs"
                          >
                            Editar
                          </button>
                          <button onClick={() => void eliminarCurso(c)} className="btn-danger px-2.5 py-1 text-xs">
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'turmas' ? (
        <div className="cell">
          {loadingTurmas ? (
            <LoadingBlock />
          ) : errorTurmas ? (
            <ErrorMessage message={errorTurmas} onRetry={() => void reloadTurmas()} />
          ) : (turmas ?? []).length === 0 ? (
            <EmptyState message="Nenhuma turma criada. Crie turmas para poder matricular alunos." icon="🏫" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="px-4 py-2.5 font-medium">Turma</th>
                    <th className="px-4 py-2.5 font-medium">Curso</th>
                    <th className="px-4 py-2.5 font-medium">Formadores</th>
                    <th className="px-4 py-2.5 font-medium">Turno</th>
                    <th className="px-4 py-2.5 font-medium">Ano</th>
                    <th className="px-4 py-2.5 font-medium">Vagas</th>
                    <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(turmas ?? []).map((t) => {
                    const restantes = t.limite_vagas - t.vagas_preenchidas
                    const pct = t.limite_vagas > 0 ? Math.round((t.vagas_preenchidas / t.limite_vagas) * 100) : 0
                    return (
                      <tr key={t.id} className="hover:bg-canvas">
                        <td className="px-4 py-2.5 font-medium text-ink">{t.nome_turma}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{t.cursos?.nome ?? ''}</td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {(t.turma_formadores ?? [])
                            .map((tf) => formadores?.find((f) => f.id === tf.formador_id)?.nome ?? '')
                            .filter(Boolean)
                            .join(', ')}
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{TURNO_LABELS[t.turno]}</td>
                        <td className="px-4 py-2.5 tnum text-ink-muted">{t.ano_lectivo}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1 w-20 rounded-full bg-raised">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="tnum text-xs text-ink-muted">
                              {t.vagas_preenchidas}/{t.limite_vagas}
                              {restantes > 0 && <span className="ml-1 text-ok">({restantes} livres)</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setModalTurma(t)}
                              className="btn-secondary px-2.5 py-1 text-xs"
                            >
                              Editar
                            </button>
                            <button onClick={() => void eliminarTurma(t)} className="btn-danger px-2.5 py-1 text-xs">
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="cell">
          {loadingFormadores ? (
            <LoadingBlock />
          ) : errorFormadores ? (
            <ErrorMessage message={errorFormadores} onRetry={() => void reloadFormadores()} />
          ) : (formadores ?? []).length === 0 ? (
            <EmptyState message="Nenhum formador registado. Adicione o primeiro formador." icon="👨‍🏫" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="px-4 py-2.5 font-medium">Nome</th>
                    <th className="px-4 py-2.5 font-medium">Especialidade</th>
                    <th className="px-4 py-2.5 font-medium">Contacto</th>
                    <th className="px-4 py-2.5 font-medium">Cursos</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                    <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(formadores ?? []).map((f) => {
                    const cursosDoFormador = (cursos ?? []).filter((c) => c.formador_id === f.id)
                    return (
                      <tr key={f.id} className="hover:bg-canvas">
                        <td className="px-4 py-2.5 font-medium text-ink">{f.nome}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{f.especialidade ?? ''}</td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {f.telefone ?? ''}
                          {f.email && <span className="block text-xs text-ink-faint">{f.email}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {cursosDoFormador.length === 0
                            ? ''
                            : cursosDoFormador.map((c) => c.nome).join(', ')}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2 text-[13px] text-ink">
                            <span className={`dot ${f.ativo ? 'bg-ok' : 'bg-ink-faint'}`} aria-hidden />
                            {f.ativo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setModalFormador(f)} className="btn-secondary px-2.5 py-1 text-xs">
                              Editar
                            </button>
                            <button onClick={() => void eliminarFormador(f)} className="btn-danger px-2.5 py-1 text-xs">
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modais */}
      {modalCurso &&
        createPortal(
          <CursoModal
            inicial={modalCurso}
            formadores={formadores ?? []}
            onClose={() => setModalCurso(null)}
            onDone={() => void reloadCursos()}
          />,
          document.body,
        )}
      {(modalTurma || turmaNova) &&
        createPortal(
          <TurmaModal
            cursos={cursos ?? []}
            formadores={formadores ?? []}
            turma={modalTurma}
            formadoresIniciais={(modalTurma?.turma_formadores ?? []).map((tf) => tf.formador_id)}
            onClose={() => {
              setModalTurma(null)
              setTurmaNova(false)
            }}
            onDone={() => void reloadTurmas()}
          />,
          document.body,
        )}
      {(modalFormador || formadorNovo) &&
        createPortal(
          <FormadorModal
            inicial={modalFormador}
            onClose={() => {
              setModalFormador(null)
              setFormadorNovo(false)
            }}
            onDone={() => void reloadFormadores()}
          />,
          document.body,
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Modal de formador (criar / editar)
// ---------------------------------------------------------------------------

interface FormadorForm {
  id?: string
  nome: string
  especialidade: string
  telefone: string
  email: string
  ativo: boolean
}

function FormadorModal({
  inicial,
  onClose,
  onDone,
}: {
  inicial: Formador | null
  onClose: () => void
  onDone: () => void
}) {
  const [form, setForm] = useState<FormadorForm>(
    inicial
      ? {
          id: inicial.id,
          nome: inicial.nome,
          especialidade: inicial.especialidade ?? '',
          telefone: inicial.telefone ?? '',
          email: inicial.email ?? '',
          ativo: inicial.ativo,
        }
      : { nome: '', especialidade: '', telefone: '', email: '', ativo: true },
  )
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const editando = Boolean(form.id)
  useEscapeKey(onClose)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErro(null)
    try {
      const payload = {
        nome: form.nome.trim(),
        especialidade: form.especialidade.trim() || null,
        telefone: form.telefone.trim() || null,
        email: form.email.trim() || null,
        ativo: form.ativo,
      }
      const { error } = form.id
        ? await supabase.from('formadores').update(payload).eq('id', form.id)
        : await supabase.from('formadores').insert(payload)
      if (error) throw error
      showSuccess(editando ? 'Formador actualizado.' : 'Formador criado.')
      onDone()
      onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao guardar o formador.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <form onSubmit={guardar} className="overlay-in w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h3 className="font-serif text-lg font-semibold text-ink">{editando ? 'Editar Formador' : 'Novo Formador'}</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label-section mb-1 block">Nome *</label>
            <input
              required
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className="input w-full"
              placeholder="Ex.: Alberto Macuvele"
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Especialidade</label>
            <input
              value={form.especialidade}
              onChange={(e) => setForm({ ...form, especialidade: e.target.value })}
              className="input w-full"
              placeholder="Ex.: Contabilidade"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-section mb-1 block">Telefone</label>
              <input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                className="input w-full"
                placeholder="+258 84 000 0000"
              />
            </div>
            <div>
              <label className="label-section mb-1 block">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong accent-[oklch(var(--c-accent))]"
            />
            Formador activo
          </label>
        </div>

        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Guardar
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
