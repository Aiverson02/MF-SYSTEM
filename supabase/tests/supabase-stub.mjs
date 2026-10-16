/**
 * Banco de ensaio para as migrações: um Postgres **real** (compilado para WASM,
 * via PGlite) com o mínimo de infra-estrutura do Supabase que as migrações 015
 * e 016 usam.
 *
 * Porque existe: validar SQL (fórmulas, triggers, políticas, RPCs) a sério, sem
 * Docker, sem ligação à internet e sem tocar no projecto Supabase de produção.
 *
 * O que é fiel ao Supabase e o que não é:
 *   · `auth.uid()` e `auth.jwt()` lêem `request.jwt.claims`, como no Supabase;
 *     `public.eh_admin()` / `public.eh_staff()` são **copiados da migração 014**
 *     para os testes exercitarem a mesma lógica de papéis.
 *   · As tabelas de `auth` (users/identities) e as base (`cursos`, `turmas`,
 *     `inscricoes`, `alunos_matriculados`, `formadores`) replicam as colunas
 *     relevantes do esquema real, para um INSERT com colunas erradas falhar aqui.
 *   · `pgcrypto` não existe no PGlite: `extensions.crypt`/`gen_salt` são duplos
 *     de teste (não fazem bcrypt). A criptografia em si não é testada aqui.
 *   · O PGlite corre como superutilizador, portanto **as políticas de RLS não
 *     são aplicadas**. O que se verifica é o que está nas funções (autorizações
 *     explícitas) e os grants (via `has_table_privilege`).
 */
import { PGlite } from '@electric-sql/pglite'

