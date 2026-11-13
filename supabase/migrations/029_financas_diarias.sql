-- ============================================================================
-- 029 — Finanças diárias: despesas, categorias de receita e caixa por dia
-- ============================================================================
-- CONTEXTO
--   As receitas já existiam espalhadas por três tabelas (mensalidades,
--   cobranças avulsas e pós-conclusão), cada uma com a sua data de pagamento,
--   mas não havia despesas nem forma de somar tudo num dia. A secretaria
--   precisava de uma estatística diária com total bruto, despesas e líquido.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. `despesas` — registo de saídas com categoria, método, fornecedor e
--      referência. Não se apaga: anula-se (`anulada`), para o histórico
--      financeiro ficar intacto.
--   2. `cobrancas.categoria` — classificação financeira do catálogo
--      (apoio mensal, material de aula, exame, inscrição, avaliação...).
--      Backfill conservador pelo nome; o admin corrige em Configurações.
--   3. `pos_conclusao.metodo` — certificados e faixas passam a ter forma de
--      pagamento, para entrarem na separação físico/digital.
--   4. `fechos_dia` — fotografia dos totais no fecho do dia, com autor, hora
--      e notas. Serve para conferir se algo mudou depois do fecho.
--   5. Vista `vw_movimentos_financeiros` — fonte ÚNICA dos totais da página
--      e do relatório: une entradas pagas e despesas activas, com data de
--      caixa (data do pagamento), categoria, método e aluno.
--
-- REGRA DE CAIXA
--   Uma entrada conta no dia em que foi PAGA (`data_pagamento`), nunca no mês
--   de referência da mensalidade. Só `estado = 'pago'` entra; pendentes,
--   isentas e canceladas ficam de fora. Despesas anuladas também.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Categoria financeira do catálogo de cobranças
-- ---------------------------------------------------------------------------
alter table public.cobrancas
  add column if not exists categoria text not null default 'outro';

do $$ begin
  alter table public.cobrancas
    add constraint cobrancas_categoria_check check (
      categoria in ('mensalidade', 'apoio_mensal', 'material_aula', 'exame',
                    'inscricao', 'avaliacao', 'certificado', 'outro')
    );
exception when duplicate_object then null; end $$;

comment on column public.cobrancas.categoria is
  'Rubrica financeira: mensalidade, apoio_mensal, material_aula, exame, inscricao, avaliacao, certificado, outro.';

-- Backfill conservador: só toca em linhas ainda sem classificação. A ordem
-- importa — "Apoio de aula" é material de aula, "Apoio mensal" não.
update public.cobrancas
   set categoria = case
     when nome ~* 'exame' then 'exame'
     when nome ~* 'inscri' then 'inscricao'
     when nome ~* '(material|aula|uniforme|farda)' then 'material_aula'
     when nome ~* '(avalia|teste|prova)' then 'avaliacao'
     when nome ~* '(apoio|mensal)' then 'apoio_mensal'
     else categoria
   end
 where categoria = 'outro';

-- ---------------------------------------------------------------------------
-- 2. Forma de pagamento do pós-conclusão
-- ---------------------------------------------------------------------------
alter table public.pos_conclusao
  add column if not exists metodo text;

do $$ begin
  alter table public.pos_conclusao
    add constraint pos_conclusao_metodo_check check (
      metodo is null or metodo in ('numerario', 'mpesa', 'emola', 'transferencia', 'outro')
    );
exception when duplicate_object then null; end $$;

comment on column public.pos_conclusao.metodo is
  'Forma de pagamento do certificado/faixa (numerário = físico; mpesa/e-mola/transferência = digital).';

