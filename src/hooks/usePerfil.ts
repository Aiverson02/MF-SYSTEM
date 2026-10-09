import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface Perfil {
  email: string | null
  nome: string
  papel: 'admin' | 'secretaria' | 'desconhecido'
}

/**
 * Lê o utilizador autenticado e o papel a partir do JWT.
 *
 * O papel vive em `app_metadata` (migração 014) — escrita exclusiva do
 * service_role, IMUTÁVEL pelo próprio utilizador. Antes vivia em
 * `user_metadata`, que qualquer conta podia alterar via auth.updateUser()
 * (escalação de privilégios). O fallback para user_metadata existe apenas
 * para transição e não confere permissão alguma no servidor.
 *
 * Nota: isto é apenas para a UI esconder/mostrar acções. A garantia real de
 * segurança está no servidor (RPCs security definer + RLS) — nunca no cliente.
 */
export function usePerfil() {
  const [perfil, setPerfil] = useState<Perfil | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      if (!data.user) {
        setPerfil(null)
        return
      }
      const appMeta = (data.user.app_metadata ?? {}) as Record<string, unknown>
      const userMeta = (data.user.user_metadata ?? {}) as Record<string, unknown>
      const papelRaw = String(appMeta.papel ?? userMeta.papel ?? '')
      setPerfil({
        email: data.user.email ?? null,
        nome: String(userMeta.nome ?? userMeta.name ?? data.user.email ?? 'Utilizador'),
        papel:
          papelRaw === 'admin' || papelRaw === 'secretaria' ? (papelRaw as Perfil['papel']) : 'desconhecido',
      })
    }

    void load()
    const { data: sub } = supabase.auth.onAuthStateChange(() => void load())
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return perfil
}

/** Verdadeiro só quando o utilizador autenticado é administrador (para a UI). */
export function useIsAdmin(): boolean {
  const p = usePerfil()
  return p?.papel === 'admin'
}

const AVATAR_COLORS = ['bg-primary-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600']

export function initials(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function avatarColor(nome: string): string {
  let hash = 0
  for (const c of nome) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
