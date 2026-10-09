# SIGA — Painel da Secretaria

Painel administrativo de gestão de inscrições (Vite + React + TypeScript + Supabase).
Inscrições, matrículas, pagamentos, pós-conclusão e relatórios, com PWA (funciona offline
com os últimos dados vistos).

## Requisitos

- Node.js 20+ e npm
- Um projeto [Supabase](https://supabase.com) com as migrations aplicadas

## Setup local

```bash
npm install
cp .env.example .env   # e preencher com as credenciais do projeto Supabase
```

Variáveis em `.env` (só estas duas são necessárias):

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
```

```bash
npm run dev    # servidor de desenvolvimento (http://localhost:5173)
```

## Build de produção

```bash
npm run build  # tsc -b && vite build → dist/
```

## Banco de dados (Supabase)

As migrations estão em `supabase/migrations/` e devem ser aplicadas **por ordem**
(`001` … `013`). No editor SQL do Supabase, execute cada ficheiro pela ordem dos
números. A migration `013` é a que define a segurança admin/finanças:

- `public.eh_admin()` / `public.eh_staff()` — papéis via `user_metadata.papel`
- Tabela privada `financas_seguranca` (hash bcrypt do código de finanças)
- RPCs `definir_codigo_financas`, `verificar_codigo_financas`, `codigo_financas_definido`
- RLS admin-only em escrita de `config_instituicao` e `config_pagamentos`

Crie os utilizadores em **Authentication → Users** e defina
`user_metadata = { "papel": "admin" }` ou `{ "papel": "secretaria" }`.

## Deploy

O app é um SPA estático ( BrowserRouter ) — os configs incluídos tratam do
fallback de rotas. Qualquer um dos destinos funciona:

### Netlify

Detetado automaticamente (`netlify.toml`): build `npm run build`, publica `dist/`,
redirect SPA `/* → /index.html`. Liga o repo GitHub `Aiverson02/MF-SYSTEM` em
<https://app.netlify.com> (ou `netlify deploy --prod`).

### Vercel

Detetado automaticamente (`vercel.json`): `vercel --prod` ou importa o repo em
<https://vercel.com/new>.

### Cloudflare Pages

Cria o projeto apontando ao repo; build `npm run build`, output `dist/`.
O ficheiro `public/_redirects` (incluído no build) faz o fallback SPA.

### Variáveis de ambiente em produção

Definir `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no painel do host
(mesmos valores do `.env` local). Sem elas o build funciona mas o app avisa
que não está configurado.

### Pós-deploy

- Adicionar o URL de produção à lista de **Redirect URLs** do Supabase
  (Authentication → URL Configuration), se usar ligações por email.
- O `start_url` do PWA é `/admin/dashboard`; o service worker atualiza
  automaticamente (`autoUpdate`).

## Segurança (resumo)

- Código de finanças validado **no servidor** (hash bcrypt); nunca vai ao cliente.
- Desbloqueio de Pagamentos preendido à conta (sessionStorage por UID) e limpo
  em logout / troca de conta / sessão expirada.
- Escrita em configurações e preços: apenas `admin` (RLS).
- `.env` e `.freebuff/` estão no `.gitignore`; nunca commitar credenciais.
