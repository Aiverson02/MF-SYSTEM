import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import RequirePapel from './components/RequirePapel'
import { PAPEIS_STAFF } from './hooks/usePerfil'
import ToastHost from './components/ToastHost'
import ConfirmHost from './components/ConfirmHost'
import BarraOffline from './components/BarraOffline'
import PromptInstalacao from './components/PromptInstalacao'
import { LoadingBlock } from './components/ui'
// Camada offline: tem de ser importada antes da app (intercepta o fetch ao Supabase).
import './lib/offline'
// Registo do service worker com actualização automática (ver src/pwa.ts).
import { registarServiceWorker } from './pwa'
import './index.css'

// Divisão de código: cada página do painel entra em chunks separados, baixados
// sob demanda quando o utilizador navega para eles. Isto mantém rápido o
// arranque do sistema principal.
//
// A página pública NÃO está aqui: tem a sua própria entrada (main-landing.tsx),
// para que o build do site público nunca arraste estes chunks.
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inscricoes = lazy(() => import('./pages/Inscricoes'))
const Alunos = lazy(() => import('./pages/Alunos'))
const FichaAluno = lazy(() => import('./pages/FichaAluno'))
const CursosTurmas = lazy(() => import('./pages/CursosTurmas'))
const Candidaturas = lazy(() => import('./pages/Candidaturas'))
const Pagamentos = lazy(() => import('./pages/Pagamentos'))
const Financas = lazy(() => import('./pages/Financas'))
const PosConclusao = lazy(() => import('./pages/PosConclusao'))
const Utilizadores = lazy(() => import('./pages/Utilizadores'))
const Configuracoes = lazy(() => import('./pages/Configuracoes'))
const GuiaRapido = lazy(() => import('./pages/GuiaRapido'))
const Login = lazy(() => import('./pages/Login'))
const Pautas = lazy(() => import('./pages/Pautas'))
// Portal dos formadores (papel `formador`) — bundle próprio, leve para telemóvel.
const PortalFormador = lazy(() => import('./pages/formador/PortalFormador'))
const MinhasPautas = lazy(() => import('./pages/formador/MinhasPautas'))
const LancarPauta = lazy(() => import('./pages/formador/LancarPauta'))

/** Área de trabalho (painel, login, portal): as ferramentas do SIGA. */
const AREA_RESERVADA = /^\/(admin|login|formador)(\/|$)/

/**
 * Sistema central: `npm run build` → dist/ (painel + portal).
 * O site público é outro build, com outra entrada: `npm run build:site`.
 */
function App() {
  const { pathname } = useLocation()
  const areaReservada = AREA_RESERVADA.test(pathname)

  return (
    <>
      {/* A barra offline e o convite a instalar são da secretaria. */}
      {areaReservada && <BarraOffline />}
      {areaReservada && <PromptInstalacao />}
      <Suspense fallback={<LoadingBlock />}>
        <Routes>
          {/* O sistema não serve o site público: quem chega à raiz entra pela
              autenticação (o site da instituição tem o seu próprio endereço). */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            {/* Painel da secretaria — papéis admin/secretaria */}
            <Route element={<RequirePapel papeis={PAPEIS_STAFF} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="inscricoes" element={<Inscricoes />} />
                <Route path="candidaturas" element={<Candidaturas />} />
                <Route path="pagamentos" element={<Pagamentos />} />
                <Route path="financas" element={<Financas />} />
                <Route path="pos-conclusao" element={<PosConclusao />} />
                <Route path="utilizadores" element={<Utilizadores />} />
                <Route path="alunos" element={<Alunos />} />
                <Route path="alunos/:id" element={<FichaAluno />} />
                <Route path="cursos" element={<CursosTurmas />} />
                <Route path="pautas" element={<Pautas />} />
                <Route path="configuracoes" element={<Configuracoes />} />
                <Route path="guia" element={<GuiaRapido />} />
              </Route>
            </Route>

            {/* Portal dos formadores — papel formador */}
            <Route element={<RequirePapel papeis={['formador']} />}>
              <Route path="/formador" element={<PortalFormador />}>
                <Route index element={<Navigate to="pautas" replace />} />
                <Route path="pautas" element={<MinhasPautas />} />
                <Route path="pauta/:turmaId/:avaliacaoId" element={<LancarPauta />} />
              </Route>
            </Route>
          </Route>
          {/* Qualquer outro endereço do sistema volta à entrada. */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

// O service worker (offline e instalação) é só do sistema: a página pública
// tem a sua própria entrada, sem PWA e sem cache local.
registarServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastHost />
    <ConfirmHost />
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
