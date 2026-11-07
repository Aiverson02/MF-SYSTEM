-- ============================================================================
-- 027 — Preçário e contribuições por curso
-- ============================================================================
-- Pedido (2026-11): "permita ao admin estabelecer valores de taxas ou
-- contribuição por curso" e "garanta que toda a estrutura do sistema de
-- pagamentos e cobranças funcione".
--
-- 1. `config_pagamentos` já existe desde a 005 (valor_mensalidade + dia_limite
--    por curso/ano lectivo), mas não havia UI nem dados — sem ele,
--    `gerar_cobrancas_mes` salta todos os alunos em silêncio e o mês fica
--    sem mensalidades. A UI passa a ser Configurações → Preçário por curso
--    (só admin, como a política da 013 já exige).
--
-- 2. `cobrancas.curso_id` — a contribuição/taxa pode ser de um curso
--    (NULL = todos os cursos). `aplicar_cobranca` passa a respeitar o curso:
--    "aplicar a todos os activos" aplica só aos alunos desse curso.
--
-- 3. `gerar_cobrancas_mes` deixa de falhar em silêncio: a mensagem diz quantos
--    alunos ficaram sem cobrança porque o curso não tem preçário configurado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Contribuição/taxa por curso
-- ---------------------------------------------------------------------------
alter table public.cobrancas
  add column if not exists curso_id uuid references public.cursos(id) on delete set null;

create index if not exists idx_cobrancas_curso on public.cobrancas (curso_id);

comment on column public.cobrancas.curso_id is
  'Curso a que a cobrança se destina. NULL = todos os cursos (aplica como antes).';

-- ---------------------------------------------------------------------------
-- 2. aplicar_cobranca respeita o curso da cobrança
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
  v_nome        text;
  v_ativo       boolean;
  v_valor       numeric(12,2);
  v_curso       uuid;
  v_curso_nome  text;
  v_curso_sufixo text := '';
  v_total       integer := 0;
begin
  -- Autorização no servidor: a função corre como definer (necessário para
  -- escrever em lote), por isso o papel é provado aqui, não pela RLS.
  if not public.eh_staff() then
    return query select 0, 'Apenas a secretaria/administração pode aplicar cobranças.'::text;
    return;
  end if;

  select c.nome, c.ativo, c.valor, c.curso_id
    into v_nome, v_ativo, v_valor, v_curso
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

  if v_curso is not null then
    select c.nome into v_curso_nome from public.cursos c where c.id = v_curso;
    -- Só acrescenta " do curso X" quando a cobrança é mesmo de um curso:
    -- format('%s', null) devolve '' (não NULL), e coalesce não corrigia isso.
    v_curso_sufixo := format(' do curso "%s"', coalesce(v_curso_nome, '—'));
  end if;

  if coalesce(p_todos_activos, false) then
    -- Todos os alunos activos do curso da cobrança (ou todos, se for geral)
    -- que ainda não têm esta cobrança.
    insert into public.cobrancas_alunos (cobranca_id, aluno_id, valor, criado_por)
    select p_cobranca_id, a.id, v_valor, auth.uid()
      from public.alunos_matriculados a
      join public.turmas t on t.id = a.turma_id
     where a.estado_aluno = 'ativo'
       and (v_curso is null or t.curso_id = v_curso)
       and not exists (
             select 1 from public.cobrancas_alunos ca
              where ca.cobranca_id = p_cobranca_id
                and ca.aluno_id = a.id
           );
    get diagnostics v_total = row_count;

    return query select v_total,
      case when v_total = 0 then
        format('Nada a fazer: os alunos activos%s já têm a cobrança "%s".',
               v_curso_sufixo, v_nome)
      else
        format('Cobrança "%s" aplicada a %s aluno(s)%s.', v_nome, v_total,
               v_curso_sufixo)
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
    join public.turmas t on t.id = a.turma_id
   where (v_curso is null or t.curso_id = v_curso)
     and not exists (
           select 1 from public.cobrancas_alunos ca
            where ca.cobranca_id = p_cobranca_id
              and ca.aluno_id = x.aluno_id
         );
  get diagnostics v_total = row_count;

  return query select v_total,
    case when v_total = 0 then
      format('Nada a fazer: os alunos escolhidos já têm a cobrança "%s"%s.',
             v_nome,
             case when v_curso is not null
                  then format(' — ou não são do curso "%s"', coalesce(v_curso_nome, ''))
                  else '' end)
    else
      format('Cobrança "%s" aplicada a %s aluno(s)%s.', v_nome, v_total,
             v_curso_sufixo)
    end::text;
end;
$$;

revoke all on function public.aplicar_cobranca(uuid, uuid[], boolean) from public, anon;
grant execute on function public.aplicar_cobranca(uuid, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. gerar_cobrancas_mes: dizer quando faltam preçários
-- ---------------------------------------------------------------------------
create or replace function public.gerar_cobrancas_mes(p_mes date)
returns table (gerados integer, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mes          date := date_trunc('month', p_mes)::date;
  v_ano          integer := extract(year from v_mes)::int;
  v_criados      integer := 0;
  v_sem_precario integer := 0;
  r              record;
  v_valor        numeric(12,2);
  v_dia_limite   integer;
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
      -- Sem preçário para o curso/ano: nada a gerar, mas o utilizador tem de
      -- saber — antes o mês ficava vazio sem explicação.
      v_sem_precario := v_sem_precario + 1;
      continue;
    end if;

    insert into public.pagamentos (aluno_id, mes_referencia, valor, estado)
    values (r.aluno_id, v_mes, v_valor, 'pendente');

    v_criados := v_criados + 1;
  end loop;

  return query select v_criados,
    format('Cobranças geradas para %s aluno(s).%s', v_criados,
           case when v_sem_precario > 0
                then format(' %s aluno(s) sem cobrança: o curso ainda não tem preçário para %s — defina em Configurações → Preçário por curso.',
                            v_sem_precario, v_ano)
                else '' end)::text;
end;
$$;

revoke all on function public.gerar_cobrancas_mes(date) from public, anon;
grant execute on function public.gerar_cobrancas_mes(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Preçário: leitura staff, escrita admin (reforço explícito da 013)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.config_pagamentos to authenticated;

drop policy if exists "config_pag_select_staff" on public.config_pagamentos;
create policy "config_pag_select_staff"
  on public.config_pagamentos for select to authenticated
  using (public.eh_staff());

drop policy if exists "config_pag_write_admin" on public.config_pagamentos;
create policy "config_pag_write_admin"
  on public.config_pagamentos for all to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());
