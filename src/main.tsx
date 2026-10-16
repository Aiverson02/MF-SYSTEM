import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import './index.css'

// Divisão de código: cada página do painel entra em chunks separados, baixados
// sob demanda quando o utilizador navega para eles. Isto mantém rápido o
// arranque do sistema principal.
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inscricoes = lazy(() => import('./pages/Inscricoes'))
const Alunos = lazy(() => import('./pages/Alunos'))
const FichaAluno = lazy(() => import('./pages/FichaAluno'))
const CursosTurmas = lazy(() => import('./pages/CursosTurmas'))
const Candidaturas = lazy(() => import('./pages/Candidaturas'))
const Pagamentos = lazy(() => import('./pages/Pagamentos'))
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastHost />
    <ConfirmHost />
    <BarraOffline />
    <PromptInstalacao />
    <BrowserRouter>
      <Suspense fallback={<LoadingBlock />}>
        <Routes>
          {/* Raiz = sistema principal: encaminha para o painel (ou login, via RequireAuth) */}
          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
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
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
)
