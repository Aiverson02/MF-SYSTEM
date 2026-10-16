import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useInstituicao } from '../../hooks/useInstituicao'
import { usePerfil } from '../../hooks/usePerfil'
import { useTheme } from '../../hooks/useTheme'

/**
 * Moldura do portal dos formadores: leve e pensada para telemóvel
 * (cabeçalho curto, navegação simples, sem o menu do painel da secretaria).
 *
 * A segurança está no servidor: as RPCs só devolvem as turmas do formador
 * autenticado.
 */
export default function PortalFormador() {
  const instituicao = useInstituicao()
  const perfil = usePerfil()
  const { theme, toggleTheme } = useTheme()
  const [menuAberto, setMenuAberto] = useState(false)

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-surface">
              CF
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-medium text-ink">{instituicao.nome}</p>
              <p className="text-xs text-ink-faint">Portal do formador</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={toggleTheme} className="btn-ghost p-2" aria-label="Alternar tema">
              {theme === 'dark' ? (
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuAberto((v) => !v)}
                className="rounded-md px-2 py-1.5 text-[13px] font-medium text-ink hover:bg-raised"
                aria-label="Menu do formador"
              >
                {perfil?.nome?.split(' ')[0] ?? 'Conta'}
              </button>
              {menuAberto && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)} aria-hidden />
                  <div className="overlay-in absolute right-0 z-20 mt-1.5 w-56 rounded-lg border border-line bg-surface py-1">
                    <div className="border-b border-line px-4 py-2.5">
                      <p className="truncate text-[13px] font-medium text-ink">{perfil?.nome ?? ''}</p>
                      <p className="truncate text-xs text-ink-muted">{perfil?.email ?? ''}</p>
                    </div>
                    <button
                      onClick={async () => {
                        await supabase.auth.signOut()
                        setMenuAberto(false)
                      }}
                      className="w-full px-4 py-2 text-left text-[13px] text-danger hover:bg-raised"
                    >
                      Terminar sessão
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <nav className="mx-auto flex max-w-3xl gap-1 px-3 pb-2">
          {[
            { to: '/formador/pautas', label: 'As minhas pautas' },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  isActive ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-raised hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  )
}
