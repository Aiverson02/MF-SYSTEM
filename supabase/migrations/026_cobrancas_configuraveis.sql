-- ============================================================================
-- 026 — Cobranças configuráveis pelo admin (catálogo + aplicação a alunos)
-- ============================================================================
-- Pedido (2026-10-20): "nas configurações adicione uma opção para criar
-- cobranças que os alunos devem pagar. ex.: Testes (3 testes), valores de
-- contribuições para material/aula, valores de exame. O admin deve ter essa
-- possibilidade."
--
-- Decisão de desenho (confirmada com o utilizador): **catálogo + aplicar a
-- alunos**. O admin cria os tipos de cobrança em Configurações (nome,
-- descrição, valor) e depois atribui-os a alunos escolhidos — ou a todos os
-- activos de uma vez. As atribuições ficam pendentes na página Pagamentos,
-- com "marcar pago" / isentar e recibo, tal como as mensalidades.
--
-- Duas tabelas, por separado de propósito:
--   · `cobrancas`       — o catálogo (preçário configurável, reutilizável);
--   · `cobrancas_alunos` — cada divida concreta de um aluno, com o valor
--     copiado na altura da aplicação (mudar o preço do catálogo não reescreve
--     dívidas já lançadas — essencial em finanças).
--
-- Notas:
--   · `cobranca_id` usa `on delete restrict`: não se apaga um tipo de cobrança
--     com histórico; a UI pré-verifica e mostra mensagem amigável.
--   · Uma aplicação por (cobrança, aluno): a RPC ignora alunos que já têm a
--     cobrança (idempotente). Para cobrar duas vezes, cancela-se a linha e
--     volta a aplicar-se, ou cria-se outro tipo de cobrança.
--   · As transições de estado (pago/isento/cancelado) seguem o padrão da
--     tabela `pagamentos`: escrita directa do staff, com RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------------
create table if not exists public.cobrancas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  valor       numeric(12,2) not null default 0 check (valor >= 0),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.cobrancas is
  'Tipos de cobrança configurados pelo admin (ex.: Testes, material, exame).';

drop trigger if exists trg_cobrancas_updated on public.cobrancas;
create trigger trg_cobrancas_updated
  before update on public.cobrancas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Dividas concretas por aluno
-- ---------------------------------------------------------------------------
create table if not exists public.cobrancas_alunos (
  id              uuid primary key default gen_random_uuid(),
  cobranca_id     uuid not null references public.cobrancas(id) on delete restrict,
  aluno_id        uuid not null references public.alunos_matriculados(id) on delete cascade,
  valor           numeric(12,2) not null check (valor >= 0),
  estado          text not null default 'pendente'
                  check (estado in ('pendente', 'pago', 'isento', 'cancelado')),
  data_pagamento  date,
  metodo          text check (metodo in ('numerario', 'mpesa', 'emola', 'transferencia', 'outro')),
  referencia      text,
  observacoes     text,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.cobrancas_alunos is
  'Cobrança do catálogo aplicada a um aluno (valor copiado na aplicação).';

drop trigger if exists trg_cobrancas_alunos_updated on public.cobrancas_alunos;
create trigger trg_cobrancas_alunos_updated
  before update on public.cobrancas_alunos
  for each row execute function public.set_updated_at();

create index if not exists idx_cobrancas_alunos_aluno on public.cobrancas_alunos (aluno_id);
create index if not exists idx_cobrancas_alunos_cobranca on public.cobrancas_alunos (cobranca_id);
create index if not exists idx_cobrancas_alunos_estado on public.cobrancas_alunos (estado);

-- ---------------------------------------------------------------------------
-- 3. RLS + grants (catálogo e dividas: só staff, como em pagamentos)
-- ---------------------------------------------------------------------------
alter table public.cobrancas        enable row level security;
alter table public.cobrancas_alunos enable row level security;

drop policy if exists "cobrancas_staff_all" on public.cobrancas;
create policy "cobrancas_staff_all"
  on public.cobrancas for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

drop policy if exists "cobrancas_alunos_staff_all" on public.cobrancas_alunos;
create policy "cobrancas_alunos_staff_all"
  on public.cobrancas_alunos for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

grant select, insert, update, delete on public.cobrancas        to authenticated;
grant select, insert, update, delete on public.cobrancas_alunos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: aplicar uma cobrança a alunos (ou a todos os activos)
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_cobranca(
  p_cobranca_id    uuid,
  p_aluno_ids      uuid[] default null,
  p_todos_activos  boolean default false
)
returns table (aplicados integer, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome    text;
  v_ativo   boolean;
  v_valor   numeric(12,2);
  v_total   integer := 0;
begin
  -- Autorização no servidor: a função corre como definer (necessário para
  -- escrever em lote), por isso o papel é provado aqui, não pela RLS.
  if not public.eh_staff() then
    return query select 0, 'Apenas a secretaria/administração pode aplicar cobranças.'::text;
    return;
  end if;

  select c.nome, c.ativo, c.valor
    into v_nome, v_ativo, v_valor
    from public.cobrancas c
   where c.id = p_cobranca_id;

  if v_nome is null then
    return query select 0, 'Cobrança não encontrada.'::text;
    return;
  end if;

  if not v_ativo then
    return query select 0, format('A cobrança "%s" está desactivada — reactive-a primeiro.', v_nome)::text;
    return;
  end if;

  if coalesce(p_todos_activos, false) then
    -- Todos os alunos activos que ainda não têm esta cobrança.
    insert into public.cobrancas_alunos (cobranca_id, aluno_id, valor, criado_por)
    select p_cobranca_id, a.id, v_valor, auth.uid()
      from public.alunos_matriculados a
     where a.estado_aluno = 'ativo'
       and not exists (
             select 1 from public.cobrancas_alunos ca
              where ca.cobranca_id = p_cobranca_id
                and ca.aluno_id = a.id
           );
    get diagnostics v_total = row_count;

    return query select v_total,
      case when v_total = 0 then
        format('Nada a fazer: todos os alunos activos já têm a cobrança "%s".', v_nome)
      else
        format('Cobrança "%s" aplicada a %s aluno(s) activo(s).', v_nome, v_total)
      end::text;
    return;
  end if;

  if p_aluno_ids is null or coalesce(array_length(p_aluno_ids, 1), 0) = 0 then
    return query select 0, 'Escolha os alunos — ou active a opção de aplicar a todos os activos.'::text;
    return;
  end if;

  insert into public.cobrancas_alunos (cobranca_id, aluno_id, valor, criado_por)
  select distinct p_cobranca_id, x.aluno_id, v_valor, auth.uid()
    from unnest(p_aluno_ids) as x(aluno_id)
    join public.alunos_matriculados a on a.id = x.aluno_id
   where not exists (
           select 1 from public.cobrancas_alunos ca
            where ca.cobranca_id = p_cobranca_id
              and ca.aluno_id = x.aluno_id
         );
  get diagnostics v_total = row_count;

  return query select v_total,
    case when v_total = 0 then
      format('Nada a fazer: os alunos escolhidos já têm a cobrança "%s".', v_nome)
    else
      format('Cobrança "%s" aplicada a %s aluno(s).', v_nome, v_total)
    end::text;
end;
$$;

revoke all on function public.aplicar_cobranca(uuid, uuid[], boolean) from public, anon;
grant execute on function public.aplicar_cobranca(uuid, uuid[], boolean) to authenticated;
