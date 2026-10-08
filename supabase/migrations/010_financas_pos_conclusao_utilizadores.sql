-- ============================================================================
-- 010 — CÓDIGO FINANÇAS · MÁX 3 CURSOS · PÓS-CONCLUSÃO AUTOMÁTICA · UTILIZADORES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. CONFIGURAÇÃO: código de finanças + valores de certificado/faixa
-- ---------------------------------------------------------------------------
alter table public.config_instituicao
  add column if not exists codigo_financas text not null default 'FIN-2026',
  add column if not exists valor_certificado numeric(12,2) not null default 350,
  add column if not exists valor_faixa numeric(12,2) not null default 500;

-- ---------------------------------------------------------------------------
-- B. ALUNO EM VÁRIOS CURSOS: inscricao_id deixa de ser obrigatório (matrículas
--    extra sem inscrição própria) + identidade por BI
-- ---------------------------------------------------------------------------
alter table public.alunos_matriculados
  alter column inscricao_id drop not null;

alter table public.alunos_matriculados
  add column if not exists numero_bi text;

update public.alunos_matriculados am
   set numero_bi = i.numero_bi
  from public.inscricoes i
 where am.inscricao_id = i.id
   and am.numero_bi is null;

-- ---------------------------------------------------------------------------
-- C. LIMITE DE 3 CURSOS POR ALUNO (por BI), contando cursos activos
-- ---------------------------------------------------------------------------
create or replace function public.contar_cursos_activos(p_bi text, p_excluir uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct coalesce(t.curso_id, i.curso_id))
    from public.alunos_matriculados x
    left join public.turmas t on t.id = x.turma_id
    left join public.inscricoes i on i.id = x.inscricao_id
   where coalesce(x.numero_bi, i.numero_bi) = p_bi
     and x.estado_aluno = 'ativo'
     and (p_excluir is null or x.id <> p_excluir);
$$;

revoke all on function public.contar_cursos_activos(text, uuid) from public, anon;
grant execute on function public.contar_cursos_activos(text, uuid) to authenticated;

create or replace function public.validar_limite_cursos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bi text;
  v_total int;
  v_curso_novo uuid;
begin
  if tg_op = 'UPDATE' and new.estado_aluno <> 'ativo' then
    return new; -- trancar/concluir nunca ultrapassa o limite
  end if;

  v_bi := coalesce(new.numero_bi, (select i.numero_bi from public.inscricoes i where i.id = new.inscricao_id));
  if v_bi is null then return new; end if;

  v_curso_novo := coalesce(
    (select t2.curso_id from public.turmas t2 where t2.id = new.turma_id),
    (select i2.curso_id from public.inscricoes i2 where i2.id = new.inscricao_id));

  v_total := public.contar_cursos_activos(v_bi, new.id);
  -- o curso novo conta se o aluno ainda não o frequenta
  if not exists (
       select 1
         from public.alunos_matriculados x
         left join public.turmas t on t.id = x.turma_id
         left join public.inscricoes i on i.id = x.inscricao_id
        where coalesce(x.numero_bi, i.numero_bi) = v_bi
          and x.estado_aluno = 'ativo'
          and (new.id is null or x.id <> new.id)
          and coalesce(t.curso_id, i.curso_id) = v_curso_novo
     ) then
    v_total := v_total + 1;
  end if;

  if v_total > 3 then
    raise exception 'Limite de cursos atingido: cada aluno pode frequentar no máximo 3 cursos em simultâneo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_limite_cursos on public.alunos_matriculados;
create trigger trg_validar_limite_cursos
  before insert or update of turma_id, inscricao_id, estado_aluno, numero_bi on public.alunos_matriculados
  for each row execute function public.validar_limite_cursos();

-- ---------------------------------------------------------------------------
-- D. PÓS-CONCLUSÃO AUTOMÁTICA: certificado + faixa pendentes ao concluir
-- ---------------------------------------------------------------------------
do $$ begin
  create type estado_item_pos as enum ('pendente', 'emitido', 'entregue');
