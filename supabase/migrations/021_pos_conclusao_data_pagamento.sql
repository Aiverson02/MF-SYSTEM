-- ============================================================================
-- 021 — Pós-conclusão: registar QUANDO o certificado/faixa foi pago
-- ============================================================================
-- Problema relatado (2026-10-16): marcar um certificado como pago em
-- Pós-Conclusão não mexia em nenhum valor da página de Pagamentos.
--
-- Causa: `pos_conclusao.pago` é um simples boolean, sem data. Sem data não há
-- como atribuir o valor a um mês — e a página de Pagamentos trabalha por mês.
-- Ficam então duas colunas (data_pagamento, pago_por) e um trigger que as
-- preenche no servidor, para contar mesmo quando o pagamento é registado
-- offline e chega pela fila de sincronização.
-- ============================================================================

alter table public.pos_conclusao add column if not exists data_pagamento date;
alter table public.pos_conclusao add column if not exists pago_por uuid references auth.users(id) on delete set null;

comment on column public.pos_conclusao.data_pagamento is
  'Data em que o item foi marcado como pago — usada para somar o valor no mês certo. (021)';
comment on column public.pos_conclusao.pago_por is
  'Conta que registou o pagamento ( apoio à auditoria interna). (021)';

create or replace function public.registar_pagamento_pos_conclusao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pago then
    -- Só na passagem para pago: reeditar uma linha já paga não muda a data.
    if tg_op = 'INSERT' or not coalesce(old.pago, false) then
      new.data_pagamento := coalesce(new.data_pagamento, current_date);
      new.pago_por := coalesce(new.pago_por, auth.uid());
    end if;
  else
    new.data_pagamento := null;
    new.pago_por := null;
  end if;
  return new;
end;
$$;

comment on function public.registar_pagamento_pos_conclusao() is
  'Preenche data_pagamento/pago_por quando pago passa a true e limpa-os ao desfazer. (021)';

drop trigger if exists trg_pos_conclusao_pagamento on public.pos_conclusao;
create trigger trg_pos_conclusao_pagamento
  before insert or update of pago on public.pos_conclusao
  for each row execute function public.registar_pagamento_pos_conclusao();

-- A função só serve o trigger.
revoke all on function public.registar_pagamento_pos_conclusao() from public, anon, authenticated;

-- Retroactivo: quem já estava marcado como pago fica com a data da última
-- alteração do registo (a melhor informação disponível).
update public.pos_conclusao
   set data_pagamento = coalesce(data_pagamento, updated_at::date)
 where pago
   and data_pagamento is null;

create index if not exists idx_pos_conclusao_pagamento
  on public.pos_conclusao (data_pagamento)
  where pago;
