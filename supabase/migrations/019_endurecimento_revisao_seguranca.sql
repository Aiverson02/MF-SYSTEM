-- ============================================================================
-- 019 — Endurecimento após a revisão de segurança (2026-10-16)
-- ============================================================================
-- Três problemas encontrados na revisão do portal dos formadores. Os dois
-- primeiros foram confirmados contra o projecto de produção; o terceiro é uma
-- conclusão de leitura do código e dos testes locais.
--
--  1. [MÉDIA — exposição de dados] `public.formadores` tinha SELECT para `anon`
--     na TABELA inteira, incluindo `email` e `telefone`. Como a chave pública
--     viaja no bundle do site, qualquer visitante podia listar os contactos
--     dos formadores:
--         GET /rest/v1/formadores?select=email,telefone   → 200 + dados
--     Nenhuma página pública do sistema lê esta tabela (verificado em src/),
--     mas a intenção documentada na 004/014 era um catálogo público — daí
--     manter-se a leitura anónima, agora limitada às colunas de catálogo.
--
--  2. [MÉDIA — autorização] `listar_utilizadores_staff()` decidia o papel com
--     `coalesce(app_metadata, user_metadata, 'secretaria')`. `user_metadata` é
--     escrito pelo PRÓPRIO utilizador via auth.updateUser({ data: { papel }});
--     a migração 014 tirou este campo das decisões de autorização (`eh_admin`,
--     `eh_staff`) mas deixou-o aqui. Uma conta sem papel em app_metadata podia
--     declarar-se admin e aparecer como tal na lista da secretaria.
--
--  3. [BAIXA — informação] a mesma função não verificava o chamador: qualquer
--     conta autenticada — incluindo um formador — podia listar os emails da
--     secretaria e do administrador. Passa a exigir `eh_staff()`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo público de formadores sem dados pessoais
-- ---------------------------------------------------------------------------
revoke all on public.formadores from anon;
grant select (id, nome, especialidade, ativo) on public.formadores to anon;
-- A secretaria continua a ler a ficha completa (email/telefone) no painel:
-- `grant select` na tabela para `authenticated` mantém-se explícito aqui.
grant select on public.formadores to authenticated;

comment on table public.formadores is
  'Catálogo de formadores. `anon` lê apenas id/nome/especialidade/ativo (019); email e telefone ficam para `authenticated`.';

-- ---------------------------------------------------------------------------
-- 2. Papel do staff: só `app_metadata` (fonte que o cliente não escreve)
-- 3. Lista de contas staff: só quem é staff
-- ---------------------------------------------------------------------------
create or replace function public.listar_utilizadores_staff()
returns table (
  id uuid,
  email text,
  papel text,
  ultimo_login timestamptz,
  criado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         u.email::text,
         coalesce(nullif(u.raw_app_meta_data ->> 'papel', ''), 'secretaria') as papel,
         u.last_sign_in_at,
         u.created_at
    from auth.users u
   -- Só a secretaria/admin vê a lista (019). Sem sessão, `eh_staff()` é false.
   where public.eh_staff()
     -- Uma conta criada fora do painel (supabase.auth.admin) ainda não tem
     -- papel: fica como 'secretaria' para o admin a poder corrigir aqui. O que
     -- nunca conta é `user_metadata.papel`, que o próprio utilizador escreve.
     and coalesce(nullif(u.raw_app_meta_data ->> 'papel', ''), 'secretaria')
         in ('admin', 'secretaria')
   order by u.created_at;
$$;

comment on function public.listar_utilizadores_staff() is
  'Contas STAFF (admin/secretaria). Papel lido SÓ de raw_app_meta_data e chamador tem de ser staff (019).';

revoke all on function public.listar_utilizadores_staff() from public, anon;
grant execute on function public.listar_utilizadores_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Nota: `auth.users.raw_user_meta_data` continua a existir (é do Supabase Auth),
-- mas nenhuma decisão de autorização lhe toca. A consulta para confirmar que não
-- sobrou nenhum papel nesse campo está documentada em SECURITY.md.
-- ---------------------------------------------------------------------------
