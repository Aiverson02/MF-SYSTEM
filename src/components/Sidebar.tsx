import { NavLink } from 'react-router-dom'
import { useInstituicao } from '../hooks/useInstituicao'
import { usePerfil } from '../hooks/usePerfil'

interface NavItem {
  to: string
  label: string
  icon: JSX.Element
  /** Só visível para administradores (a garantia real está no servidor). */
  adminOnly?: boolean
}

const iconClass = 'h-4.5 w-4.5 h-[18px] w-[18px] shrink-0'

const navItems: NavItem[] = [
  {
    to: '/admin/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" />
      </svg>
    ),
  },
  {
    to: '/admin/inscricoes',
    label: 'Inscrições',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6L19 9.4V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
  {
    to: '/admin/candidaturas',
    label: 'Candidaturas Online',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21a9 9 0 100-18 9 9 0 000 18zm0-18c2.5 2.2 4 5.4 4 9s-1.5 6.8-4 9m0-18c-2.5 2.2-4 5.4-4 9s1.5 6.8 4 9M3 12h18"
        />
      </svg>
    ),
  },
  {
    to: '/admin/pagamentos',
    label: 'Pagamentos',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
        />
      </svg>
    ),
  },
  {
    to: '/admin/cursos',
    label: 'Cursos & Turmas',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        />
      </svg>
    ),
  },
  {
    to: '/admin/alunos',
    label: 'Alunos & Turmas',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-4a3 3 0 11-3-3"
        />
      </svg>
    ),
  },
  {
    to: '/admin/pos-conclusao',
    label: 'Pós-Conclusão',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 21h8m-4-4v4M6.5 3h11l-.5 7c-.3 2.5-2 4.5-5 4.5s-4.7-2-5-4.5L6.5 3z"
        />
      </svg>
    ),
  },
  {
    to: '/admin/utilizadores',
    label: 'Utilizadores',
    adminOnly: true,
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-4a3 3 0 11-3-3"
        />
      </svg>
    ),
  },
  {
    to: '/admin/guia',
    label: 'Guia rápido',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    to: '/admin/configuracoes',
    label: 'Configurações',
    adminOnly: true,
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const instituicao = useInstituicao()
  const perfil = usePerfil()
  const isAdmin = perfil?.papel === 'admin'
  const iniciais =
    instituicao.nome
      .split(/\s+/)
      .filter((p) => p.length > 2)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join('') || 'CF'

  return (
    <>
      {/* Overlay mobile (único uso de blur, em fundo escurecido) */}
      {open && (
        <div className="fixed inset-0 z-30 bg-canvas/60 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Marca: única peça de identidade, discreta */}
        <div className="flex h-14 items-center gap-3 border-b border-line px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-surface">
            {iniciais}
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold text-ink" title={instituicao.nome}>
              {instituicao.nome}
            </p>
            <p className="label-section text-[10px]">Gestão de Inscrições</p>
          </div>
        </div>

        {/* Navegação: estado activo por fundo + barra lateral, sem animação */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="label-section mb-2 px-3">Administração</p>
          <div className="space-y-0.5">
            {navItems
              .filter((item) => !item.adminOnly || isAdmin)
              .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium ${
                    isActive
                      ? 'bg-accent-soft text-accent-ink'
                      : 'text-ink-muted hover:bg-raised hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden />}
                    {item.icon}
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Rodapé */}
        <div className="border-t border-line px-5 py-3">
          <p className="text-xs text-ink-faint">Painel da Secretaria, v0.1</p>
        </div>
      </aside>
    </>
  )
}
