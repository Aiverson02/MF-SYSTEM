-- ============================================================================
-- SISTEMA DE GESTÃO DE INSCRIÇÕES ACADÉMICAS — Centro de Formação
-- Banco de dados: PostgreSQL (Supabase)
-- ----------------------------------------------------------------------------
-- Executar no SQL Editor do Supabase (Dashboard) ou via `supabase db push`.
-- Seguro para re-executar: usa IF NOT EXISTS / DROP ... IF EXISTS / DO blocks.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSÕES
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS
-- ----------------------------------------------------------------------------
do $$ begin
  create type turno as enum ('manha', 'tarde', 'pos_laboral');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_inscricao as enum
    ('pendente', 'em_analise', 'aprovado', 'rejeitado', 'com_pendencia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_documento_enum as enum
    ('bi', 'foto_passe', 'certificado', 'comprovativo_pagamento');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_aluno_enum as enum ('ativo', 'trancado', 'concluido');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. TABELAS
-- ----------------------------------------------------------------------------

-- 2.1 CURSOS -------------------------------------------------------------------
create table if not exists public.cursos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  codigo      text not null unique,
  duracao     text,
  descricao   text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.cursos is 'Catálogo de cursos/formações oferecidos pelo centro.';
comment on column public.cursos.duracao is 'Duração em texto livre (ex.: "6 meses", "120 horas").';

-- 2.2 TURMAS -------------------------------------------------------------------
create table if not exists public.turmas (
  id                uuid primary key default gen_random_uuid(),
  curso_id          uuid not null references public.cursos(id) on delete restrict,
  nome_turma        text not null,
  turno             turno not null,
  limite_vagas      integer not null default 0 check (limite_vagas >= 0),
  vagas_preenchidas integer not null default 0 check (vagas_preenchidas >= 0),
  ano_lectivo       integer not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint turmas_vagas_check check (vagas_preenchidas <= limite_vagas),
  constraint turmas_unicas unique (curso_id, nome_turma, turno, ano_lectivo)
);

comment on table public.turmas is 'Turmas de um curso, por turno e ano lectivo.';

-- 2.3 INSCRIÇÕES ----------------------------------------------------------------
create table if not exists public.inscricoes (
  id                uuid primary key default gen_random_uuid(),
  numero_inscricao  text not null unique,
  nome_completo     text not null,
  numero_bi         text not null,
  data_nascimento   date not null,
  genero            text,
  email             text,
  telefone_whatsapp text not null,
  curso_id          uuid not null references public.cursos(id) on delete restrict,
  turno_pretendido  turno not null,
  estado            estado_inscricao not null default 'pendente',
  motivo_rejeicao   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint inscricoes_email_formato check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint inscricoes_rejeicao check (
    (estado = 'rejeitado' and motivo_rejeicao is not null) or
    (estado <> 'rejeitado')
  )
);

comment on table public.inscricoes is 'Candidaturas submetidas pelo público (anon) e geridas pela secretaria.';
comment on column public.inscricoes.numero_inscricao is 'Código único gerado automaticamente, ex.: INS-2026-000123.';

-- 2.4 DOCUMENTOS DE INSCRIÇÃO ----------------------------------------------------
create table if not exists public.documentos_inscricao (
  id               uuid primary key default gen_random_uuid(),
  inscricao_id     uuid not null references public.inscricoes(id) on delete cascade,
  tipo_documento   tipo_documento_enum not null,
  url_ficheiro     text not null,
  estado_validacao boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Sem UNIQUE (inscricao_id, tipo_documento): permite reenvio de documento corrigido.
);

comment on table public.documentos_inscricao is 'Ficheiros anexados a uma inscrição (BI, foto, certificado, comprovativo).';

-- 2.5 ALUNOS MATRICULADOS ----------------------------------------------------------
create table if not exists public.alunos_matriculados (
  id               uuid primary key default gen_random_uuid(),
  inscricao_id     uuid not null unique references public.inscricoes(id) on delete cascade,
  numero_estudante text not null unique,
  turma_id         uuid not null references public.turmas(id) on delete restrict,
  data_matricula   date not null default current_date,
  estado_aluno     estado_aluno_enum not null default 'ativo',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.alunos_matriculados is 'Alunos efectivamente matriculados (1 por inscrição aprovada).';

-- ----------------------------------------------------------------------------
-- 3. FUNÇÕES / TRIGGERS
-- ----------------------------------------------------------------------------

-- 3.1 updated_at automático ------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['cursos','turmas','inscricoes','documentos_inscricao','alunos_matriculados']
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 3.2 Geração automática do numero_inscricao (INS-<ano>-<sequencial>) ------------
-- Usa advisory lock para evitar colisões em inscrições concorrentes.
-- Formato: INS-<ano>-<sequencial 6 dígitos>, ex.: INS-2026-000123
create or replace function public.gerar_numero_inscricao()
returns trigger
language plpgsql
as $$
declare
  ano int := extract(year from now())::int;
  seq bigint;
begin
  if coalesce(new.numero_inscricao, '') = '' then
    perform pg_advisory_xact_lock(hashtext('gerar_numero_inscricao'));

    select coalesce(
             max(nullif(regexp_replace(numero_inscricao, '^INS-[0-9]{4}-', ''), '')::bigint),
             0
           ) + 1
      into seq
      from public.inscricoes
     where numero_inscricao like 'INS-' || ano || '-%';

    new.numero_inscricao := format('INS-%s-%s', ano, lpad(seq::text, 6, '0'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gerar_numero_inscricao on public.inscricoes;
create trigger trg_gerar_numero_inscricao
  before insert on public.inscricoes
  for each row execute function public.gerar_numero_inscricao();

-- 3.3 Controlo automático de vagas da turma ----------------------------------------
create or replace function public.atualizar_vagas_turma()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    update public.turmas
       set vagas_preenchidas = vagas_preenchidas + 1
     where id = new.turma_id;
  elsif (tg_op = 'UPDATE') then
    if old.turma_id is distinct from new.turma_id then
      update public.turmas set vagas_preenchidas = greatest(vagas_preenchidas - 1, 0) where id = old.turma_id;
      update public.turmas set vagas_preenchidas = vagas_preenchidas + 1     where id = new.turma_id;
    end if;
  elsif (tg_op = 'DELETE') then
    update public.turmas
       set vagas_preenchidas = greatest(vagas_preenchidas - 1, 0)
     where id = old.turma_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_atualizar_vagas on public.alunos_matriculados;
create trigger trg_atualizar_vagas
  after insert or update of turma_id or delete on public.alunos_matriculados
  for each row execute function public.atualizar_vagas_turma();

-- ----------------------------------------------------------------------------
-- 4. RLS (ROW LEVEL SECURITY)
-- ----------------------------------------------------------------------------

-- 4.1 Helper: o utilizador atual tem papel de secretaria/admin? ----------------------
-- Padrão Supabase: lê o claim do JWT do utilizador autenticado.
-- Configure em auth.users -> raw_user_meta_data (ou app_metadata):
--   { "papel": "secretaria" }   ou   { "papel": "admin" }
-- (também aceita o claim 'role' do JWT para compatibilidade)
create or replace function public.eh_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    auth.uid() is not null
    and coalesce(
          nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''),
          nullif(auth.jwt() -> 'raw_user_meta_data' ->> 'papel', ''),
          nullif(auth.jwt() ->> 'papel', '')
        ) in ('secretaria', 'admin')
  );
$$;

revoke all on function public.eh_staff() from public;
grant execute on function public.eh_staff() to authenticated;

-- 4.2 Habilitar RLS em todas as tabelas ------------------------------------------
alter table public.cursos                enable row level security;
alter table public.turmas                enable row level security;
alter table public.inscricoes            enable row level security;
alter table public.documentos_inscricao  enable row level security;
alter table public.alunos_matriculados   enable row level security;

-- 4.3 Limpar políticas anteriores (idempotência) -----------------------------------
drop policy if exists "cursos_leitura_publica"   on public.cursos;
drop policy if exists "cursos_escrita_staff"     on public.cursos;
drop policy if exists "turmas_leitura_publica"   on public.turmas;
drop policy if exists "turmas_escrita_staff"     on public.turmas;
drop policy if exists "inscricoes_anon_insert"   on public.inscricoes;
drop policy if exists "inscricoes_select_staff"  on public.inscricoes;
drop policy if exists "inscricoes_update_staff"  on public.inscricoes;
drop policy if exists "inscricoes_delete_staff"  on public.inscricoes;
drop policy if exists "documentos_anon_insert"   on public.documentos_inscricao;
drop policy if exists "documentos_select_staff"  on public.documentos_inscricao;
drop policy if exists "documentos_update_staff"  on public.documentos_inscricao;
drop policy if exists "documentos_delete_staff"  on public.documentos_inscricao;
drop policy if exists "alunos_select_staff"      on public.alunos_matriculados;
drop policy if exists "alunos_insert_staff"      on public.alunos_matriculados;
drop policy if exists "alunos_update_staff"      on public.alunos_matriculados;
drop policy if exists "alunos_delete_staff"      on public.alunos_matriculados;

-- 4.4 CURSOS / TURMAS — leitura pública (catálogo), escrita só staff ---------------
create policy "cursos_leitura_publica"
  on public.cursos for select
  using (true);

create policy "cursos_escrita_staff"
  on public.cursos for all
  using (public.eh_staff())
  with check (public.eh_staff());

create policy "turmas_leitura_publica"
  on public.turmas for select
  using (true);

create policy "turmas_escrita_staff"
  on public.turmas for all
  using (public.eh_staff())
  with check (public.eh_staff());

-- 4.5 INSCRIÇÕES — anon pode INSERIR; staff gere o resto ----------------------------
create policy "inscricoes_anon_insert"
  on public.inscricoes for insert
  to anon, authenticated
  with check (true);

create policy "inscricoes_select_staff"
  on public.inscricoes for select
  using (public.eh_staff());

create policy "inscricoes_update_staff"
  on public.inscricoes for update
  using (public.eh_staff())
  with check (public.eh_staff());

create policy "inscricoes_delete_staff"
  on public.inscricoes for delete
  using (public.eh_staff());

-- 4.6 DOCUMENTOS — anon pode inserir (upload anexado à inscrição); staff gere -------
create policy "documentos_anon_insert"
  on public.documentos_inscricao for insert
  to anon, authenticated
  with check (true);

create policy "documentos_select_staff"
  on public.documentos_inscricao for select
  using (public.eh_staff());

create policy "documentos_update_staff"
  on public.documentos_inscricao for update
  using (public.eh_staff())
  with check (public.eh_staff());

create policy "documentos_delete_staff"
  on public.documentos_inscricao for delete
  using (public.eh_staff());

-- 4.7 ALUNOS MATRICULADOS — apenas staff --------------------------------------------
create policy "alunos_select_staff"
  on public.alunos_matriculados for select
  using (public.eh_staff());

create policy "alunos_insert_staff"
  on public.alunos_matriculados for insert
  with check (public.eh_staff());

create policy "alunos_update_staff"
  on public.alunos_matriculados for update
  using (public.eh_staff())
  with check (public.eh_staff());

create policy "alunos_delete_staff"
  on public.alunos_matriculados for delete
  using (public.eh_staff());

-- ----------------------------------------------------------------------------
-- 5. PERMISSÕES (GRANTS)
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on public.cursos, public.turmas to anon, authenticated;
grant insert on public.inscricoes, public.documentos_inscricao to anon, authenticated;

-- Staff autenticado gere tudo (as políticas RLS continuam a aplicar o papel)
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ----------------------------------------------------------------------------
-- 6. ÍNDICES DE OTIMIZAÇÃO
-- ----------------------------------------------------------------------------
create index if not exists idx_inscricoes_numero_bi        on public.inscricoes (numero_bi);
create index if not exists idx_inscricoes_numero_inscricao on public.inscricoes (numero_inscricao);
create index if not exists idx_inscricoes_estado           on public.inscricoes (estado);
create index if not exists idx_inscricoes_curso            on public.inscricoes (curso_id);
create index if not exists idx_inscricoes_created_at       on public.inscricoes (created_at desc);
create index if not exists idx_documentos_inscricao        on public.documentos_inscricao (inscricao_id);
create index if not exists idx_turmas_curso                on public.turmas (curso_id);
create index if not exists idx_turmas_ano_lectivo          on public.turmas (ano_lectivo);
create index if not exists idx_alunos_turma                on public.alunos_matriculados (turma_id);
create index if not exists idx_alunos_estado               on public.alunos_matriculados (estado_aluno);

-- ----------------------------------------------------------------------------
-- FIM DO SCRIPT
-- ----------------------------------------------------------------------------
