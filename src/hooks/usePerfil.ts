import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface Perfil {
  email: string | null
  nome: string
  papel: 'admin' | 'secretaria' | 'formador' | 'desconhecido'
}

/** Papéis que usam o painel da secretaria. */
export const PAPEIS_STAFF = ['admin', 'secretaria'] as const

/** Onde cada papel entra depois do login. */
export function casaDoPapel(papel: Perfil['papel']): string {
  return papel === 'formador' ? '/formador/pautas' : '/admin/dashboard'
}

/**
 * Papel do utilizador autenticado.
 *
 * Lê primeiro o JWT (`app_metadata.papel`, imutável pelo cliente). Quando o JWT
 * não traz papel nenhum — conta criada no painel Auth e depois ligada a um
 * formador — pergunta à BD por `formador_actual()`, que é **exactamente** o
 * critério que as RPCs do portal usam para autorizar (`formadores.user_id =
 * auth.uid()`). Assim quem está ligado como formador entra no portal dele em
 * vez de cair no painel da secretaria.
 *
 * `user_metadata` NÃO é consultado: é escrito pelo próprio utilizador
 * (auth.updateUser) e por isso não vale como papel — ver migração 019.
 */
export async function resolverPapel(): Promise<Perfil['papel']> {
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return 'desconhecido'

  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>
  const papel = String(appMeta.papel ?? '')
  if (papel === 'admin' || papel === 'secretaria' || papel === 'formador') return papel

  const { data: formadorId, error } = await supabase.rpc('formador_actual')
  if (!error && formadorId) return 'formador'
  return 'desconhecido'
}

/**
 * Lê o utilizador autenticado e o papel a partir do JWT.
 *
 * O papel vive em `app_metadata` (migração 014) — escrita exclusiva do
 * service_role, IMUTÁVEL pelo próprio utilizador. Antes vivia em
 * `user_metadata`, que qualquer conta podia alterar via auth.updateUser()
 * (escalação de privilégios); a migração 019 tirou também o último fallback
 * que ainda existia nesse campo.
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
      const userMeta = (data.user.user_metadata ?? {}) as Record<string, unknown>
      const papel = await resolverPapel()
      if (!active) return
      setPerfil({
        email: data.user.email ?? null,
        nome: String(userMeta.nome ?? userMeta.name ?? data.user.email ?? 'Utilizador'),
        papel,
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
