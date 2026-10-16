# Relatório de Segurança — SIGA (Painel da Secretaria)

**Data da auditoria:** 2026-10-09 · **Âmbito:** aplicação completa (cliente React,
migrations SQL, base de dados Supabase de produção, histórico git, config de deploy)

---

## Resumo executivo

A auditoria identificou **1 vulnerabilidade crítica**, 3 altas e várias médias/baixas.
Todas as críticas e altas foram **corrigidas e verificadas na base de dados real**
com testes de ataque simulados (transações com rollback — nenhum dado alterado).

| Severidade | Encontradas | Corrigidas | Estado |
|---|---|---|---|
| Crítica | 1 | 1 | ✔ verificada com ataque simulado |
| Alta | 3 | 3 | ✔ verificadas |
| Média | 4 | 4 | ✔ mitigadas |
| Baixa/Info | 4 | 3 | 1 aceite (ver "Riscos residuais") |

---

## Vulnerabilidades encontradas e corrigidas

### 🔴 CRÍTICA — Escalação de privilégios: papel em `user_metadata`

**O problema.** `eh_admin()`, `eh_staff()` e todas as RPCs de gestão (criar
utilizador, redefinir password, alterar papel, definir código de finanças) liam o
papel de `auth.jwt() -> 'user_metadata' ->> 'papel'`. Em Supabase, `user_metadata`
é **editável pelo próprio utilizador** via `PUT /auth/v1/user`
(`supabase.auth.updateUser({ data: { papel: 'admin' } })`). Qualquer conta —
incluindo uma secretaria — podia auto-promover-se a admin e aceder à gestão de
utilizadores, passwords e configurações. Confirmado na BD: ambos os utilizadores
tinham o papel apenas em `raw_user_meta_data`.

**A correcção (migração 014).** O papel vive agora **apenas em `app_metadata`**
(exclusivo do service_role, imutável pelo cliente). O papel existente foi migrado
e removido de `user_metadata`. `eh_admin()`/`eh_staff()` e todas as RPCs de
gestão foram reescritas para lerem só `app_metadata`.

**Verificação (JWT simulado + rollback):**

| Cenário | eh_admin | eh_staff |
|---|---|---|
| Ataque: papel forjado em `user_metadata` | **false** ✅ | **false** ✅ |
| Admin legítimo (`app_metadata`) | true | true |
| Secretaria (`app_metadata`) | false | true |

### 🔴 ALTA — Stored XSS no recibo (roubo de sessão da secretaria)

**O problema.** `imprimirRecibo()` em [src/lib/recibo.ts](src/lib/recibo.ts)
interpolar dados de alunos (nome, número de estudante, observações, etc.) em
HTML escrito com `document.write` **sem escape**. O nome vem do formulário
público de inscrição — qualquer candidato podia submeter
`<img src=x onerror="...">` como nome e, quando a secretaria imprimia o recibo,
o script executava na origem da app com acesso ao `localStorage`/`sessionStorage`
(sessão Supabase, desbloqueio de finanças).

**A correcção.** Função `esc()` de escape HTML aplicada a **todas** as
interpolações (nome do aluno, número, turma, observações, contactos, logotipo,
nº do recibo, `<title>`). O `logo_url` só é usado se for `http(s)://`. Os
botões do recibo passaram a ser ligados pelo opener via `addEventListener`
(sem handlers inline), compatível com a nova CSP.

### 🔴 ALTA — `anon` com grants totais em tabelas financeiras

**O problema.** `anon` tinha INSERT/UPDATE/DELETE/TRUNCATE em `pagamentos`,
`config_pagamentos`, `pos_conclusao`, `formadores` e `config_instituicao`. O RLS
impedia a leitura/escrita dos dados, mas os grants violavam o princípio do menor
privilégio — qualquer falha futura de política RLS expunha directamente estas
tabelas.

**A correcção.** Grants de `anon` revogados em todas as tabelas financeiras e de
configuração; mantidos apenas `SELECT` públicos necessários (catálogo de cursos,
formadores e dados de contactos da instituição).

### 🔴 ALTA — Inscrições directas com estado forjado

