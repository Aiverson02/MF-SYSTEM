-- 007 — Configurações da instituição (linha única, editável por staff, legível por todos)

create table if not exists public.config_instituicao (
  id         integer primary key default 1 check (id = 1),
  nome       text not null default 'Centro de Formação',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.config_instituicao (id, nome)
values (1, 'Centro de Formação')
on conflict (id) do nothing;

alter table public.config_instituicao enable row level security;

drop policy if exists "config_inst_select_all" on public.config_instituicao;
create policy "config_inst_select_all"
  on public.config_instituicao
  for select
  to anon, authenticated
  using (true);

drop policy if exists "config_inst_update_staff" on public.config_instituicao;
create policy "config_inst_update_staff"
  on public.config_instituicao
  for update
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

drop policy if exists "config_inst_insert_staff" on public.config_instituicao;
create policy "config_inst_insert_staff"
  on public.config_instituicao
  for insert
  to authenticated
  with check (public.eh_staff());

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_config_inst_updated on public.config_instituicao;
create trigger trg_config_inst_updated
  before update on public.config_instituicao
  for each row execute function public.set_updated_at();