exception when duplicate_object then null; end $$;

create table if not exists public.pos_conclusao (
  id             uuid primary key default gen_random_uuid(),
  aluno_id       uuid not null references public.alunos_matriculados(id) on delete cascade,
  item           text not null check (item in ('certificado', 'faixa')),
  valor          numeric(12,2) not null default 0,
  estado         estado_item_pos not null default 'pendente',
  pago           boolean not null default false,
  data_entrega   date,
  criado_em      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (aluno_id, item)
);

create index if not exists idx_pos_conclusao_aluno on public.pos_conclusao (aluno_id);
create index if not exists idx_pos_conclusao_estado on public.pos_conclusao (estado);

create or replace function public.criar_pos_conclusao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cert numeric(12,2);
  v_faixa numeric(12,2);
begin
  if new.estado_aluno = 'concluido' and (tg_op = 'INSERT' or old.estado_aluno is distinct from 'concluido') then
    select ci.valor_certificado, ci.valor_faixa into v_cert, v_faixa
      from public.config_instituicao ci where ci.id = 1;

    insert into public.pos_conclusao (aluno_id, item, valor)
    values (new.id, 'certificado', coalesce(v_cert, 350))
    on conflict (aluno_id, item) do nothing;

    insert into public.pos_conclusao (aluno_id, item, valor)
    values (new.id, 'faixa', coalesce(v_faixa, 500))
    on conflict (aluno_id, item) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_criar_pos_conclusao on public.alunos_matriculados;
create trigger trg_criar_pos_conclusao
  after insert or update of estado_aluno on public.alunos_matriculados
  for each row execute function public.criar_pos_conclusao();

-- Pendentes retroactivos para quem já consta como concluído
insert into public.pos_conclusao (aluno_id, item, valor)
select am.id, x.item,
       case x.item when 'certificado' then ci.valor_certificado else ci.valor_faixa end
  from public.alunos_matriculados am
  cross join (values ('certificado'), ('faixa')) as x(item)
  cross join public.config_instituicao ci
 where am.estado_aluno = 'concluido'
   and ci.id = 1
on conflict (aluno_id, item) do nothing;

-- ---------------------------------------------------------------------------
-- E. COBRANÇA AUTOMÁTICA (pg_cron a 30/31 · fallback: RPC manual)
--    Cada aluno activo gera 1 cobrança por curso que frequenta.
-- ---------------------------------------------------------------------------
create or replace function public.gerar_cobrancas_automaticas()
returns table (gerados int, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_criados int := 0;
  v_mes date := date_trunc('month', now())::date;
  r record;
  v_valor numeric(12,2);
begin
  for r in
    select am.id as aluno_id, coalesce(t.curso_id, i.curso_id) as curso_id
      from public.alunos_matriculados am
      left join public.turmas t on t.id = am.turma_id
      left join public.inscricoes i on i.id = am.inscricao_id
     where am.estado_aluno = 'ativo'
       and coalesce(t.curso_id, i.curso_id) is not null
       and not exists (
             select 1 from public.pagamentos p
              where p.aluno_id = r.aluno_id
                and p.mes_referencia = v_mes)
  loop
    select c.valor_mensalidade into v_valor
      from public.config_pagamentos c
     where c.curso_id = r.curso_id
       and c.ano_lectivo = extract(year from v_mes)::int;

    if found then
      insert into public.pagamentos (aluno_id, mes_referencia, valor, estado)
      values (r.aluno_id, v_mes, v_valor, 'pendente');
      v_criados := v_criados + 1;
    end if;
  end loop;

  return query select v_criados, format('Cobranças geradas: %s.', v_criados)::text;
end;
$$;

revoke all on function public.gerar_cobrancas_automaticas() from public, anon;
grant execute on function public.gerar_cobrancas_automaticas() to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('cobrancas-mensais')
      where exists (select 1 from cron.job where jobname = 'cobrancas-mensais');
    perform cron.schedule('cobrancas-mensais', '0 6 30,31 * *',
      'select public.gerar_cobrancas_automaticas()');
  end if;
exception when others then
  null; -- sem pg_cron: a cobrança fica manual (RPC acessível ao staff)
end $$;

-- ---------------------------------------------------------------------------
-- F. UTILIZADORES STAFF (só admin): listar, criar, redefinir password, papel
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
security definer
set search_path = public
as $$
  select u.id,
         u.email::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'papel', ''),
           nullif(u.raw_app_meta_data ->> 'papel', ''),
           'secretaria') as papel,
         u.last_sign_in_at,
         u.created_at
    from auth.users u
   order by u.created_at;
