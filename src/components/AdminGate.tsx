import type { ReactNode } from 'react'
import { usePerfil } from '../hooks/usePerfil'
import { ErrorMessage } from '../components/ui'

interface AdminGateProps {
  children: ReactNode
  fallback?: ReactNode
}
/**
 * Porão de segurança (defense in depth) para qualquer função executiva.
 *
 * - No servidor o controle já existe nas RPCs/RLS (ver migrations 011/012 e
 *   outras funções que usam auth.jwt()->'user_metadata'|'app_metadata'->>'papel').
 * - Este componente esconde a UI para quem não é admin, mas nunca é a única
 *   barreira: tudo o que ele rende tem de estar protegido também no servidor.
 */
export default function AdminGate({ children, fallback }: AdminGateProps) {
  const perfil = usePerfil()

  // Enquanto o perfil ainda não chegou, não rende o erro (evita "flash"
  // de "Sem permissão" num instante antes de saber o papel real).
  if (perfil === null) {
    return (
      fallback ?? (
        <div className="flex items-center justify-center py-12 text-ink-muted">
          <span className="text-sm">A verificar permissões...</span>
        </div>
      )
    )
  }

  if (perfil.papel !== 'admin') {
    return (
      fallback ?? (
        <ErrorMessage
          message="Sem permissão — apenas o administrador tem acesso a esta secção."
        />
      )
    )
  }

  return <>{children}</>
}