**O problema.** A política `inscricoes_anon_insert ... WITH CHECK (true)`
permitia a qualquer visitante inserir inscrições **directamente na tabela** via
REST, incluindo com `estado = 'aprovado'` — contornando toda a revisão da
secretaria.

**A correcção.** Insert directo de `anon` revogado (o site usa a RPC
`submeter_inscricao_publica`, que força `estado = 'pendente'` e `origem =
'online'` no servidor). Insert staff mantido com `WITH CHECK (eh_staff())`.

### 🟠 MÉDIA — Brute-force do código de finanças

`verificar_codigo_financas` aceitava tentativas ilimitadas. Agora: **5 falhas em
1 hora → 15 minutos de lockout** por utilizador (tabela `financas_tentativas`,
FORCE RLS, sem API access). Verificado: 5 falhas → tentativa com o código
**correto** devolve `false` e `bloqueado = true`.

### 🟠 MÉDIA — Documentos falsificados por anon

A política `documentos_anon_insert` permitia registar documentos já com
`estado_validacao = true`. Agora exige `estado_validacao = false`.

### 🟠 MÉDIA — Uploads de storage sem restrição

`docs_upload_anon` agora exige: pasta com **UUID da inscrição**, extensão
`png/jpg/jpeg/webp/pdf` e `anexar_documento_inscricao` valida o formato do
caminho no servidor (rejeita `javascript:`, `data:`, `..` e URLs absolutas).

### 🟠 MÉDIA — Inputs sem limites nas RPCs públicas

Todas as RPCs públicas (`submeter_inscricao_publica`, `localizar_*`,
`consultar_*`, `anexar_*`) agora limitam comprimentos (200/32/254 chars).
Verificado: nome de 5000 chars → rejeitado; `javascript:alert(1)` como URL →
rejeitado; 9999 chars em consulta → devolve vazio sem erro.

### 🟡 BAIXA — Passwords staff fracas e visíveis

Mínimo de 6 → **8 caracteres** (cliente + servidor, com validação de email no
servidor). Campos de password nos modais corrigidos de `type="text"` para
`type="password"` com `autoComplete="new-password"`.

### 🟡 BAIXA — Higiene do catálogo de funções

`set_updated_at()` com `search_path` fixo (corrige o advisor WARN do Supabase).
Funções trigger/internas (`validar_limite_cursos`, `criar_pos_conclusao`,
`rls_auto_enable`) revogadas de `anon`/`authenticated`.

---

## Defesas adicionais aplicadas

