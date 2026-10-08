import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LoadingBlock } from './ui'

export function RequireAuth() {
  const [state, setState] = useState<'loading' | 'authed' | 'anon'>('loading')

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setState(data.session ? 'authed' : 'anon')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? 'authed' : 'anon')
    })
    return () => sub.subscription.unsubscribe()
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
