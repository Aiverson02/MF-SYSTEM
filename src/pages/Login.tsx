import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/ui'
import { useInstituicao } from '../hooks/useInstituicao'

const MSG_OFFLINE =
  'Sem ligação à internet. O acesso offline só está disponível para sessões já iniciadas neste computador — ' +
  'conecte-se uma vez para entrar e depois o painel abre offline com os últimos dados guardados.'

export default function Login() {
  const navigate = useNavigate()
  const instituicao = useInstituicao()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Primeira autenticação exige rede (o Supabase valida as credenciais).
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError(MSG_OFFLINE)
      return
    }

    setLoading(true)
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) {
        if (/failed to fetch|networkerror|load failed/i.test(err.message)) setError(MSG_OFFLINE)
        else setError(err.message)
        setLoading(false)
        return
      }
      // Sessão persistida: navegar explicitamente para o painel.
      navigate('/admin/dashboard', { replace: true })
    } catch {
      setError(MSG_OFFLINE)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-accent text-sm font-semibold text-surface">
            CF
          </div>
          <h1 className="font-serif text-xl font-semibold text-ink">{instituicao.nome}</h1>
          <p className="text-sm text-ink-muted">Painel da Secretaria, acesso restrito</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="label-section mb-1 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
              placeholder="secretaria@centro.co.mz"
              autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="password" className="label-section mb-1 block">
              Palavra-passe
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
            {loading && <Spinner className="h-4 w-4" />}
            {loading ? 'A entrar...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
