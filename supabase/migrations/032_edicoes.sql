-- ============================================================================
-- 032 — Edições de três meses
-- ============================================================================
-- A instituição trabalha por edições de três meses. Num ano há quatro
-- (Jan–Mar, Abr–Jun, Jul–Set, Out–Dez) e a numeração é contínua desde a
-- primeira edição da instituição:
--
--   Jul–Set/2026 = edição 1      Abr–Jun/2027 = edição 4
--   Out–Dez/2026 = edição 2      Jul–Set/2027 = edição 5
--   Jan–Mar/2027 = edição 3      Out–Dez/2027 = edição 6
--
-- A data de arranque fica em `config_instituicao.inicio_edicoes` (editável);
-- as edições são geradas a partir dela, por isso a passagem de edição é
-- automática — ninguém tem de abrir a edição seguinte à mão.
--
-- Turmas e inscrições passam a guardar `edicao_id`, e o painel filtra por ele.
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Data de arranque das edições
-- ---------------------------------------------------------------------------
alter table public.config_instituicao
  add column if not exists inicio_edicoes date not null default date '2026-07-01';

comment on column public.config_instituicao.inicio_edicoes is
  'Primeiro dia da edição 1. As edições seguintes são blocos de 3 meses a partir daqui.';

-- ---------------------------------------------------------------------------
-- 2. Tabela de edições
-- ---------------------------------------------------------------------------
create table if not exists public.edicoes (
  id         uuid primary key default gen_random_uuid(),
  numero     integer not null unique,
  inicio     date not null unique,
  fim        date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint edicoes_periodo check (fim > inicio)
);

comment on table public.edicoes is
  'Edições de três meses, numeradas desde a primeira (inicio_edicoes).';

alter table public.edicoes enable row level security;

drop policy if exists "edicoes_leitura" on public.edicoes;
create policy "edicoes_leitura"
  on public.edicoes for select
  to anon, authenticated
  using (true);

drop policy if exists "edicoes_escrita_admin" on public.edicoes;
create policy "edicoes_escrita_admin"
  on public.edicoes for all
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

grant select on public.edicoes to anon, authenticated;
grant select, insert, update, delete on public.edicoes to authenticated;

drop trigger if exists trg_set_updated_at on public.edicoes;
create trigger trg_set_updated_at before update on public.edicoes
  for each row execute function public.set_updated_at();