$$;

revoke all on function public.listar_utilizadores_staff() from public, anon;
grant execute on function public.listar_utilizadores_staff() to authenticated;

create or replace function public.criar_utilizador_staff(p_email text, p_password text, p_papel text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := gen_random_uuid();
begin
  if coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
       '') <> 'admin' then
    return query select false, 'Apenas o admin pode criar utilizadores.'::text;
    return;
  end if;
  if p_papel not in ('secretaria', 'admin') then
    return query select false, 'Papel inválido (secretaria ou admin).'::text;
    return;
  end if;
  if length(coalesce(p_password, '')) < 6 then
    return query select false, 'A password deve ter pelo menos 6 caracteres.'::text;
    return;
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email);
  if found then
    return query select false, 'Já existe um utilizador com este email.'::text;
    return;
  end if;

  v_uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(p_email), crypt(p_password, gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('papel', p_papel),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    provider_id, provider, user_id, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid::text, 'email', v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(p_email), 'email_verified', false),
    now(), now(), now()
  );

  return query select true, format('Utilizador %s criado com papel %s.', lower(p_email), p_papel)::text;
end;
$$;

revoke all on function public.criar_utilizador_staff(text, text, text) from public, anon;
grant execute on function public.criar_utilizador_staff(text, text, text) to authenticated;

create or replace function public.redefinir_password_staff(p_user_id uuid, p_nova_password text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
       '') <> 'admin' then
    return query select false, 'Apenas o admin pode redefinir passwords.'::text;
    return;
  end if;
  if length(coalesce(p_nova_password, '')) < 6 then
    return query select false, 'A password deve ter pelo menos 6 caracteres.'::text;
    return;
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_nova_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, 'Password redefinida com sucesso.'::text;
end;
$$;

revoke all on function public.redefinir_password_staff(uuid, text) from public, anon;
grant execute on function public.redefinir_password_staff(uuid, text) to authenticated;

create or replace function public.alterar_papel_staff(p_user_id uuid, p_papel text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'user_metadata' ->> 'papel', ''),
       nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
       '') <> 'admin' then
    return query select false, 'Apenas o admin pode alterar papéis.'::text;
    return;
  end if;
  if p_papel not in ('secretaria', 'admin') then
    return query select false, 'Papel inválido.'::text;
    return;
  end if;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('papel', p_papel),
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, format('Papel alterado para %s.', p_papel)::text;
end;
$$;

revoke all on function public.alterar_papel_staff(uuid, text) from public, anon;
grant execute on function public.alterar_papel_staff(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- G. RLS + grants das novas tabelas
-- ---------------------------------------------------------------------------
alter table public.pos_conclusao enable row level security;

drop policy if exists "pos_conclusao_staff_all" on public.pos_conclusao;
create policy "pos_conclusao_staff_all"
  on public.pos_conclusao for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

grant select, insert, update, delete on public.pos_conclusao to authenticated;

drop trigger if exists trg_pos_conclusao_updated on public.pos_conclusao;
create trigger trg_pos_conclusao_updated
  before update on public.pos_conclusao
  for each row execute function public.set_updated_at();
