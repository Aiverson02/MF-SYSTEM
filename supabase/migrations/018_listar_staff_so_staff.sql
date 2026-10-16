-- ============================================================================
-- 018 — listar_utilizadores_staff só devolve contas STAFF
-- ============================================================================
-- Bug encontrado na validação contra a base de dados real (2026-10-15): a RPC
-- devolvia TODAS as contas de auth.users, incluindo as contas de FORMADOR
-- criadas pela 016. No painel Utilizadores isso tinha dois efeitos:
--
--   1. os formadores apareciam na tabela "Contas staff" com o papel mal
--      interpretado (a UI mostra "Secretaria" para tudo o que não é admin);
--   2. pior: o <select> de papel estava activo para essas linhas, permitindo
--      que um admin convertesse acidentalmente uma conta de formador em
--      staff (ou em administrador) — dando acesso de secretaria a quem só
--      devia lançar notas.
--
-- Os formadores já têm a sua própria tabela ("Contas dos formadores"), que
-- lê de `public.formadores` — daí filtrar aqui em vez de mostrar tudo.
-- ============================================================================

create or replace function public.listar_utilizadores_staff()
returns table (id uuid, email text, papel text, ultimo_login timestamptz, criado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with contas as (
    select u.id,
           u.email::text as email,
           coalesce(nullif(u.raw_app_meta_data  ->> 'papel', ''),
                    nullif(u.raw_user_meta_data ->> 'papel', ''),
                    'secretaria') as papel,
           u.last_sign_in_at,
           u.created_at
      from auth.users u
  )
  select id,
         email,
         papel,
         last_sign_in_at as ultimo_login,
         created_at      as criado_em
    from contas
   where papel in ('admin', 'secretaria')
   order by created_at;
$$;

comment on function public.listar_utilizadores_staff() is
  'Lista as contas STAFF (admin/secretaria). Contas de formador ficam de fora — vê-se em listar_formadores_contas. (018)';

revoke all on function public.listar_utilizadores_staff() from public, anon;
grant execute on function public.listar_utilizadores_staff() to authenticated;