-- Gera (idempotentemente) as edições desde o arranque até à data pedida.
create or replace function public.sincronizar_edicoes(p_ate date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio date;
  v_ate    date := coalesce(p_ate, (current_date + interval '12 months')::date);
  v_numero integer := 0;
  v_inseridas integer := 0;
begin
  select coalesce(c.inicio_edicoes, date '2026-07-01')
    into v_inicio
    from public.config_instituicao c
   where c.id = 1;

  v_inicio := coalesce(v_inicio, date '2026-07-01');

  while v_inicio <= v_ate loop
    v_numero := v_numero + 1;
    insert into public.edicoes (numero, inicio, fim)
    values (v_numero, v_inicio, (v_inicio + interval '3 months' - interval '1 day')::date)
    on conflict (inicio) do update
      set fim = excluded.fim,
          numero = excluded.numero;
    if found then v_inseridas := v_inseridas + 1; end if;
    v_inicio := (v_inicio + interval '3 months')::date;
  end loop;

  return v_inseridas;
end;
$$;

revoke all on function public.sincronizar_edicoes(date) from public, anon, authenticated;
grant execute on function public.sincronizar_edicoes(date) to authenticated;

-- Primeira carga: cobre o passado e os próximos anos.
select public.sincronizar_edicoes((current_date + interval '5 years')::date);

-- Edição que contém uma data (null se não houver).
create or replace function public.edicao_por_data(p_data date)
returns public.edicoes
language sql
stable
security definer
set search_path = public
as $$
  select e.*
    from public.edicoes e
   where p_data between e.inicio and e.fim
   order by e.inicio desc
   limit 1;
$$;

-- Edição corrente: a que contém o dia de hoje.
create or replace function public.edicao_corrente()
returns public.edicoes
language sql
stable
security definer
set search_path = public
as $$
  select * from public.edicao_por_data(current_date);
$$;

revoke all on function public.edicao_por_data(date) from public, anon, authenticated;
revoke all on function public.edicao_corrente() from public, anon, authenticated;
grant execute on function public.edicao_por_data(date) to authenticated;
grant execute on function public.edicao_corrente() to authenticated;

-- Lista para o selector do painel (mais recente primeiro).
create or replace function public.listar_edicoes()
returns table (
  id     uuid,
  numero integer,
  inicio date,
  fim    date,
  ano    integer,
  atual  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.numero,
         e.inicio,
         e.fim,
         extract(year from e.inicio)::int as ano,
         current_date between e.inicio and e.fim as atual
    from public.edicoes e
   order by e.inicio desc;
$$;

revoke all on function public.listar_edicoes() from public, anon, authenticated;
grant execute on function public.listar_edicoes() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Turmas e inscrições passam a ter edição
-- ---------------------------------------------------------------------------
alter table public.turmas
  add column if not exists edicao_id uuid references public.edicoes(id) on delete set null;

alter table public.inscricoes
  add column if not exists edicao_id uuid references public.edicoes(id) on delete set null;

create index if not exists idx_turmas_edicao     on public.turmas (edicao_id);
create index if not exists idx_inscricoes_edicao on public.inscricoes (edicao_id);

comment on column public.turmas.edicao_id is
  'Edição a que a turma pertence (3 meses). Preenchida a partir do ano lectivo.';
comment on column public.inscricoes.edicao_id is
  'Edição da candidatura: a da turma escolhida ou a edição corrente na submissão.';

-- Edição a usar para um ano lectivo: a que contém 1 de Janeiro desse ano; se o
-- ano ainda não tiver edições a começar em Janeiro, a primeira desse ano.
create or replace function public.edicao_do_ano(p_ano integer)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- Ano em curso: a turma pertence à edição que decorre hoje.
    (select e.id from public.edicoes e
      where p_ano = extract(year from current_date)::int
        and current_date between e.inicio and e.fim
      limit 1),
    -- Outros anos: a primeira edição que cobre esse ano.
    (select e.id from public.edicoes e
      where p_ano between extract(year from e.inicio)::int
                     and extract(year from e.fim)::int
      order by e.inicio
      limit 1),
    (select e.id from public.edicoes e
      where extract(year from e.inicio)::int = p_ano
      order by e.inicio
      limit 1)
  );
$$;

revoke all on function public.edicao_do_ano(integer) from public, anon, authenticated;
grant execute on function public.edicao_do_ano(integer) to authenticated;

-- Turma: sem edição explícita, deriva do ano lectivo.
create or replace function public.definir_edicao_turma()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.edicao_id is null or (tg_op = 'UPDATE' and new.ano_lectivo is distinct from old.ano_lectivo) then
    new.edicao_id := public.edicao_do_ano(new.ano_lectivo);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_definir_edicao_turma on public.turmas;
create trigger trg_definir_edicao_turma
  before insert or update of ano_lectivo, edicao_id on public.turmas
  for each row execute function public.definir_edicao_turma();

-- Inscrição: a edição da turma ou, sem turma, a edição corrente.
create or replace function public.definir_edicao_inscricao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.edicao_id is null then
    if new.turma_id is not null then
      select t.edicao_id into new.edicao_id from public.turmas t where t.id = new.turma_id;
    end if;
    if new.edicao_id is null then
      select e.id into new.edicao_id
        from public.edicoes e
       where current_date between e.inicio and e.fim
       limit 1;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_definir_edicao_inscricao on public.inscricoes;
create trigger trg_definir_edicao_inscricao
  before insert or update of turma_id, edicao_id on public.inscricoes
  for each row execute function public.definir_edicao_inscricao();

-- Backfill do que já existe: as turmas do ano em curso são as da edição que
-- decorre agora (a secretaria está a trabalhar nelas), as restantes derivam
-- do ano lectivo.
update public.turmas
   set edicao_id = (select e.id from public.edicoes e
                     where current_date between e.inicio and e.fim
                     limit 1)
 where ano_lectivo = extract(year from current_date)::int;

update public.turmas
   set edicao_id = public.edicao_do_ano(ano_lectivo)
 where edicao_id is null;

update public.inscricoes i
   set edicao_id = coalesce(t.edicao_id, public.edicao_do_ano(extract(year from i.created_at)::int))
  from public.turmas t
 where i.turma_id = t.id
   and i.edicao_id is null;

update public.inscricoes i
   set edicao_id = public.edicao_do_ano(extract(year from i.created_at)::int)
 where i.edicao_id is null;

-- ---------------------------------------------------------------------------
-- 4. Catálogo público: edição corrente a sério
-- ---------------------------------------------------------------------------
create or replace function public.catalogo_publico()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with corrente as (
    select * from public.edicao_por_data(current_date)
  )
  select jsonb_build_object(
    'instituicao', coalesce(
      (select jsonb_build_object(
                'nome',     coalesce(nullif(btrim(ci.nome), ''), 'Associação de Formação Profissional Moz Future'),
                'telefone', ci.telefone,
                'email',    ci.email,
                'endereco', ci.endereco,
                'logo_url', ci.logo_url)
         from public.config_instituicao ci
        where ci.id = 1),
      jsonb_build_object('nome', 'Associação de Formação Profissional Moz Future')
    ),
    'edicao',       (select numero from corrente),
    'edicao_ano',   (select extract(year from inicio)::int from corrente),
    'edicao_inicio',(select inicio from corrente),
    'edicao_fim',   (select fim from corrente),
    'locais', coalesce(
      (select jsonb_agg(
                jsonb_build_object('id', l.id, 'nome', l.nome, 'referencia', l.referencia)
                order by l.ordem, l.nome)
         from public.locais l
        where l.ativo),
      '[]'::jsonb
    ),
    'cursos', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id',         c.id,
                  'nome',       c.nome,
                  'codigo',     c.codigo,
                  'duracao',    c.duracao,
                  'descricao',  c.descricao,
                  'mensalidade', (
                    select p.valor_mensalidade
                      from public.config_pagamentos p
                     where p.curso_id = c.id
                       and p.ano_lectivo = (select extract(year from inicio)::int from corrente)
                  ),
                  'turnos', coalesce(
                    (select jsonb_agg(
                              jsonb_build_object(
                                'turno',    t.turno,
                                'turma_id', t.id,
                                'vagas',    greatest(t.limite_vagas - t.vagas_preenchidas, 0)
                              )
                              order by case t.turno
                                         when 'manha' then 1
                                         when 'tarde' then 2
                                         else 3
                                       end)
                       from public.turmas t
                      where t.curso_id = c.id
                        and t.edicao_id = (select id from corrente)),
                    '[]'::jsonb
                  )
                )
                order by c.nome)
         from public.cursos c
        where c.ativo),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.catalogo_publico() from public, authenticated;