export const ESQUEMA = `
  create role anon;
  create role authenticated;

  -- ---------------------------------------------------------------- auth -----
  create schema if not exists auth;

  create table auth.users (
    instance_id                 uuid,
    id                          uuid primary key,
    aud                         varchar(255),
    role                        varchar(255),
    email                       varchar(255) unique,
    encrypted_password          varchar(255),
    email_confirmed_at          timestamptz,
    invited_at                  timestamptz,
    confirmation_token          varchar(255) default '',
    confirmation_sent_at        timestamptz,
    recovery_token              varchar(255) default '',
    recovery_sent_at            timestamptz,
    email_change_token_new      varchar(255) default '',
    email_change                varchar(255) default '',
    email_change_sent_at        timestamptz,
    last_sign_in_at             timestamptz,
    raw_app_meta_data           jsonb,
    raw_user_meta_data          jsonb,
    is_super_admin              boolean,
    created_at                  timestamptz,
    updated_at                  timestamptz,
    phone                       text default null,
    phone_confirmed_at          timestamptz,
    phone_change                text default '',
    phone_change_token          varchar(255) default '',
    phone_change_sent_at        timestamptz,
    confirmed_at                timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
    email_change_token_current  varchar(255) default '',
    email_change_confirm_status smallint default 0,
    banned_until                timestamptz,
    reauthentication_token      varchar(255) default '',
    reauthentication_sent_at    timestamptz,
    is_sso_user                 boolean not null default false,
    deleted_at                  timestamptz,
    is_anonymous                boolean not null default false
  );

  create table auth.identities (
    id            uuid primary key default gen_random_uuid(),
    provider_id   text not null,
    user_id       uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null,
    provider      text not null,
    last_sign_in_at timestamptz,
    created_at    timestamptz,
    updated_at    timestamptz,
    email         text generated always as (lower(identity_data ->> 'email')) stored,
    unique (provider_id, provider)
  );

  create or replace function auth.jwt() returns jsonb
    language sql stable
    as $fn$
      select case when coalesce(current_setting('request.jwt.claims', true), '') = ''
                  then '{}'::jsonb
                  else current_setting('request.jwt.claims', true)::jsonb end;
    $fn$;

  create or replace function auth.uid() returns uuid
    language sql stable
    as $fn$
      select nullif(auth.jwt() ->> 'sub', '')::uuid;
    $fn$;

  -- ---------------------------------------------------------- extensions -----
  create schema if not exists extensions;

  -- Duplos de teste do pgcrypto (indisponível no PGlite): o objectivo é exercitar
  -- as RPCs, não a criptografia.
  create or replace function extensions.gen_salt(text) returns text
    language sql immutable as $fn$ select 'sal-de-teste' $fn$;

  create or replace function extensions.crypt(text, text) returns text
    language sql immutable as $fn$ select 'bcrypt-de-teste:' || $1 $fn$;

  -- ------------------------------------------------------------- public ------
  create type public.turno as enum ('manha', 'tarde', 'pos_laboral');
  create type public.estado_aluno_enum as enum ('ativo', 'trancado', 'concluido');

  create table public.cursos (
    id         uuid primary key default gen_random_uuid(),
    nome       text not null,
    codigo     text not null unique,
    duracao    text,
    descricao  text,
    ativo      boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table public.turmas (
    id                uuid primary key default gen_random_uuid(),
    curso_id          uuid not null references public.cursos(id) on delete restrict,
    nome_turma        text not null,
    turno             public.turno not null,
    limite_vagas      integer not null default 0,
    vagas_preenchidas integer not null default 0,
    ano_lectivo       integer not null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );

  create table public.inscricoes (
    id                uuid primary key default gen_random_uuid(),
    numero_inscricao  text not null unique,
    nome_completo     text not null,
    numero_bi         text not null,
    data_nascimento   date not null,
    genero            text,
    email             text,
    telefone_whatsapp text not null,
    curso_id          uuid not null references public.cursos(id) on delete restrict,
    turno_pretendido  public.turno not null,
    estado            text not null default 'pendente',
    motivo_rejeicao   text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );

  create table public.alunos_matriculados (
    id               uuid primary key default gen_random_uuid(),
    inscricao_id     uuid not null unique references public.inscricoes(id) on delete cascade,
    numero_estudante text not null unique,
    turma_id         uuid not null references public.turmas(id) on delete restrict,
    data_matricula   date not null default current_date,
    estado_aluno     public.estado_aluno_enum not null default 'ativo',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
  );

  create table public.formadores (
    id            uuid primary key default gen_random_uuid(),
    nome          text not null,
    especialidade text,
    telefone      text,
    email         text,
    ativo         boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );

  create or replace function public.set_updated_at() returns trigger
    language plpgsql
    as $fn$ begin new.updated_at = now(); return new; end $fn$;

  -- Copiado da migração 014: papel SÓ em app_metadata (imutável pelo utilizador).
  create or replace function public.eh_admin() returns boolean
    language sql stable security definer set search_path = public
    as $fn$
      select auth.uid() is not null
         and coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''), '') = 'admin';
    $fn$;

  create or replace function public.eh_staff() returns boolean
    language sql stable security definer set search_path = public
    as $fn$
      select auth.uid() is not null
         and coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''), '')
             in ('secretaria', 'admin');
    $fn$;
`

/** Um Postgres novo com a infra-estrutura acima. */
export async function criarBanco() {
  const db = new PGlite()
  await db.exec(ESQUEMA)
  return db
}

/**
 * Passa a executar como o utilizador/papel indicado (equivale a um JWT).
 * `metaUtilizador` replica `user_metadata`, o campo que o PRÓPRIO utilizador
 * escreve com auth.updateUser({ data }) — usado para provar que o papel aí
 * declarado não autoriza nada (migração 019).
 */
export async function autenticar(db, { id = null, papel = null, metaUtilizador = null } = {}) {
  const claims = JSON.stringify({
    sub: id,
    app_metadata: papel ? { papel } : {},
    user_metadata: metaUtilizador ?? {},
    role: 'authenticated',
  })
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
}

/** Sem sessão (o que o Supabase vê como `anon`). */
export async function semSessao(db) {
  await db.query(`select set_config('request.jwt.claims', '', false)`)
}
