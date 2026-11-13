-- ============================================================================
-- 030 — Recebimentos rápidos a partir do caixa do dia
-- ============================================================================
-- CONTEXTO
--   A secretaria registava mensalidades, inscrições, apoio de aula, avaliações
--   e touca/avental na página Pagamentos, espalhados por listas e catálogos.
--   Para o trabalho diário, o registo passa a poder ser feito no próprio ecrã
--   de Finanças, indicando o aluno e o valor recebido.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Acrescenta a rubrica `touca_avental` ao catálogo de cobranças.
--   2. Cria a RPC `registar_recebimento`, que grava nos sítios certos — sem
--      duplicar receita nem inventar uma tabela paralela:
--        · mensalidade  → `pagamentos` (do mês da data escolhida);
--        · restantes    → `cobrancas` (catálogo, criado se faltar) +
--                         `cobrancas_alunos` (pago, com o valor recebido).
--      A vista `vw_movimentos_financeiros` passa a incluir estes movimentos
--      automaticamente, tal como a página Pagamentos e os recibos.
--   3. Recusa mensalidade já paga, valores <= 0, tipos e formas inválidas.
--      Só staff executa; anon não tem EXECUTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Nova rubrica: touca e avental
-- ---------------------------------------------------------------------------
alter table public.cobrancas drop constraint if exists cobrancas_categoria_check;
alter table public.cobrancas
  add constraint cobrancas_categoria_check check (
    categoria in ('mensalidade', 'apoio_mensal', 'material_aula', 'exame',
                  'inscricao', 'avaliacao', 'touca_avental', 'certificado', 'outro')
  );

comment on column public.cobrancas.categoria is
  'Rubrica financeira: mensalidade, apoio_mensal, material_aula, exame, inscricao, avaliacao, touca_avental, certificado, outro.';

-- ---------------------------------------------------------------------------
-- 2. Registo rápido de um recebimento
-- ---------------------------------------------------------------------------
create or replace function public.registar_recebimento(
  p_aluno_id   uuid,
  p_tipo       text,
  p_valor      numeric,
  p_data       date default current_date,
  p_metodo     text default 'numerario',
  p_referencia text default null
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

  select coalesce(i.nome_completo, 'Aluno'), t.curso_id, c.nome
    into v_aluno_nome, v_curso_id, v_curso_nome
    from public.alunos_matriculados am
    left join public.inscricoes i on i.id = am.inscricao_id
    left join public.turmas t on t.id = am.turma_id
    left join public.cursos c on c.id = t.curso_id
   where am.id = p_aluno_id;

  if not found then
    return query select false, 'Aluno não encontrado.'::text, null::uuid;
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

revoke all on function public.registar_recebimento(uuid, text, numeric, date, text, text) from public, anon;
grant execute on function public.registar_recebimento(uuid, text, numeric, date, text, text) to authenticated;
