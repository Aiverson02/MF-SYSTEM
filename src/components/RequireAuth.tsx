import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sessaoLocalOffline } from '../lib/offline'
import { LoadingBlock } from './ui'

/**
 * offline: existe sessão local válida mas não há ligação para a verificar.
 * Nesse estado o painel abre com os dados em cache e a barra de offline
 * fica visível; as escritas vão para a fila de sincronização.
 */
export function RequireAuth() {
  const [state, setState] = useState<'loading' | 'authed' | 'anon'>('loading')

  useEffect(() => {
    let activo = true

    const resolver = (temSessao: boolean) => {
      if (!activo) return
      if (temSessao) {
        setState('authed')
      } else if (typeof navigator !== 'undefined' && !navigator.onLine && sessaoLocalOffline()) {
        // Sem rede e com sessão guardada/ainda válida neste computador:
        // entra em modo offline em vez de bloquear o utilizador.
        setState('authed')
      } else {
        setState('anon')
      }
    }

    void supabase.auth
      .getSession()
      .then(({ data }) => resolver(!!data.session))
      .catch(() => resolver(false))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      resolver(!!session)
    })
    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingBlock label="A verificar sessão..." />
      </div>
    )
  }
  return state === 'authed' ? <Outlet /> : <Navigate to="/login" replace />
}
