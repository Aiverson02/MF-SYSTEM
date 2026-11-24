-- ============================================================================
-- 035 — Cobranças e recebimentos limitados à edição escolhida
-- ============================================================================
-- Auditoria das listas do painel (2026-11): três acções em massa continuavam a
-- alcançar alunos de todas as edições, mesmo com uma edição escolhida no
-- cabeçalho:
--
--   1. `aplicar_cobranca` — "Aplicar a alunos" nas Configurações lançava a
--      dívida a todos os alunos activos (ou aos escolhidos), sem olhar à turma.
--   2. `gerar_cobrancas_mes` — "Gerar cobranças do mês" criava a mensalidade de
--      todos os alunos activos, incluindo os de edições anteriores/seguintes.
--   3. `registar_recebimento` — "Novo recebimento" em Finanças aceitava
--      qualquer aluno activo, caísse ele em que edição caísse.
--
-- As três passam a aceitar `p_edicao_id uuid default null`. Com NULL mantêm o
-- comportamento anterior (todas as edições); com uma edição, só os alunos cuja
-- turma pertence a essa edição são alcançados. A edição vem sempre da turma da
-- matrícula, tal como no resto do painel (migração 032).
--
-- Adicionar um parâmetro muda a assinatura: as versões antigas são removidas
-- para não ficarem overloads ambíguos com os valores por omissão.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. aplicar_cobranca respeita a edição
-- ---------------------------------------------------------------------------
drop function if exists public.aplicar_cobranca(uuid, uuid[], boolean);

