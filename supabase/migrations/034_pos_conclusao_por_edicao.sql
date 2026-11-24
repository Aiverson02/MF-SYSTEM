-- Pós-conclusão por edição: a geração automática de cobranças passa a poder
-- limitar-se aos alunos concluídos de uma edição (a da turma da matrícula).
-- Sem argumento, mantém o comportamento anterior (todas as edições).

drop function if exists public.gerar_cobrancas_pos_conclusao();

create or replace function public.gerar_cobrancas_pos_conclusao(p_edicao_id uuid default null)
returns table (criados integer, mensagem text)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  v_cert  := coalesce(v_cert, 350);
  v_faixa := coalesce(v_faixa, 500);

  insert into public.pos_conclusao (aluno_id, item, valor)
  select am.id, 'certificado', v_cert
    from public.alunos_matriculados am
    join public.turmas t on t.id = am.turma_id
   where am.estado_aluno = 'concluido'
     and (p_edicao_id is null or t.edicao_id = p_edicao_id)
     and not exists (
           select 1 from public.pos_conclusao pc
            where pc.aluno_id = am.id and pc.item = 'certificado'
         );
  get diagnostics v_cert_n = row_count;

  insert into public.pos_conclusao (aluno_id, item, valor)
  select am.id, 'faixa', v_faixa
    from public.alunos_matriculados am
    join public.turmas t on t.id = am.turma_id
   where am.estado_aluno = 'concluido'
     and (p_edicao_id is null or t.edicao_id = p_edicao_id)
     and not exists (
           select 1 from public.pos_conclusao pc
            where pc.aluno_id = am.id and pc.item = 'faixa'
         );
  get diagnostics v_faixa_n = row_count;

  return query select
    (v_cert_n + v_faixa_n),
    case
      when (v_cert_n + v_faixa_n) = 0
        then 'Todos os alunos concluídos desta edição já tinham certificado e faixa lançados.'::text
      else format('Cobranças de pós-conclusão geradas: %s certificado(s) e %s faixa(s).', v_cert_n, v_faixa_n)
    end;
end;
$function$;

grant execute on function public.gerar_cobrancas_pos_conclusao(uuid) to authenticated;
