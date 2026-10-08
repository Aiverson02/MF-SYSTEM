import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { bloquearFinancas } from '../hooks/useFinancas'
import { avatarColor, initials, usePerfil } from '../hooks/usePerfil'
import { supabase } from '../lib/supabase'

const SECTION_TITLES: Record<string, string> = {
  '/admin/dashboard': 'Dashboard',
  '/admin/inscricoes': 'Inscrições',
  '/admin/cursos': 'Cursos & Turmas',
  '/admin/alunos': 'Alunos & Turmas',
}

export default function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggleTheme } = useTheme()
  const perfil = usePerfil()
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()

  const nome = perfil?.nome ?? 'Utilizador'
  const papelLabel =
    perfil?.papel === 'admin' ? 'Administrador' : perfil?.papel === 'secretaria' ? 'Secretaria' : 'Sem papel definido'
  const titulo = SECTION_TITLES[pathname] ?? 'Painel'

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="btn-ghost -ml-1 p-2 lg:hidden"
          aria-label="Abrir menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {/* Contexto real: secção actual (sem "bem-vindo") */}
        <p className="text-[13px] font-medium text-ink">{titulo}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Tema claro/escuro */}
        <button
          onClick={toggleTheme}
          className="btn-ghost p-2"
          aria-label="Alternar tema"
          title="Alternar tema claro/escuro"
        >
          {theme === 'dark' ? (
            <svg className="h-4.5 w-4.5 h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          ) : (
            <svg className="h-4.5 w-4.5 h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          )}
        </button>

        {/* Perfil */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-md p-1.5 hover:bg-raised"
            aria-label="Menu do utilizador"
          >
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-surface ${avatarColor(nome)}`}
            >
              {initials(nome)}
            </div>
            <div className="hidden text-left leading-tight sm:block">
              <p className="text-[13px] font-medium text-ink">{nome}</p>
              <p className="text-xs text-ink-faint">{papelLabel}</p>
            </div>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="overlay-in absolute right-0 z-20 mt-1.5 w-56 rounded-lg border border-line bg-surface py-1">
                <div className="border-b border-line px-4 py-2.5">
                  <p className="truncate text-[13px] font-medium text-ink">{nome}</p>
                  <p className="truncate text-xs text-ink-muted">{perfil?.email ?? ''}</p>
                </div>
                <button
                  onClick={async () => {
                    // O flag de desbloqueio vive no sessionStorage e sofre com o logout
                    // O flag de desbloqueio vive no sessionStorage e sofre com o logout no mesmo separador: limpa-o antes de deslogar, senão o seguinte utilizador herda a área de finanças aberta.
                    bloquearFinancas()
                    await supabase.auth.signOut()
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-[13px] text-danger hover:bg-raised"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  Terminar sessão
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
