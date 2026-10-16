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
(`001` … `018`). No editor SQL do Supabase, execute cada ficheiro pela ordem dos
números. As migrations que definem a segurança e o modelo de papéis:

- `013` — segurança admin/finanças: `public.eh_admin()` / `public.eh_staff()`,
  tabela privada `financas_seguranca` (hash bcrypt do código de finanças),
  RPCs `definir_codigo_financas`, `verificar_codigo_financas`,
  `codigo_financas_definido`, RLS admin-only em escrita de `config_instituicao`
  e `config_pagamentos`.
- `014` — hardening: o papel passa a viver **apenas em `app_metadata`**
  (imutável pelo próprio utilizador), grants mínimos para `anon`, lockout do
  código de finanças, limites de input nas RPCs públicas.
- `015` — avaliações e notas: catálogo de itens por curso (`avaliacoes`), notas
  por aluno/item (`notas`), vista `notas_resumo_aluno` com a nota final.
- `016` — portal dos formadores: atribuição de formadores por turma, pautas
  (aberta/fechada), histórico de alterações às notas e RPCs do portal.
- `017` — higiene: `nota_minima_aprovacao()` passa a ter `search_path` fixo
  (o advisor de segurança do Supabase deixou de sinalizar a função).
- `018` — `listar_utilizadores_staff` devolve **só** contas staff: as contas de
  formador deixaram de aparecer no painel Utilizadores com papel editável.

### Papéis e contas

Os papéis são `admin`, `secretaria` e `formador`, e vivem em
**`app_metadata.papel`** — **nunca** em `user_metadata`, que qualquer conta pode
alterar sozinha (`supabase.auth.updateUser`) e serviria para escalar
privilégios. A UI lê `user_metadata.papel` apenas como fallback de transição;
nenhuma permissão do servidor o considera.

Criar contas de secretaria/admin pelo painel **Utilizadores** (RPC
`criar_utilizador_staff`, só admin) — é o caminho que grava o papel no sítio
certo. Contas de formador são criadas na aba **Formadores** (Cursos & Turmas)
ou pela RPC `criar_conta_formador`, que além do papel liga a conta ao registo do
formador (`formadores.user_id`).

Se criaste contas à mão em **Authentication → Users**, confirma que o papel está
em `app_metadata` e não em `user_metadata`: contas com o papel no sítio errado
aparecem como "Administrador" na interface mas o servidor recusa tudo.

## Verificação automática das migrations

Os testes de base de dados correm num Postgres real embutido (WASM) sem
precisar de Docker nem de internet:

```bash
npm run test:db   # aplica as migrations e verifica as regras de negócio
```

Cobrem a fórmula da nota final, as validações de escala e a autorização dos
formadores (isolamento entre formadores, pauta fechada, item de outro curso).

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
- O `start_url` do PWA é `/`, que encaminha por papel (painel da secretaria ou
  portal do formador); o service worker atualiza automaticamente (`autoUpdate`).

## Segurança (resumo)

- Código de finanças validado **no servidor** (hash bcrypt); nunca vai ao cliente.
- Papéis em `app_metadata` (imutável pelo utilizador): `admin`, `secretaria`,
  `formador`. `eh_staff()` é falso para formadores.
- Formadores não têm acesso directo a tabelas: o portal fala apenas por RPCs
  `security definer` que devolvem o mínimo (nº de estudante e nome) e validam,
  no servidor, formador ↔ turma, pauta aberta e escala da nota.
- Alterações a notas ficam registadas em `notas_historico` (quem, quando, valor
  anterior → novo); pauta fechada recusa escrita.
- Desbloqueio de Pagamentos preendido à conta (sessionStorage por UID) e limpo
  em logout / troca de conta / sessão expirada.
- Escrita em configurações e preços: apenas `admin` (RLS).
- `.env` e `.freebuff/` estão no `.gitignore`; nunca commitar credenciais.

## Portal dos formadores

Cada formador tem a sua conta e entra no portal (não no painel da secretaria):

1. Em **Cursos & Turmas → Formadores**, criar o formador.
2. Em **Pautas**, escolher a turma e **atribuir o formador à turma** (um curso
   pode ter formadores diferentes por turno, e uma turma pode ter mais de um).
3. Em **Utilizadores → Contas dos formadores**, criar a conta (email pessoal +
   password entregue em mão) ou ligar uma conta já existente.
4. Ainda em **Pautas**, abrir a pauta de cada item (avaliação, exame ou recurso)
   que o formador deve preencher — com prazo e/ou atribuída a um formador
   específico, se for o caso.

O formador entra, vê apenas as suas turmas e lança as notas enquanto a pauta
estiver aberta. Quando a secretaria **fecha** a pauta, o formador deixa de poder
alterar (a secretaria continua a poder corrigir, e toda a alteração fica em
`notas_historico`). O portal não mostra BI, contactos, documentos nem finanças.

## Instalar como aplicativo no Windows (PWA)

O SIGA é um PWA instalável: abre como aplicativo próprio, com ícone na barra
de tarefas e janela sem endereço de internet.

1. Abra o site no **Microsoft Edge** (ou Chrome).
2. Menu `⋯` → **Aplicativos** → **Instalar este site como aplicativo** (Chrome:
   ícone de instalar no fim da barra de endereço).
3. Confirme — aparece como "SIGA" no menu Iniciar e na barra de tarefas.

### Modo offline (funciona sem internet)

A camada em `src/lib/offline.ts` garante:

- **Leituras offline**: cada consulta ao Supabase (GET e RPCs de consulta) é
  guardada no Cache API; sem ligação são servidos os últimos dados vistos.
- **Escritas offline**: alterações feitas sem ligação entram numa fila
  persistente (localStorage) e a app avisa "alteração guardada". Ao voltar a
  ligação (evento `online` ou tentativa automática a cada 45 s) a fila é
  reenviada e os dados são actualizados.
- **Login offline**: a **primeira** autenticação exige internet. Depois de
  entrar uma vez, a sessão fica guardada e o painel abre offline (leituras em
  cache, escritas na fila). Se a sessão expirar, é pedida ligação para
  renovar.
- O indicador no canto inferior esquerdo mostra o estado: offline (âmbar), a
  sincronizar (azul) ou falhas (vermelho — toque para ver motivos).

Limitações: o **envio de ficheiros** (documentos de inscrição) e a verificação
do código de finanças exigem ligação.