create or replace function public.aplicar_cobranca(
  p_cobranca_id    uuid,
  p_aluno_ids      uuid[] default null,
  p_todos_activos  boolean default false,
  p_edicao_id      uuid default null
)
returns table (aplicados integer, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome         text;
  v_ativo        boolean;
  v_valor        numeric(12,2);
  v_curso        uuid;
  v_curso_nome   text;
  v_curso_sufixo text := '';
  v_edicao_sufixo text := '';
  v_edicao_num   integer;
  v_edicao_ano   integer;
  v_total        integer := 0;
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

  if p_edicao_id is not null then
    select e.numero, e.ano into v_edicao_num, v_edicao_ano
      from public.edicoes e where e.id = p_edicao_id;
    if v_edicao_num is null then
      return query select 0, 'Edição não encontrada.'::text;
      return;
    end if;
    v_edicao_sufixo := format(' da edição %s · %s', v_edicao_num, v_edicao_ano);
  end if;

  if coalesce(p_todos_activos, false) then
    -- Todos os alunos activos do curso da cobrança (ou todos, se for geral)
    -- que ainda não têm esta cobrança e cuja turma é da edição escolhida.
    insert into public.cobrancas_alunos (cobranca_id, aluno_id, valor, criado_por)
    select p_cobranca_id, a.id, v_valor, auth.uid()
      from public.alunos_matriculados a
      join public.turmas t on t.id = a.turma_id
     where a.estado_aluno = 'ativo'
       and (v_curso is null or t.curso_id = v_curso)
       and (p_edicao_id is null or t.edicao_id = p_edicao_id)
       and not exists (
             select 1 from public.cobrancas_alunos ca
              where ca.cobranca_id = p_cobranca_id
                and ca.aluno_id = a.id
           );
    get diagnostics v_total = row_count;

    return query select v_total,
      case when v_total = 0 then
        format('Nada a fazer: os alunos activos%s%s já têm a cobrança "%s".',
               v_edicao_sufixo, v_curso_sufixo, v_nome)
      else
        format('Cobrança "%s" aplicada a %s aluno(s)%s%s.', v_nome, v_total,
               v_edicao_sufixo, v_curso_sufixo)
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
     and (p_edicao_id is null or t.edicao_id = p_edicao_id)
     and not exists (
           select 1 from public.cobrancas_alunos ca
            where ca.cobranca_id = p_cobranca_id
              and ca.aluno_id = x.aluno_id
         );
  get diagnostics v_total = row_count;

  return query select v_total,
    case when v_total = 0 then
      format('Nada a fazer: os alunos escolhidos já têm a cobrança "%s"%s%s.',
             v_nome,
             v_edicao_sufixo,
             case when v_curso is not null
                  then format(' — ou não são do curso "%s"', coalesce(v_curso_nome, ''))
                  else '' end)
    else
      format('Cobrança "%s" aplicada a %s aluno(s)%s%s.', v_nome, v_total,
             v_edicao_sufixo, v_curso_sufixo)
    end::text;
end;
$$;

revoke all on function public.aplicar_cobranca(uuid, uuid[], boolean, uuid) from public, anon;
grant execute on function public.aplicar_cobranca(uuid, uuid[], boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. gerar_cobrancas_mes respeita a edição
-- ---------------------------------------------------------------------------
drop function if exists public.gerar_cobrancas_mes(date);

create or replace function public.gerar_cobrancas_mes(
  p_mes      date,
  p_edicao_id uuid default null
)
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
  v_edicao_sufixo text := '';
  v_edicao_num   integer;
  v_edicao_ano   integer;
  r              record;
  v_valor        numeric(12,2);
  v_dia_limite   integer;
begin
  if not public.eh_staff() then
    return query select 0, 'Acesso negado: apenas secretaria/admin.'::text;
    return;
  end if;

  if p_edicao_id is not null then
    select e.numero, e.ano into v_edicao_num, v_edicao_ano
      from public.edicoes e where e.id = p_edicao_id;
    if v_edicao_num is null then
      return query select 0, 'Edição não encontrada.'::text;
      return;
    end if;
    v_edicao_sufixo := format(' (edição %s · %s)', v_edicao_num, v_edicao_ano);
  end if;

  for r in
    select am.id            as aluno_id,
           am.turma_id,
           t.curso_id
      from public.alunos_matriculados am
      join public.turmas t on t.id = am.turma_id
     where am.estado_aluno = 'ativo'
       and (p_edicao_id is null or t.edicao_id = p_edicao_id)
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
    format('Cobranças geradas para %s aluno(s)%s.%s', v_criados, v_edicao_sufixo,
           case when v_sem_precario > 0
                then format(' %s aluno(s) sem cobrança: o curso ainda não tem preçário para %s — defina em Configurações → Preçário por curso.',
                            v_sem_precario, v_ano)
                else '' end)::text;
end;
$$;

revoke all on function public.gerar_cobrancas_mes(date, uuid) from public, anon;
grant execute on function public.gerar_cobrancas_mes(date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. registar_recebimento só aceita alunos da edição escolhida
-- ---------------------------------------------------------------------------
drop function if exists public.registar_recebimento(uuid, text, numeric, date, text, text);

create or replace function public.registar_recebimento(
  p_aluno_id   uuid,
  p_tipo       text,
  p_valor      numeric,
  p_data       date default current_date,
  p_metodo     text default 'numerario',
  p_referencia text default null,
  p_edicao_id  uuid default null
)
returns table (sucesso boolean, mensagem text, movimento_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aluno_nome text;
  v_curso_id   uuid;
  v_curso_nome text;
  v_edicao_id  uuid;
  v_mes        date;
  v_id         uuid;
  v_estado     text;
  v_cat        text;
  v_nome       text;
  v_cob_id     uuid;
begin
  if not public.eh_staff() then
    return query select false,
      'Apenas a secretaria/administração pode registar recebimentos.'::text, null::uuid;
    return;
  end if;

  if p_tipo not in ('mensalidade', 'inscricao', 'apoio_aula', 'avaliacao', 'touca_avental') then
    return query select false, 'Tipo de recebimento inválido.'::text, null::uuid;
    return;
  end if;

  if p_valor is null or p_valor <= 0 then
    return query select false, 'O valor tem de ser maior do que zero.'::text, null::uuid;
    return;
  end if;

  if p_metodo is not null
     and p_metodo not in ('numerario', 'mpesa', 'emola', 'transferencia', 'outro') then
    return query select false, 'Forma de pagamento inválida.'::text, null::uuid;
    return;
  end if;

  select coalesce(i.nome_completo, 'Aluno'), t.curso_id, c.nome, t.edicao_id
    into v_aluno_nome, v_curso_id, v_curso_nome, v_edicao_id
    from public.alunos_matriculados am
    left join public.inscricoes i on i.id = am.inscricao_id
    left join public.turmas t on t.id = am.turma_id
    left join public.cursos c on c.id = t.curso_id
   where am.id = p_aluno_id;

  if not found then
    return query select false, 'Aluno não encontrado.'::text, null::uuid;
    return;
  end if;

  -- O aluno tem de pertencer à edição escolhida (a da turma da matrícula).
  if p_edicao_id is not null and v_edicao_id is distinct from p_edicao_id then
    return query select false,
      format('%s não pertence à edição escolhida — recebimentos só se registam para alunos dessa edição.',
             v_aluno_nome)::text,
      null::uuid;
    return;
  end if;

  -- Mensalidade: uma linha por aluno/mês. Se já estiver paga, não se duplica.
  if p_tipo = 'mensalidade' then
    v_mes := date_trunc('month', coalesce(p_data, current_date))::date;

    select p.id, p.estado into v_id, v_estado
      from public.pagamentos p
     where p.aluno_id = p_aluno_id
       and p.mes_referencia = v_mes;

    if v_id is not null then
      if v_estado = 'pago' then
        return query select false,
          format('A mensalidade de %s de %s já está registada como paga.',
                 to_char(v_mes, 'MM/YYYY'), v_aluno_nome)::text,
          v_id;
        return;
      end if;

      update public.pagamentos
         set valor = p_valor,
             estado = 'pago',
             data_pagamento = coalesce(p_data, current_date),
             metodo = coalesce(p_metodo, 'numerario'),
             referencia = p_referencia,
             criado_por = auth.uid()
       where id = v_id;
    else
      insert into public.pagamentos
        (aluno_id, mes_referencia, valor, estado, data_pagamento, metodo, referencia, criado_por)
      values
        (p_aluno_id, v_mes, p_valor, 'pago', coalesce(p_data, current_date),
         coalesce(p_metodo, 'numerario'), p_referencia, auth.uid())
      returning id into v_id;
    end if;

    return query select true,
      format('Mensalidade de %s recebida de %s (%s MT).',
             to_char(v_mes, 'MM/YYYY'), v_aluno_nome, p_valor)::text,
      v_id;
    return;
  end if;

  -- Outras taxas: catálogo + dívida paga do aluno.
  v_cat := case p_tipo
             when 'inscricao'     then 'inscricao'
             when 'apoio_aula'    then 'material_aula'
             when 'avaliacao'     then 'avaliacao'
             else                      'touca_avental'
           end;

  v_nome := case p_tipo
              when 'inscricao'  then 'Taxa de inscrição'
              when 'apoio_aula' then
                'Apoio de aula' ||
                case when v_curso_nome is not null then ' — ' || v_curso_nome else '' end
              when 'avaliacao'  then 'Taxa de avaliação'
              else                   'Touca e avental'
            end;

  -- Apoio de aula tem um preço por curso; as restantes taxas são gerais.
  if p_tipo = 'apoio_aula' and v_curso_id is not null then
    select c.id into v_cob_id
      from public.cobrancas c
     where c.categoria = v_cat and c.curso_id = v_curso_id
     order by c.created_at
     limit 1;
  else
    select c.id into v_cob_id
      from public.cobrancas c
     where c.categoria = v_cat and c.curso_id is null
     order by c.created_at
     limit 1;
  end if;

  if v_cob_id is null then
    insert into public.cobrancas (nome, descricao, valor, categoria, curso_id, ativo)
    values (
      v_nome,
      'Criada automaticamente no registo de recebimentos.',
      p_valor,
      v_cat,
      case when p_tipo = 'apoio_aula' then v_curso_id else null end,
      true
    )
    returning id into v_cob_id;
  end if;

  insert into public.cobrancas_alunos
    (cobranca_id, aluno_id, valor, estado, data_pagamento, metodo, referencia, criado_por)
  values
    (v_cob_id, p_aluno_id, p_valor, 'pago', coalesce(p_data, current_date),
     coalesce(p_metodo, 'numerario'), p_referencia, auth.uid())
  returning id into v_id;

  return query select true,
    format('%s recebida de %s (%s MT).', v_nome, v_aluno_nome, p_valor)::text,
    v_id;
end;
$$;

revoke all on function public.registar_recebimento(uuid, text, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.registar_recebimento(uuid, text, numeric, date, text, text, uuid) to authenticated;
