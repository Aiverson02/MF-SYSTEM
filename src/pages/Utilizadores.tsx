import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAsyncData } from '../hooks/useAsyncData'
import { Badge, EmptyState, ErrorMessage, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { confirmarAcao, showSuccess } from '../lib/alerts'
import { pushToast } from '../components/ToastHost'
import { format } from '../lib/format'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { createPortal } from 'react-dom'
import AdminGate from '../components/AdminGate'
import type { FormadorConta } from '../types/database'

interface ListarStaff {
  id: string
  email: string
  papel: string
  ultimo_login: string | null
  criado_em: string
}

// ---------------------------------------------------------------------------
// Modal: criar conta staff
// ---------------------------------------------------------------------------

function CriarUtilizadorModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  useEscapeKey(onClose)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [papel, setPapel] = useState<'secretaria' | 'admin'>('secretaria')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    if (!email.trim() || !password || password.length < 8) {
      setErro('Indique um email válido e uma password com pelo menos 8 caracteres.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('criar_utilizador_staff', {
      p_email: email.trim(),
      p_password: password,
      p_papel: papel,
    })
    setLoading(false)
    const r = (data as { sucesso: boolean; mensagem: string }[] | null)?.[0]
    if (error || !r?.sucesso) {
      setErro(r?.mensagem ?? error?.message ?? 'Erro ao criar utilizador.')
      return
    }
    showSuccess(r.mensagem)
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form onSubmit={guardar} className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h2 className="font-serif text-lg font-semibold text-ink">Criar utilizador staff</h2>
        <p className="mt-1 text-[13px] text-ink-muted">A conta fica activa de imediato com o papel escolhido.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label-section mb-1 block">Email *</label>
            <input
              type="email"
              className="input w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@instituicao.co.mz"
              required
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Password *</label>
            <input
              type="password"
              className="input w-full font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              minLength={8}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="label-section mb-1 block">Papel *</label>
            <select className="input w-full" value={papel} onChange={(e) => setPapel(e.target.value as 'secretaria' | 'admin')}>
              <option value="secretaria">Secretaria</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Criar conta
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

// ---------------------------------------------------------------------------
// Modal: redefinir password
// ---------------------------------------------------------------------------

function RedefinirPasswordModal({
  utilizador,
  onClose,
  onDone,
}: {
  utilizador: ListarStaff
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    if (password.length < 8) {
      setErro('A password deve ter pelo menos 8 caracteres.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('redefinir_password_staff', {
      p_user_id: utilizador.id,
      p_nova_password: password,
    })
    setLoading(false)
    const r = (data as { sucesso: boolean; mensagem: string }[] | null)?.[0]
    if (error || !r?.sucesso) {
      setErro(r?.mensagem ?? error?.message ?? 'Erro ao redefinir password.')
      return
    }
    showSuccess(r.mensagem)
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form onSubmit={guardar} className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h2 className="font-serif text-lg font-semibold text-ink">Redefinir password</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          {utilizador.email} <span className="font-mono text-xs text-ink-faint">({utilizador.papel})</span>
        </p>

        <div className="mt-4">
          <label className="label-section mb-1 block">Nova password *</label>
          <input
            type="password"
            className="input w-full font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            minLength={8}
            autoComplete="new-password"
            required
            autoFocus
          />
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Redefinir
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

// ---------------------------------------------------------------------------
// Modal: conta de acesso de um formador (criar / ligar existente / nova password)
// ---------------------------------------------------------------------------

type ModoContaFormador = 'criar' | 'ligar' | 'password'

function ContaFormadorModal({
  formador,
  modo,
  onClose,
  onDone,
}: {
  formador: FormadorConta
  modo: ModoContaFormador
  onClose: () => void
  onDone: () => void
}) {
  useEscapeKey(onClose)
  const [email, setEmail] = useState(formador.email ?? '')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const titulos: Record<ModoContaFormador, string> = {
    criar: 'Criar conta do formador',
    ligar: 'Ligar conta existente',
    password: 'Nova password do formador',
  }

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setLoading(true)

    let data: unknown = null
    let error: { message: string } | null = null

    if (modo === 'password') {
      if (!formador.user_id) {
        setLoading(false)
        setErro('Este formador ainda não tem conta ligada.')
        return
      }
      const r = await supabase.rpc('redefinir_password_staff', {
        p_user_id: formador.user_id,
        p_nova_password: password,
      })
      data = r.data
      error = r.error
    } else if (modo === 'criar') {
      const r = await supabase.rpc('criar_conta_formador', {
        p_formador_id: formador.formador_id,
        p_email: email.trim(),
        p_password: password,
      })
      data = r.data
      error = r.error
    } else {
      const r = await supabase.rpc('ligar_conta_formador', {
        p_formador_id: formador.formador_id,
        p_email: email.trim(),
      })
      data = r.data
      error = r.error
    }

    setLoading(false)
    const resposta = (data as { sucesso: boolean; mensagem: string }[] | null)?.[0]
    if (error || !resposta?.sucesso) {
      setErro(resposta?.mensagem ?? error?.message ?? 'Não foi possível concluir a operação.')
      return
    }
    showSuccess(resposta.mensagem)
    onDone()
    onClose()
  }

  return createPortal(
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <form onSubmit={guardar} className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h2 className="font-serif text-lg font-semibold text-ink">{titulos[modo]}</h2>
        <p className="mt-1 text-[13px] text-ink-muted">{formador.nome}</p>
        <p className="mt-1 text-xs text-ink-faint">
          Os formadores usam email pessoal: entregue a password em mão e peça para a alterar depois.
        </p>

        <div className="mt-4 space-y-3">
          {modo !== 'password' && (
            <div>
              <label className="label-section mb-1 block">Email do formador *</label>
              <input
                type="email"
                className="input w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@exemplo.co.mz"
                required
                autoFocus
              />
            </div>
          )}

          {modo !== 'ligar' && (
            <div>
              <label className="label-section mb-1 block">Password *</label>
              <input
                type="password"
                className="input w-full font-mono"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
          )}
        </div>

        {erro && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading && <Spinner className="h-4 w-4" />}
            Confirmar
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

// ---------------------------------------------------------------------------
// Página (admin-only via AdminGate; o servidor valida de novo nas RPCs)
// ---------------------------------------------------------------------------

export default function Utilizadores() {
  const [criando, setCriando] = useState(false)
  const [redefinindo, setRedefinindo] = useState<ListarStaff | null>(null)

  const fetcher = useCallback(async () => {
    const { data, error } = await supabase.rpc('listar_utilizadores_staff')
    return { data: (data ?? []) as ListarStaff[], error }
  }, [])
  const { data: utilizadores, loading, error, reload } = useAsyncData<ListarStaff[]>(fetcher, [])

  const [contaFormador, setContaFormador] = useState<{ formador: FormadorConta; modo: ModoContaFormador } | null>(null)
  const contasFetcher = useCallback(async () => {
    const { data, error } = await supabase.rpc('listar_formadores_contas')
    return { data: (data ?? []) as FormadorConta[], error }
  }, [])
  const { data: formadores, loading: loadingFormadores, reload: reloadFormadores } = useAsyncData<FormadorConta[]>(
    contasFetcher,
    [],
  )

  const alterarPapel = async (u: ListarStaff, novoPapel: string) => {
    const ok = await confirmarAcao({
      title: 'Alterar papel',
      message: `Alterar o papel de ${u.email} para ${novoPapel}?`,
      confirmLabel: 'Alterar',
    })
    if (!ok) return
    const { data, error } = await supabase.rpc('alterar_papel_staff', { p_user_id: u.id, p_papel: novoPapel })
    const r = (data as { sucesso: boolean; mensagem: string }[] | null)?.[0]
    if (error || !r?.sucesso) {
      pushToast(r?.mensagem ?? error?.message ?? 'Erro ao alterar papel.', 'erro')
      return
    }
    showSuccess(r.mensagem)
    void reload()
  }

  return (
    <AdminGate>
      <PageHeader
        title="Utilizadores"
        subtitle="Contas staff da instituição — secretaria e administração"
        actions={
          <button onClick={() => setCriando(true)} className="btn-primary">
            + Novo utilizador
          </button>
        }
      />

      <div className="cell">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorMessage message={error} onRetry={() => void reload()} />
        ) : (utilizadores ?? []).length === 0 ? (
          <EmptyState message="Nenhum utilizador listado." icon="👤" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Papel</th>
                  <th className="px-4 py-2.5 font-medium">Último acesso</th>
                  <th className="px-4 py-2.5 font-medium">Criado em</th>
                  <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(utilizadores ?? []).map((u) => (
                  <tr key={u.id} className="hover:bg-canvas">
                    <td className="px-4 py-2.5 font-medium text-ink">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={u.papel === 'admin' ? 'aprovado' : 'neutro'}>
                        {u.papel === 'admin' ? 'Administrador' : 'Secretaria'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 tnum text-ink-muted">
                      {u.ultimo_login ? format.dateTime(u.ultimo_login) : 'Nunca entrou'}
                    </td>
                    <td className="px-4 py-2.5 tnum text-ink-muted">{format.date(u.criado_em)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <select
                          value={u.papel}
                          onChange={(e) => void alterarPapel(u, e.target.value)}
                          className="input h-8 w-36 py-0.5 text-xs"
                          title="Alterar papel"
                        >
                          <option value="secretaria">Secretaria</option>
                          <option value="admin">Administrador</option>
                        </select>
                        <button onClick={() => setRedefinindo(u)} className="btn-secondary px-2.5 py-1 text-xs">
                          Redefinir password
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

      <p className="mt-2 text-xs text-ink-faint">
        Apenas o administrador pode criar contas, redefinir passwords e alterar papéis. As contas secretaria têm acesso
        limitado às operações do dia-a-dia.
      </p>

      {/* Contas dos formadores: o portal deles é separado do painel. */}
      <div className="cell mt-6">
        <div className="cell-head">
          <p className="label-section">Contas dos formadores</p>
          <span className="text-xs text-ink-faint">Acesso ao portal de lançamento de notas</span>
        </div>

        {loadingFormadores ? (
          <LoadingBlock />
        ) : (formadores ?? []).length === 0 ? (
          <EmptyState message="Ainda não há formadores registados. Crie-os em Cursos & Turmas." icon="👩‍🏫" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Formador</th>
                  <th className="px-4 py-2.5 font-medium">Conta</th>
                  <th className="px-4 py-2.5 font-medium text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(formadores ?? []).map((f) => (
                  <tr key={f.formador_id} className="hover:bg-canvas">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{f.nome}</p>
                      {!f.ativo && <p className="text-xs text-warn">Desactivado</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      {f.user_id ? (
                        <>
                          <p className="text-ink-muted">{f.email}</p>
                          <p className="text-xs text-ink-faint">
                            {f.ultimo_login ? `Entrou ${format.dateTime(f.ultimo_login)}` : 'Ainda não entrou'}
                          </p>
                        </>
                      ) : (
                        <Badge variant="pendente">Sem conta</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {f.user_id ? (
                          <button
                            onClick={() => setContaFormador({ formador: f, modo: 'password' })}
                            className="btn-secondary px-2.5 py-1 text-xs"
                          >
                            Redefinir password
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setContaFormador({ formador: f, modo: 'criar' })}
                              className="btn-primary px-2.5 py-1 text-xs"
                            >
                              Criar conta
                            </button>
                            <button
                              onClick={() => setContaFormador({ formador: f, modo: 'ligar' })}
                              className="btn-secondary px-2.5 py-1 text-xs"
                            >
                              Ligar conta existente
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {contaFormador && (
        <ContaFormadorModal
          formador={contaFormador.formador}
          modo={contaFormador.modo}
          onClose={() => setContaFormador(null)}
          onDone={() => void reloadFormadores()}
        />
      )}

      {criando && <CriarUtilizadorModal onClose={() => setCriando(false)} onDone={() => void reload()} />}
      {redefinindo && (
        <RedefinirPasswordModal utilizador={redefinindo} onClose={() => setRedefinindo(null)} onDone={() => void reload()} />
      )}
    </AdminGate>
  )
}
