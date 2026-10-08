-- ============================================================================
-- 004 — FORMADORES por curso + CONSULTA PÚBLICA de estado de inscrição
-- ============================================================================

-- 1. Formadores ------------------------------------------------------------
create table if not exists public.formadores (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  especialidade text,
  telefone    text,
  email       text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.formadores enable row level security;

drop policy if exists "formadores_leitura_publica" on public.formadores;
drop policy if exists "formadores_escrita_staff" on public.formadores;
create policy "formadores_leitura_publica"
  on public.formadores for select using (true);
create policy "formadores_escrita_staff"
  on public.formadores for all
  using (public.eh_staff()) with check (public.eh_staff());

grant select on public.formadores to anon, authenticated;
grant insert, update, delete on public.formadores to authenticated;

do $$ begin
  alter table public.cursos add column if not exists formador_id uuid references public.formadores(id) on delete set null;
exception when others then null; end $$;

drop trigger if exists trg_set_updated_at on public.formadores;
create trigger trg_set_updated_at before update on public.formadores
  for each row execute function public.set_updated_at();
create index if not exists idx_cursos_formador on public.cursos (formador_id);

-- 2. Consulta pública de estado (por nº de inscrição + BI, sem expor dados de terceiros)
create or replace function public.consultar_inscricao_publica(
  p_numero text,
  p_bi text
)
returns table (
  numero_inscricao text,
  nome_completo text,
  curso text,
  estado text,
  motivo_rejeicao text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.numero_inscricao, i.nome_completo, c.nome, i.estado::text, i.motivo_rejeicao, i.created_at
    from public.inscricoes i
    join public.cursos c on c.id = i.curso_id
   where upper(i.numero_inscricao) = upper(p_numero)
     and i.numero_bi = p_bi
   limit 1;
$$;

revoke all on function public.consultar_inscricao_publica(text, text) from public;
grant execute on function public.consultar_inscricao_publica(text, text) to anon, authenticated;
