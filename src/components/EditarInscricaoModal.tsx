import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { Curso, EstadoInscricao, Inscricao, Turno } from '../types/database'
import { ESTADO_LABELS, TURNO_LABELS } from '../types/database'
import { useAsyncData } from '../hooks/useAsyncData'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { ErrorMessage, LoadingBlock, Spinner } from './ui'
import { showSuccess } from '../lib/alerts'

/**
 * Edição de uma inscrição pela secretaria: dados do candidato, curso/turno e
 * estado. Se o candidato já está matriculado, curso e turno ficam bloqueados —
 * mudar aqui não move o aluno de turma (isso faz-se em Alunos & Turmas).
 */
export default function EditarInscricaoModal({
  inscricao,
  onClose,
  onDone,
}: {
  inscricao: Inscricao
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

  const [matriculado, setMatriculado] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState({
    nome_completo: inscricao.nome_completo,
    numero_bi: inscricao.numero_bi ?? '',
    telefone_whatsapp: inscricao.telefone_whatsapp,
    email: inscricao.email ?? '',
    genero: inscricao.genero ?? '',
    data_nascimento: inscricao.data_nascimento ?? '',
    curso_id: inscricao.curso_id,
    turno_pretendido: inscricao.turno_pretendido as Turno,
    estado: inscricao.estado as EstadoInscricao,
    motivo_rejeicao: inscricao.motivo_rejeicao ?? '',
  })

  useEffect(() => {
    let vivo = true
    void (async () => {
      const { count } = await supabase
        .from('alunos_matriculados')
        .select('id', { count: 'exact', head: true })
        .eq('inscricao_id', inscricao.id)
      if (vivo) setMatriculado((count ?? 0) > 0)
    })()
    return () => {
      vivo = false
    }
  }, [inscricao.id])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    if (!form.nome_completo.trim()) {
      setErro('O nome do candidato é obrigatório.')
      return
    }
    if (!form.telefone_whatsapp.trim()) {
      setErro('O telefone WhatsApp é obrigatório.')
      return
    }
    if (form.estado === 'rejeitado' && !form.motivo_rejeicao.trim()) {
      setErro('Indique o motivo da rejeição.')
      return
    }

    setLoading(true)
    const { error } = await supabase
      .from('inscricoes')
      .update({
        nome_completo: form.nome_completo.trim(),
        numero_bi: form.numero_bi.trim() ? form.numero_bi.trim().toUpperCase() : null,
        telefone_whatsapp: form.telefone_whatsapp.trim(),
        email: form.email.trim() || null,
        genero: form.genero || null,
        data_nascimento: form.data_nascimento || null,
        curso_id: form.curso_id,
        turno_pretendido: form.turno_pretendido,
        estado: form.estado,
        motivo_rejeicao: form.estado === 'rejeitado' ? form.motivo_rejeicao.trim() : null,
      })
      .eq('id', inscricao.id)
    setLoading(false)

    if (error) {
      // O trigger da 024 recusa o limite de 3 cursos e duplicados: mensagem útil.
      setErro(error.message)
      return
    }
    showSuccess(`Inscrição ${inscricao.numero_inscricao} actualizada.`)
    onDone()
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <form
        onSubmit={guardar}
        className="overlay-in flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h3 className="font-serif text-lg font-semibold text-ink">Editar inscrição</h3>
            <p className="font-mono text-xs text-ink-faint">{inscricao.numero_inscricao}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Fechar">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingCursos ? (
            <LoadingBlock label="A carregar cursos..." />
          ) : erroCursos ? (
            <ErrorMessage message={erroCursos} onRetry={() => void reload()} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label-section mb-1 block">Nome completo *</label>
                <input value={form.nome_completo} onChange={set('nome_completo')} className="input w-full" required />
              </div>
              <div>
                <label className="label-section mb-1 block">Telefone WhatsApp *</label>
                <input value={form.telefone_whatsapp} onChange={set('telefone_whatsapp')} className="input w-full" required />
              </div>
              <div>
                <label className="label-section mb-1 block">Nº do BI</label>
                <input value={form.numero_bi} onChange={set('numero_bi')} className="input w-full font-mono" />
              </div>
              <div>
                <label className="label-section mb-1 block">Email</label>
                <input type="email" value={form.email} onChange={set('email')} className="input w-full" />
              </div>
              <div>
                <label className="label-section mb-1 block">Género</label>
                <select value={form.genero} onChange={set('genero')} className="input w-full">
                  <option value="">Não indicado</option>
                  <option value="F">Feminino</option>
                  <option value="M">Masculino</option>
                </select>
              </div>
              <div>
                <label className="label-section mb-1 block">Data de nascimento</label>
                <input type="date" value={form.data_nascimento} onChange={set('data_nascimento')} className="input w-full" />
              </div>
              <div>
                <label className="label-section mb-1 block">Estado</label>
                <select value={form.estado} onChange={set('estado')} className="input w-full">
                  {(Object.keys(ESTADO_LABELS) as EstadoInscricao[]).map((s) => (
                    <option key={s} value={s}>
                      {ESTADO_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 mt-1 border-t border-line pt-3">
                <p className="label-section mb-1">Curso e turno</p>
                {matriculado && (
                  <p className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                    Este candidato já está matriculado. Mudar o curso/turno aqui não o move de turma — use{' '}
                    <strong>Alunos &amp; Turmas</strong> para transferir.
                  </p>
                )}
              </div>
              <div>
                <label className="label-section mb-1 block">Curso</label>
                <select
                  value={form.curso_id}
                  onChange={set('curso_id')}
                  className="input w-full"
                  disabled={matriculado === true}
                >
                  {form.curso_id && !(cursos ?? []).some((c) => c.id === form.curso_id) && (
                    <option value={form.curso_id}>{inscricao.cursos?.nome ?? 'Curso actual'}</option>
                  )}
                  {(cursos ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.codigo})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-section mb-1 block">Turno pretendido</label>
                <select
                  value={form.turno_pretendido}
                  onChange={set('turno_pretendido')}
                  className="input w-full"
                  disabled={matriculado === true}
                >
                  {(Object.keys(TURNO_LABELS) as Turno[]).map((t) => (
                    <option key={t} value={t}>
                      {TURNO_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              {form.estado === 'rejeitado' && (
                <div className="sm:col-span-2">
                  <label className="label-section mb-1 block">Motivo da rejeição *</label>
                  <textarea
                    value={form.motivo_rejeicao}
                    onChange={set('motivo_rejeicao')}
                    rows={2}
                    className="input w-full"
                    required
                  />
                </div>
              )}

              {erro && (
                <p className="sm:col-span-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-line px-5 py-3">
          <button type="submit" disabled={loading || loadingCursos} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Guardar alterações
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
