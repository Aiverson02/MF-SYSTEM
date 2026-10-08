-- ============================================================================
-- 005 — CORRECÇÃO matricular_aluno (ambiguidade numero_estudante) + PAGAMENTOS
-- ============================================================================
-- Parte A: a função matricular_aluno declara
--   returns table (sucesso boolean, numero_estudante text, mensagem text)
-- O returns table cria parâmetros OUT; "numero_estudante" passa a colidir com a
-- coluna alunos_matriculados.numero_estudante, e qualquer referência não
-- qualificada dentro da função fica ambígua
-- ("column reference "numero_estudante" is ambiguous").
-- Correção: qualificar todas as colunas com alias e devolver via variáveis locais.
--
-- Parte B: estrutura de pagamentos de mensalidades:
--   pagamentos (id, aluno_matriculado_id, mes_referencia, valor, data_pagamento,
--               metodo, referencia, estado, criado_por, created_at)
--   config_pagamentos (valor_mensalidade por curso, vigência)
--   RLS: leitura/escrita apenas staff; alunos/anon sem acesso.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PARTE A — matricular_aluno sem ambiguidade
-- ---------------------------------------------------------------------------

create or replace function public.matricular_aluno(
  p_inscricao_id uuid,
  p_turma_id uuid
)
returns table (sucesso boolean, numero_estudante text, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado       estado_inscricao;
  v_curso_id     uuid;
  v_limite       integer;
  v_preenchidas  integer;
  v_ano          integer := extract(year from now())::int;
  v_seq          bigint;
  v_numero       text;
  v_ja_existe    boolean;
begin
  if not public.eh_staff() then
    return query select false, null::text, 'Acesso negado: apenas secretaria/admin.'::text;
    return;
  end if;

  -- 1. Validar inscrição (colunas qualificadas com alias "i")
  select i.estado, i.curso_id
    into v_estado, v_curso_id
    from public.inscricoes i
   where i.id = p_inscricao_id;

  if not found then
    return query select false, null::text, 'Inscrição não encontrada.'::text;
    return;
  end if;

  if v_estado <> 'aprovado' then
    return query select false, null::text,
      format('A inscrição precisa estar aprovada (estado actual: %s).', v_estado)::text;
    return;
  end if;

  -- Já matriculado? (alias "am" qualifica inscricao_id)
  select exists(
           select 1
             from public.alunos_matriculados am
            where am.inscricao_id = p_inscricao_id
         )
    into v_ja_existe;
  if v_ja_existe then
    return query select false, null::text, 'Esta inscrição já foi matriculada.'::text;
    return;
  end if;

  -- 2. Validar turma e vagas (lock de linha para evitar overbooking)
  select t.limite_vagas, t.vagas_preenchidas, t.curso_id
    into v_limite, v_preenchidas, v_curso_id
    from public.turmas t
   where t.id = p_turma_id
   for update;

  if not found then
    return query select false, null::text, 'Turma não encontrada.'::text;
    return;
  end if;

  if v_preenchidas >= v_limite then
    return query select false, null::text, 'Turma sem vagas disponíveis.'::text;
    return;
  end if;

  -- 3. Gerar número de estudante único
  --    (colunas qualificadas: sem ambiguidade com o OUT numero_estudante)
  select coalesce(
           max(nullif(regexp_replace(am.numero_estudante, '^EST-[0-9]{4}-', ''), '')::bigint),
           0
         ) + 1
    into v_seq
    from public.alunos_matriculados am
   where am.numero_estudante like 'EST-' || v_ano || '-%';

  v_numero := format('EST-%s-%s', v_ano, lpad(v_seq::text, 6, '0'));

  -- 4. Inserir matrícula (colunas e values qualificados)
  insert into public.alunos_matriculados
    (inscricao_id, numero_estudante, turma_id, data_matricula, estado_aluno)
  values
    (p_inscricao_id, v_numero, p_turma_id, current_date, 'ativo');

  -- 5. Incrementar vagas
  update public.turmas
     set vagas_preenchidas = vagas_preenchidas + 1
   where id = p_turma_id;

  return query select true, v_numero, 'Matrícula efectuada com sucesso.'::text;
end;
$$;

revoke all on function public.matricular_aluno(uuid, uuid) from public, anon;
grant execute on function public.matricular_aluno(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- PARTE B — PAGAMENTOS DE MENSALIDADES
-- ---------------------------------------------------------------------------

-- B1. Valor de mensalidade por curso (vigência por ano lectivo)
create table if not exists public.config_pagamentos (
  id                uuid primary key default gen_random_uuid(),
  curso_id          uuid not null references public.cursos(id) on delete cascade,
  ano_lectivo       integer not null default extract(year from now())::int,
  valor_mensalidade numeric(12,2) not null check (valor_mensalidade >= 0),
  dia_limite        integer not null default 5 check (dia_limite between 1 and 28),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (curso_id, ano_lectivo)
);

-- B2. Pagamentos: uma linha por (aluno, mês de referência)
create table if not exists public.pagamentos (
  id              uuid primary key default gen_random_uuid(),
  aluno_id        uuid not null references public.alunos_matriculados(id) on delete cascade,
  mes_referencia  date not null,              -- 1º dia do mês de referência
  valor           numeric(12,2) not null check (valor >= 0),
  data_pagamento  date,
  metodo          text check (metodo in ('numerario', 'mpesa', 'emola', 'transferencia', 'outro')),
  referencia      text,                       -- nº recibo / transação
  estado          text not null default 'pendente' check (estado in ('pendente', 'pago', 'isento', 'cancelado')),
  observacoes     text,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (aluno_id, mes_referencia)
);

create index if not exists idx_pagamentos_aluno on public.pagamentos (aluno_id);
create index if not exists idx_pagamentos_mes on public.pagamentos (mes_referencia);
create index if not exists idx_pagamentos_estado on public.pagamentos (estado);

-- B3. updated_at automático (reutiliza trigger se já existir)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pagamentos_updated on public.pagamentos;
create trigger trg_pagamentos_updated
  before update on public.pagamentos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_config_pag_updated on public.config_pagamentos;
create trigger trg_config_pag_updated
  before update on public.config_pagamentos
  for each row execute function public.set_updated_at();

-- B4. RLS
alter table public.config_pagamentos enable row level security;
alter table public.pagamentos enable row level security;

drop policy if exists "config_pag_staff_all" on public.config_pagamentos;
create policy "config_pag_staff_all"
  on public.config_pagamentos
  for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

drop policy if exists "pag_staff_all" on public.pagamentos;
create policy "pag_staff_all"
  on public.pagamentos
  for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

-- B5. RPC: gerar cobranças do mês para todos os alunos activos
--     (idempotente: ignora alunos que já tenham cobrança no mês)
create or replace function public.gerar_cobrancas_mes(p_mes date)
returns table (gerados integer, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mes        date := date_trunc('month', p_mes)::date;
  v_ano        integer := extract(year from v_mes)::int;
  v_criados    integer := 0;
  r            record;
  v_valor      numeric(12,2);
  v_dia_limite integer;
begin
  if not public.eh_staff() then
    return query select 0, 'Acesso negado: apenas secretaria/admin.'::text;
    return;
  end if;

  for r in
    select am.id            as aluno_id,
           am.turma_id,
           t.curso_id
      from public.alunos_matriculados am
      join public.turmas t on t.id = am.turma_id
     where am.estado_aluno = 'ativo'
       and not exists (
             select 1 from public.pagamentos p
              where p.aluno_id = am.id
                and p.mes_referencia = v_mes
           )
  loop
    select c.valor_mensalidade, c.dia_limite
      into v_valor, v_dia_limite
      from public.config_pagamentos c
     where c.curso_id = r.curso_id
       and c.ano_lectivo = v_ano;

    if not found then
      -- Sem config para o curso: não gera cobrança (fica registado no retorno? simples: salta)
      continue;
    end if;

    insert into public.pagamentos (aluno_id, mes_referencia, valor, estado)
    values (r.aluno_id, v_mes, v_valor, 'pendente');

    v_criados := v_criados + 1;
  end loop;

  return query select v_criados,
    format('Cobranças geradas para %s aluno(s).', v_criados)::text;
end;
$$;

revoke all on function public.gerar_cobrancas_mes(date) from public, anon;
grant execute on function public.gerar_cobrancas_mes(date) to authenticated;
