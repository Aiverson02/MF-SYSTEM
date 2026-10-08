-- ============================================================================
-- 013 — SEGURANÇA ADMIN: papel admin, código de finanças com hash, preços, RLS
-- ============================================================================
-- 1) eh_admin(): papel 'admin' a partir do JWT (user/app metadata).
--    (Compatível com migrations 010/011/012, que já usavam este caminho.)
-- 2) financas_seguranca: tabela privada com HASH bcrypt do código de finanças.
--    Sem policies => nenhum acesso via API REST (nem admin, nem anon).
--    RPCs: definir_codigo_financas (admin) · verificar_codigo_financas (staff)
--          codigo_financas_definido (admin; boolean, nunca revela o código).
-- 3) config_instituicao: leitura mantém-se (site público); escrita admin-only.
--    codigo_financas (legado, texto claro) fica null e deixa de ser usado.
-- 4) config_pagamentos (preços por curso): leitura staff; escrita admin-only.
-- ============================================================================

-- 1. Papel admin a partir do JWT ---------------------------------------------
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
           nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
           '') = 'admin';
$$;

revoke all on function public.eh_admin() from public, anon;
grant execute on function public.eh_admin() to authenticated;

-- 2. Código de finanças: tabela privada + RPCs --------------------------------
create table if not exists public.financas_seguranca (
  id          int primary key default 1 check (id = 1),
  codigo_hash text not null default '',
  updated_at  timestamptz not null default now()
);

insert into public.financas_seguranca (id) values (1) on conflict (id) do nothing;

alter table public.financas_seguranca enable row level security;
alter table public.financas_seguranca force row level security;
-- Sem policies: sem leitura nem escrita via API. Acesso só pelas RPCs abaixo.

revoke all on public.financas_seguranca from anon, authenticated;

-- 2.1 Definir código (admin). Guarda apenas o hash bcrypt — texto claro nunca é armazenado.
create or replace function public.definir_codigo_financas(p_codigo text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.eh_admin() then
    return query select false, 'Apenas o admin pode definir o código de finanças.'::text;
    return;
  end if;
  if length(btrim(coalesce(p_codigo, ''))) < 4 then
    return query select false, 'O código deve ter pelo menos 4 caracteres.'::text;
    return;
  end if;
  update public.financas_seguranca
     set codigo_hash = extensions.crypt(btrim(p_codigo), extensions.gen_salt('bf')),
         updated_at  = now()
   where id = 1;
  return query select true, 'Código de finanças actualizado.'::text;
end;
$$;

revoke all on function public.definir_codigo_financas(text) from public, anon;
grant execute on function public.definir_codigo_financas(text) to authenticated;

-- 2.2 Verificar código (staff autenticado). Compara hash; nunca devolve o código.
create or replace function public.verificar_codigo_financas(p_codigo text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select public.eh_staff()
     and exists (
           select 1
             from public.financas_seguranca
            where id = 1
              and codigo_hash <> ''
              and codigo_hash = extensions.crypt(btrim(p_codigo), codigo_hash));
$$;

revoke all on function public.verificar_codigo_financas(text) from public, anon;
grant execute on function public.verificar_codigo_financas(text) to authenticated;

-- 2.3 Admin pode saber se já existe código definido (boolean, sem revelar nada).
create or replace function public.codigo_financas_definido()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.financas_seguranca where id = 1 and codigo_hash <> '');
$$;

revoke all on function public.codigo_financas_definido() from public, anon;
grant execute on function public.codigo_financas_definido() to authenticated;

-- 2.4 Código legado em texto claro: remove a obrigatoriedade e limpa o valor
--     (coluna mantém-se por compatibilidade de tipo, sempre null).
alter table public.config_instituicao
  alter column codigo_financas drop not null;
update public.config_instituicao set codigo_financas = null where codigo_financas is not null;

-- 3. config_instituicao: escrita admin-only ------------------------------------
-- (upsert do cliente = INSERT ... ON CONFLICT UPDATE; por isso INSERT e UPDATE
--  têm políticas admin em vez de revoke — revoke quebraria o upsert do admin.)
drop policy if exists "config_inst_insert_staff" on public.config_instituicao;
drop policy if exists "config_inst_update_staff" on public.config_instituicao;
create policy "config_inst_insert_admin"
  on public.config_instituicao for insert to authenticated
  with check (public.eh_admin());
create policy "config_inst_update_admin"
  on public.config_instituicao for update to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());
-- DELETE não é usado pela aplicação (linha única id=1):
revoke delete on public.config_instituicao from anon, authenticated;

-- 4. config_pagamentos (preços por curso): leitura staff, escrita admin --------
drop policy if exists "config_pag_staff_all" on public.config_pagamentos;
create policy "config_pag_select_staff"
  on public.config_pagamentos for select to authenticated
  using (public.eh_staff());
create policy "config_pag_write_admin"
  on public.config_pagamentos for all to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());
