-- ===========================================================================
-- 028 — Cobrança automática de pós-conclusão (certificados e faixas)
-- ===========================================================================
-- CONTEXTO
--   O trigger `criar_pos_conclusao` (010) lança certificado + faixa quando uma
--   matrícula passa a `concluido`. Isso só cobre o momento da mudança de
--   estado: quem já estava concluído antes do valor ser configurado — ou cuja
--   linha foi apagada — fica sem cobrança e não havia forma de recuperar em
--   massa na interface.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. `gerar_cobrancas_pos_conclusao()` cria, numa só chamada, as linhas de
--      `pos_conclusao` em falta (certificado e faixa) para todos os alunos
--      concluídos, com os valores de `config_instituicao`
--      (fallback 350/500, os mesmos do trigger).
--      - Idempotente: `unique (aluno_id, item)` + `not exists` — correr duas
--        vezes não duplica nem mexe em linhas já existentes (nem no `pago`).
--      - Nunca altera valores já lançados: dívidas registadas ficam como estão.
--   2. Devolve `(criados, mensagem)` para a interface poder dizer o que fez.
--   3. Só staff (secretaria/admin) executa; anon não tem EXECUTE.
-- ===========================================================================

create or replace function public.gerar_cobrancas_pos_conclusao()
returns table (criados integer, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cert    numeric(12,2);
  v_faixa   numeric(12,2);
  v_cert_n  integer := 0;
  v_faixa_n integer := 0;
begin
  if not public.eh_staff() then
    return query select 0, 'Acesso negado: apenas secretaria/admin.'::text;
    return;
  end if;

  select ci.valor_certificado, ci.valor_faixa
    into v_cert, v_faixa
    from public.config_instituicao ci
   where ci.id = 1;

  -- Mesmos valores por omissão do trigger 010 quando ainda não há configuração.
  v_cert  := coalesce(v_cert, 350);
  v_faixa := coalesce(v_faixa, 500);

  insert into public.pos_conclusao (aluno_id, item, valor)
  select am.id, 'certificado', v_cert
    from public.alunos_matriculados am
   where am.estado_aluno = 'concluido'
     and not exists (
           select 1 from public.pos_conclusao pc
            where pc.aluno_id = am.id and pc.item = 'certificado'
         );
  get diagnostics v_cert_n = row_count;

  insert into public.pos_conclusao (aluno_id, item, valor)
  select am.id, 'faixa', v_faixa
    from public.alunos_matriculados am
   where am.estado_aluno = 'concluido'
     and not exists (
           select 1 from public.pos_conclusao pc
            where pc.aluno_id = am.id and pc.item = 'faixa'
         );
  get diagnostics v_faixa_n = row_count;

  return query select
    (v_cert_n + v_faixa_n),
    case
      when (v_cert_n + v_faixa_n) = 0
        then 'Todos os alunos concluídos já tinham certificado e faixa lançados.'::text
      else format(
        'Cobranças de pós-conclusão geradas: %s certificado(s) e %s faixa(s).',
        v_cert_n, v_faixa_n
      )
    end;
end;
$$;

revoke all on function public.gerar_cobrancas_pos_conclusao() from public, anon;
grant execute on function public.gerar_cobrancas_pos_conclusao() to authenticated;