-- ---------------------------------------------------------------------------
-- 3. Despesas
-- ---------------------------------------------------------------------------
create table if not exists public.despesas (
  id           uuid primary key default gen_random_uuid(),
  data         date not null default current_date,
  categoria    text not null default 'outros'
               check (categoria in ('salarios', 'renda', 'material', 'manutencao',
                                    'transporte', 'publicidade', 'servicos',
                                    'impostos', 'outros')),
  descricao    text not null check (length(btrim(descricao)) > 0),
  valor        numeric(12,2) not null check (valor > 0),
  metodo       text check (metodo in ('numerario', 'mpesa', 'emola', 'transferencia', 'outro')),
  fornecedor   text,
  referencia   text,
  observacoes  text,
  anulada      boolean not null default false,
  anulada_em   timestamptz,
  anulada_por  uuid references auth.users(id) on delete set null,
  criado_por   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.despesas is
  'Saídas de caixa da instituição. Anular (nunca apagar) preserva o histórico.';

drop trigger if exists trg_despesas_updated on public.despesas;
create trigger trg_despesas_updated
  before update on public.despesas
  for each row execute function public.set_updated_at();

alter table public.despesas enable row level security;

drop policy if exists "despesas_staff_all" on public.despesas;
create policy "despesas_staff_all"
  on public.despesas for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

-- Sem DELETE: uma despesa anula-se, não desaparece.
revoke all on public.despesas from anon, authenticated;
grant select, insert, update on public.despesas to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Fecho do dia
-- ---------------------------------------------------------------------------
create table if not exists public.fechos_dia (
  data           date primary key,
  total_bruto    numeric(12,2) not null default 0,
  total_despesas numeric(12,2) not null default 0,
  total_liquido  numeric(12,2) not null default 0,
  notas          text,
  fechado_por    uuid references auth.users(id) on delete set null,
  fechado_em     timestamptz not null default now()
);

comment on table public.fechos_dia is
  'Fotografia dos totais no fecho do dia; comparar com o caixa actual revela alterações posteriores.';

alter table public.fechos_dia enable row level security;

drop policy if exists "fechos_dia_staff_all" on public.fechos_dia;
create policy "fechos_dia_staff_all"
  on public.fechos_dia for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

revoke all on public.fechos_dia from anon, authenticated;
grant select, insert, update on public.fechos_dia to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Índices de caixa (só as linhas que contam)
-- ---------------------------------------------------------------------------
create index if not exists idx_pagamentos_data_pago
  on public.pagamentos (data_pagamento) where estado = 'pago';
create index if not exists idx_cobrancas_alunos_data_pago
  on public.cobrancas_alunos (data_pagamento) where estado = 'pago';
create index if not exists idx_pos_conclusao_data_pago
  on public.pos_conclusao (data_pagamento) where pago;
create index if not exists idx_despesas_data_activa
  on public.despesas (data) where not anulada;

-- ---------------------------------------------------------------------------
-- 6. Vista única dos movimentos financeiros
-- ---------------------------------------------------------------------------
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
    co.nome                                      as curso_nome
  from public.pagamentos p
  join public.alunos_matriculados am on am.id = p.aluno_id
  left join public.inscricoes i on i.id = am.inscricao_id
  left join public.turmas t on t.id = am.turma_id
  left join public.cursos co on co.id = t.curso_id
  where p.estado = 'pago' and p.data_pagamento is not null

  union all

  -- Cobranças avulsas pagas (taxas, material, apoio mensal...)
  select
    'entrada', 'cobranca', coalesce(c.categoria, 'outro'), ca.id::text,
    c.nome, ca.valor, ca.data_pagamento, ca.metodo, ca.referencia,
    i.nome_completo, am.numero_estudante, co.nome
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
    'entrada', 'pos_conclusao', 'certificado', pc.id::text,
    (case when pc.item = 'faixa' then 'Faixa de graduação' else 'Certificado' end)::text,
    pc.valor, pc.data_pagamento, pc.metodo, null::text,
    i.nome_completo, am.numero_estudante, co.nome
  from public.pos_conclusao pc
  join public.alunos_matriculados am on am.id = pc.aluno_id
  left join public.inscricoes i on i.id = am.inscricao_id
  left join public.turmas t on t.id = am.turma_id
  left join public.cursos co on co.id = t.curso_id
  where pc.pago = true and pc.data_pagamento is not null

  union all

  -- Despesas activas
  select
    'saida', 'despesa', d.categoria, d.id::text, d.descricao,
    d.valor, d.data, d.metodo, d.referencia,
    null::text, null::text, null::text
  from public.despesas d
  where d.anulada = false;

comment on view public.vw_movimentos_financeiros is
  'Todos os movimentos de caixa por data de pagamento; security_invoker respeita a RLS de staff.';

revoke all on public.vw_movimentos_financeiros from anon;
grant select on public.vw_movimentos_financeiros to authenticated;
