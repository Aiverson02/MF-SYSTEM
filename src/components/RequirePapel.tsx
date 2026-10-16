import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LoadingBlock } from './ui'
import { casaDoPapel, usePerfil, type Perfil } from '../hooks/usePerfil'

/**
 * Portão por papel na UI (a garantia real está no servidor: RLS + RPCs).
 *
 * - `papeis` = papéis que podem entrar nesta árvore de rotas.
 * - Quem estiver autenticado mas sem permissão é encaminhado para a sua própria
 *   casa (formador → portal; restantes → painel), em vez de ver um erro.
 * - Conta **sem papel nenhum** não entra em lado nenhum: mostra como resolver
 *   (antes, caía no painel da secretaria por caminho inverso).
 */
export default function RequirePapel({ papeis }: { papeis: readonly Perfil['papel'][] }) {
  const perfil = usePerfil()
  const { pathname } = useLocation()

  if (perfil === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <LoadingBlock label="A verificar permissões..." />
      </div>
    )
  }

  if (!papeis.includes(perfil.papel)) {
    if (perfil.papel === 'desconhecido') return <SemPapel perfil={perfil} />
    const casa = casaDoPapel(perfil.papel)
    return casa === pathname ? <Outlet /> : <Navigate to={casa} replace />
  }

  return <Outlet />
}

/** Conta autenticada sem papel atribuído (não é staff nem formador ligado). */
function SemPapel({ perfil }: { perfil: Perfil }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-canvas px-4 text-center">
      <div className="max-w-md">
        <h1 className="font-serif text-lg text-ink">Conta sem acesso atribuído</h1>
        <p className="mt-2 text-sm text-ink-muted">
          A conta <span className="font-mono text-[13px] text-ink">{perfil.email}</span> ainda não está ligada a
          nenhum papel do sistema. Peça à administração para:
        </p>
        <ul className="mx-auto mt-3 max-w-md list-inside list-disc space-y-1 text-left text-[13px] text-ink-muted">
          <li>criar o acesso em <strong>Utilizadores → Novo utilizador</strong> (secretaria/admin); ou</li>
          <li>ligar esta conta a um formador em <strong>Utilizadores → Contas dos formadores</strong>.</li>
        </ul>
      </div>
      <button onClick={() => void supabase.auth.signOut()} className="btn-secondary">
        Terminar sessão
      </button>
    </div>
  )
}
