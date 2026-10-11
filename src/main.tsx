import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AdminLayout from './components/AdminLayout'
import Dashboard from './pages/Dashboard'
import Inscricoes from './pages/Inscricoes'
import Alunos from './pages/Alunos'
import FichaAluno from './pages/FichaAluno'
import CursosTurmas from './pages/CursosTurmas'
import Candidaturas from './pages/Candidaturas'
import Pagamentos from './pages/Pagamentos'
import PosConclusao from './pages/PosConclusao'
import Utilizadores from './pages/Utilizadores'
import Configuracoes from './pages/Configuracoes'
import Login from './pages/Login'
import Publica from './pages/Publica'
import { RequireAuth } from './components/RequireAuth'
import ToastHost from './components/ToastHost'
import ConfirmHost from './components/ConfirmHost'
import BarraOffline from './components/BarraOffline'
// Camada offline: tem de ser importada antes da app (intercepta o fetch ao Supabase).
import './lib/offline'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastHost />
    <ConfirmHost />
    <BarraOffline />
    <BrowserRouter>
      <Routes>
        <Route path="/inscricao" element={<Publica />} />
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
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
            <Route path="configuracoes" element={<Configuracoes />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
