import React from 'react'
import ReactDOM from 'react-dom/client'
// Entrada exclusiva do site público: só a página da instituição e o formulário
// de inscrição. Não importa o painel, o router, a camada offline nem o PWA —
// por isso o build público não leva um único chunk do sistema central.
// Só o preflight do Tailwind (reset do documento), sem os tokens nem os
// utilitários do painel.
import './styles/preflight.css'
import Landing from './pages/Landing'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>,
)
