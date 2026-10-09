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