- **Headers HTTP de segurança** (Netlify + Vercel): CSP estrita (`script-src
  'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, HSTS, Referrer-Policy, Permissions-Policy,
  COOP/CORP.
- **CI**: passo `npm audit --omit=dev --audit-level=high` falha o build se
  surgir vulnerabilidade HIGH/CRITICAL em dependências de produção.
- **npm audit fix** aplicado (12 → vulnerabilidades restantes apenas em devDeps
  do toolchain, ver riscos residuais).

## Verificações finais

- `tsc --noEmit` ✔ · `vite build` ✔ (exit 0)
- `npm audit --omit=dev --audit-level=high` ✔ (exit 0)
- Testes de ataque na BD real com rollback: escalação de privilégios, lockout
  brute-force, inputs gigantes, `javascript:` URL — **todos bloqueados**
- Histógit git: **zero** segredos (PAT, service_role, chaves) no histórico completo

## Actualização — portal dos formadores (migração 016)

- **Papel novo `formador`** em `app_metadata` (como `admin`/`secretaria`), ligado
  ao registo em `formadores.user_id`. `eh_staff()` é falso para formadores: não
  herdam nenhum acesso da secretaria (testado em `npm run test:db`).
- **Sem superfície directa de tabelas para formadores**: o portal fala apenas por
  RPCs `security definer` (`pautas_do_formador`, `pauta_da_turma`,
  `guardar_notas_pauta`, `resumo_turma`) que devolvem só número de estudante e
  nome. BI, contactos, documentos, notas de outras turmas e finanças ficam fora.
  `anon` não executa nenhuma delas nem lê pautas, atribuições ou histórico.
- **Autorização no servidor, item a item**: a escrita exige pauta aberta pela
  secretaria, formador atribuído à turma (ou indicado na pauta), aluno da turma e
  nota dentro da escala. Pauta fechada recusa escrita do formador.
- **Registo académico com rasto**: `notas_historico` guarda cada lançamento,
  alteração e remoção (valor anterior → novo, conta, formador, data). A tabela não
  tem grants: lê-se só pela RPC `historico_notas_aluno` (staff).
- **[CORRIGIDO] Criação de contas staff** (014): `criar_utilizador_staff` chamava
  `jsonb_array_build_text`, função inexistente no PostgreSQL — a RPC falhava
  sempre em execução, pelo que contas criadas pela app "não funcionavam". A 016
  recria a função com `jsonb_build_array` e passa a recusar emails duplicados.
  (As contas existentes foram criadas correctamente, com o papel em
  `app_metadata`.)

## Actualização — validação em BD real e correcções (migrações 017 e 018)

- **[CORRIGIDO] Lista de utilizadores mostrava contas de formador como staff**
  (018): `listar_utilizadores_staff()` devolvia todas as contas de `auth.users`,
  incluindo as contas de formador criadas pela 016. No painel *Utilizadores* os
  formadores apareciam com o papel mal interpretado ("Secretaria") e o *select*
  de papel estava activo para essas linhas — um admin podia converter
  acidentalmente uma conta de formador em secretaria/admin, dando-lhe acesso ao
  painel da secretaria. A 018 filtra para `admin`/`secretaria`; os formadores
  continuam visíveis em *Contas dos formadores* (`listar_formadores_contas`).
  Corrigido com teste novo em `npm run test:db` (89 verificações).
- **[CORRIGIDO] `nota_minima_aprovacao()` sem `search_path` fixo** (017): o
  advisor de segurança (lint 0011 `function_search_path_mutable`) sinalizava a
  função criada na 015; agora tem `set search_path = public`, como as funções
  corrigidas na 014. O lint desapareceu do `get_advisors`.
- **Validação contra a BD real (2026-10-15)**: 015/016 aplicadas e percorridas
  com simulação de papéis (anon, conta sem papel, secretaria, admin e dois
  formadores) — `anon` não lê `notas` nem executa as RPCs do portal; o formador
  não lê `notas` nem `notas_historico` directamente (RLS/grants), só as suas
  turmas pelas RPCs; e todas as recusas devolvem mensagem clara (pauta fechada,
  prazo terminado, nota fora da escala, aluno de outra turma, pauta atribuída a
  outro formador, secretaria a tentar criar conta de formador).

## Revisão de segurança (2026-10-16) — migração 019

Revisão feita sobre o código, o bundle publicado e a base de dados real
(consultas a `pg_proc`, `pg_class`/`has_column_privilege`, `pg_policies` e um
pedido HTTP com a chave pública).

- **[MÉDIA — corrigido] `anon` lia `email` e `telefone` dos formadores.**
  `public.formadores` tinha `grant select` na tabela inteira para `anon`
  (004/014) sobre uma política `using (true)`. Como a chave pública viaja no
  bundle, qualquer visitante podia pedir
  `GET /rest/v1/formadores?select=email,telefone` — **HTTP 200 com dados,
  confirmado no projecto real**. Nenhuma página pública lê esta tabela
  (verificado em `src/`), mas a intenção documentada era um catálogo público:
  a 019 revoga o acesso à tabela e concede só `id, nome, especialidade, ativo`.
  A secretaria mantém `select *` (o painel mostra os contactos).
- **[MÉDIA — corrigido] `user_metadata.papel` ainda decidia a lista de staff.**
  `listar_utilizadores_staff()` usava
  `coalesce(app_metadata, user_metadata, 'secretaria')`. `user_metadata` é
  escrito pelo próprio utilizador (`auth.updateUser({ data: { papel } })`),
  pelo que uma conta com `app_metadata.papel` vazio podia declarar-se `admin` e
  aparecer como tal no painel *Utilizadores* — com o select de papel activo
  para essa linha. A 014 já tinha tirado este campo das decisões de
  `eh_admin()`/`eh_staff()`; a 019 remove-o também daqui. Fonte única:
  `raw_app_meta_data`.
- **[BAIXA — corrigido] A lista de contas staff não verificava o chamador.**
  Qualquer conta autenticada — um formador, por exemplo — podia executar a RPC
  e ler os emails da secretaria e do administrador. A 019 passa a exigir
  `eh_staff()`.
- **[CORRIGIDO] CSP ausente no `_headers`.** O `netlify.toml` e o `vercel.json`
  traziam a CSP, mas o `public/_headers` (lido pelo Cloudflare Pages) só tinha
  `Cache-Control`: um deploy fora do Netlify servia o site **sem** CSP. Passou a
  ter os mesmos headers, com valores idênticos aos das outras plataformas
  (comparação directa das três strings de CSP).
- **[CORRIGIDO] A interface deixava de confiar em `user_metadata`.** Além do
  SQL, `resolverPapel()`/`usePerfil()` aceitavam `user_metadata.papel` como
  fallback: uma conta podia "promover-se" na UI (o servidor continuava a
  recusar tudo, mas via-se o painel e os botões de admin). Removido.
- **Verificado sem problemas**: 55 de 55 funções `security definer` do esquema
  `public` têm `search_path` fixo (`pg_proc.proconfig`); as 17 tabelas têm RLS
  activa (e `financas_*` com `force row level security`); `anon` só lê `cursos`,
  `turmas`, `config_instituicao` e o catálogo de formadores, e só escreve
  `inscricoes`/`documentos_inscricao` (inscrição pública, com limites de
  formato); o bucket `documentos-inscricao` é **privado** (`public = false`) com
  leitura restrita a `eh_staff()` e o `logotipos` é público (é o logótipo do
  site); as alterações de papel de staff (`alterar_papel_staff`) validam
  `eh_admin()` e escrevem em `app_metadata`, apagando o mesmo campo de
  `user_metadata`.
- **Os testes novos discriminam**: corridos sem a 019, os dois casos centrais
  falham (a conta que se declara admin aparece como `admin`; um formador vê 2
  linhas da lista staff). `npm run test:db` → **100 verificações**.

## Riscos residuais e recomendações

1. **DevDeps com avisos HIGH** (toolchain apenas, não chega ao utilizador
   final): `braces`/`chokidar` via tailwindcss 3.x, `esbuild` via vite 5.x.
   Corrigíveis apenas com actualizações majors (Tailwind 4, Vite 6+) —
   recomendado antes do próximo ciclo de funcionalidades.
2. **react-router 6.x**: 2 advisories moderados (open redirect via backslash;
   não aplicável — a app não faz redirect de URLs do utilizador). Actualizar
   para v7 no próximo upgrade.
3. **Supabase Auth**: recomenda-se ativar no dashboard
   *Leaked Password Protection* (HaveIBeenPwned) e limitar *Confirmations*.
4. **Logotipo SVG**: uploads de SVG são vetor de XSS stored se servidos
   directamente; o bucket é próprio do Supabase (não executa scripts), mas
   recomenda-se restringir a PNG/JPEG/WebP se o formato deixar de ser necessário.
5. **Rate-limit de camada extra**: as RPCs públicas têm limites de input, mas
   não de frequência; para tráfego público elevado, ativar o rate-limit do
   Supabase API Gateway ou Cloudflare (gratuito no plano free do Netlify/Vercel).
6. **Histórico de migrações incompleto**: 015 e 016 estão aplicadas em produção
   mas não constam de `supabase_migrations.schema_migrations` (foram corridas
   por SQL directo). Se passares a aplicar por `supabase db push`, esses
   ficheiros voltam a correr — são idempotentes (`create table if not exists`,
   `create index if not exists`, `drop policy if exists` antes de cada
   `create policy`, `create or replace function`), pelo que reaplicá-las é
   seguro — mas convém confirmar isso numa cópia antes do primeiro `db push`.
7. **Políticas de Storage fora do repositório**: as políticas do bucket
   `documentos-inscricao` (`docs_leitura_staff`, `docs_gestao_staff`,
   `docs_eliminar_staff`) existem no projecto mas não nas migrações — um
   ambiente novo não as recria. Versionar antes de criar o próximo ambiente.
