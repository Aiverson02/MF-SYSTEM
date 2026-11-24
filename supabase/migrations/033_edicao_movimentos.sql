-- ============================================================================
-- 033 — Edição nos movimentos financeiros
-- ============================================================================
-- `vw_movimentos_financeiros` passa a expor `edicao_id` (a edição da turma do
-- aluno). Assim Pagamentos e Finanças filtram pela edição escolhida no painel
-- sem duplicar joins no cliente.
--
-- Despesas são da instituição, não de um aluno: ficam com `edicao_id` nulo e
-- continuam visíveis em qualquer edição.
--
-- A vista tem `security_invoker`, por isso as políticas continuam a valer.
-- CREATE OR REPLACE só permite acrescentar colunas no fim — é o que se faz.
-- ============================================================================

create or replace view public.vw_movimentos_financeiros
with (security_invoker = on)
as
  -- Mensalidades pagas
  select
    'entrada'::text                              as sentido,
    'mensalidade'::text                          as origem,
    'mensalidade'::text                          as categoria,
    p.id::text                                   as origem_id,
    ('Mensalidade ' || to_char(p.mes_referencia, 'MM/YYYY'))::text as descricao,
    p.valor                                      as valor,
    p.data_pagamento                             as data,
    p.metodo                                     as metodo,
    p.referencia                                 as referencia,
    i.nome_completo                              as aluno_nome,
    am.numero_estudante                          as aluno_numero,
    co.nome                                      as curso_nome,
    t.edicao_id                                  as edicao_id
  from public.pagamentos p
  join public.alunos_matriculados am on am.id = p.aluno_id
  left join public.inscricoes i on i.id = am.inscricao_id
  left join public.turmas t on t.id = am.turma_id
  left join public.cursos co on co.id = t.curso_id
  where p.estado = 'pago' and p.data_pagamento is not null

  union all

  -- Cobranças avulsas pagas (taxas, material, apoio mensal...)
  select
    'entrada'::text                              as sentido,
    'cobranca'::text                             as origem,
    coalesce(c.categoria, 'outro')               as categoria,
    ca.id::text                                  as origem_id,
    c.nome                                       as descricao,
    ca.valor                                     as valor,
    ca.data_pagamento                            as data,
    ca.metodo                                    as metodo,
    ca.referencia                                as referencia,
    i.nome_completo                              as aluno_nome,
    am.numero_estudante                          as aluno_numero,
    co.nome                                      as curso_nome,
    t.edicao_id                                  as edicao_id
  from public.cobrancas_alunos ca
  join public.cobrancas c on c.id = ca.cobranca_id
  join public.alunos_matriculados am on am.id = ca.aluno_id
  left join public.inscricoes i on i.id = am.inscricao_id
  left join public.turmas t on t.id = am.turma_id
  left join public.cursos co on co.id = t.curso_id
  where ca.estado = 'pago' and ca.data_pagamento is not null

  union all

  -- Certificados e faixas pagos
  select
    'entrada'::text                              as sentido,
    'pos_conclusao'::text                        as origem,
    'certificado'::text                          as categoria,
    pc.id::text                                  as origem_id,
    case when pc.item = 'faixa' then 'Faixa de graduação' else 'Certificado' end as descricao,
    pc.valor                                     as valor,
    pc.data_pagamento                            as data,
    pc.metodo                                    as metodo,
    null::text                                   as referencia,
    i.nome_completo                              as aluno_nome,
    am.numero_estudante                          as aluno_numero,
    co.nome                                      as curso_nome,
    t.edicao_id                                  as edicao_id
  from public.pos_conclusao pc
  join public.alunos_matriculados am on am.id = pc.aluno_id
  left join public.inscricoes i on i.id = am.inscricao_id
  left join public.turmas t on t.id = am.turma_id
  left join public.cursos co on co.id = t.curso_id
  where pc.pago = true and pc.data_pagamento is not null

  union all

  -- Despesas (da instituição, não de uma edição)
  select
    'saida'::text                                as sentido,
    'despesa'::text                              as origem,
    d.categoria                                  as categoria,
    d.id::text                                   as origem_id,
    d.descricao                                  as descricao,
    d.valor                                      as valor,
    d.data                                       as data,
    d.metodo                                     as metodo,
    d.referencia                                 as referencia,
    null::text                                   as aluno_nome,
    null::text                                   as aluno_numero,
    null::text                                   as curso_nome,
    null::uuid                                   as edicao_id
  from public.despesas d
  where d.anulada = false;

comment on view public.vw_movimentos_financeiros is
  'Movimentos de caixa (entradas pagas e despesas activas). `edicao_id` é a edição da turma do aluno; nulo nas despesas.';