grant execute on function public.catalogo_publico() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Submissão pública: turma e edição correntes
-- ---------------------------------------------------------------------------
create or replace function public.submeter_inscricao_publica(
  p_nome_completo      text default null,
  p_numero_bi          text default null,
  p_data_nascimento    date default null,
  p_genero             text default null,
  p_email              text default null,
  p_telefone_whatsapp  text default null,
  p_curso_id           uuid default null,
  p_turno_pretendido   public.turno default null
)
returns table (numero_inscricao text, inscricao_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_seq      bigint;
  v_ano      integer := extract(year from now())::int;
  v_numero   text;
  v_origem   text;
  v_bi       text := nullif(upper(btrim(coalesce(p_numero_bi, ''))), '');
  v_nome     text := upper(btrim(coalesce(p_nome_completo, '')));
  v_tel      text := regexp_replace(coalesce(p_telefone_whatsapp, ''), '\D', '', 'g');
  v_activas  integer;
  v_edicao_id uuid;
  v_turma    uuid;
begin
  if length(coalesce(p_nome_completo, '')) > 200
     or length(coalesce(p_numero_bi, '')) > 32
     or length(coalesce(p_telefone_whatsapp, '')) > 32
     or length(coalesce(p_email, '')) > 254
     or (p_genero is not null and length(p_genero) > 16)
     or (p_data_nascimento is not null
         and (p_data_nascimento > current_date or p_data_nascimento < date '1900-01-01')) then
    return query select null::text, null::uuid;
    return;
  end if;

  if v_nome = ''
     or nullif(btrim(p_telefone_whatsapp), '') is null
     or p_curso_id is null
     or p_turno_pretendido is null then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Limite de 3 cursos activos por aluno — identidade: BI OU nome+celular.
  select count(distinct i.curso_id)
    into v_activas
    from public.inscricoes i
   where i.estado <> 'rejeitado'
     and (
           (v_bi is not null and upper(btrim(i.numero_bi)) = v_bi)
        or (v_tel <> ''
            and upper(btrim(i.nome_completo)) = v_nome
            and regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel)
         );

  if v_activas >= 3 then
    raise exception
      'Limite de inscrições atingido: cada aluno pode inscrever-se no máximo 3 cursos em simultâneo.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
      from public.inscricoes i
     where i.estado <> 'rejeitado'
       and i.curso_id = p_curso_id
       and (
             (v_bi is not null and upper(btrim(i.numero_bi)) = v_bi)
          or (v_tel <> ''
              and v_nome <> ''
              and upper(btrim(i.nome_completo)) = v_nome
              and regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel)
           )
  ) then
    raise exception
      'Já existe uma inscrição activa deste aluno para este curso.'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.cursos c where c.id = p_curso_id and c.ativo) then
    return query select null::text, null::uuid;
    return;
  end if;

  select e.id into v_edicao_id
    from public.edicoes e
   where current_date between e.inicio and e.fim
   order by e.inicio desc
   limit 1;

  if v_edicao_id is not null then
    select t.id
      into v_turma
      from public.turmas t
     where t.curso_id = p_curso_id
       and t.turno = p_turno_pretendido
       and t.edicao_id = v_edicao_id
     order by (t.vagas_preenchidas < t.limite_vagas) desc, t.nome_turma
     limit 1;
  end if;

  perform pg_advisory_xact_lock(hashtext('gerar_numero_inscricao'));

  select coalesce(
           max(nullif(regexp_replace(i.numero_inscricao, '^INS-[0-9]{4}-', ''), '')::bigint),
           0
         ) + 1
    into v_seq
    from public.inscricoes i
   where i.numero_inscricao like 'INS-' || v_ano || '-%';

  v_numero := format('INS-%s-%s', v_ano, lpad(v_seq::text, 6, '0'));

  v_origem := case when public.eh_staff() then 'presencial' else 'online' end;

  insert into public.inscricoes
    (numero_inscricao, nome_completo, numero_bi, data_nascimento, genero,
     email, telefone_whatsapp, curso_id, turno_pretendido, turma_id, edicao_id,
     estado, origem)
  values
    (v_numero, btrim(p_nome_completo), v_bi, p_data_nascimento, nullif(btrim(p_genero), ''),
     nullif(btrim(p_email), ''), btrim(p_telefone_whatsapp), p_curso_id, p_turno_pretendido,
     v_turma, v_edicao_id, 'pendente', v_origem)
  returning id into v_id;

  return query select v_numero, v_id;
end;
$$;

revoke all on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  from public, authenticated;
grant execute on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A edição corrente também decide a turma do "Validar todas"
-- ---------------------------------------------------------------------------
-- `validarTodasInscricoes` usa a turma do curso/turno com vagas. Acrescenta-se
-- a edição para nunca matricular numa turma de uma edição antiga.
create or replace function public.turmas_com_vagas_por_curso()
returns table (curso_id uuid, turno public.turno, turma_id uuid, vagas integer)
language sql
stable
security definer
set search_path = public
as $$
  select t.curso_id,
         t.turno,
         t.id,
         greatest(t.limite_vagas - t.vagas_preenchidas, 0)
    from public.turmas t
   where t.edicao_id = (select e.id from public.edicao_por_data(current_date) e)
   order by t.curso_id, t.turno, t.nome_turma;
$$;

revoke all on function public.turmas_com_vagas_por_curso() from public, anon, authenticated;
grant execute on function public.turmas_com_vagas_por_curso() to authenticated;
