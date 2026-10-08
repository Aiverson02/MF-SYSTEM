-- ============================================================================
-- 002 — INTEGRAÇÃO: Matrícula transacional + leitura de papel para staff
-- ============================================================================
-- Cria a função RPC `matricular_aluno` que executa ATOMICAMENTE:
--   1. Valida que a inscrição existe e está 'aprovado';
--   2. Valida que a turma tem vagas disponíveis;
--   3. Gera um numero_estudante único (EST-<ano>-<sequencial 6 dígitos>);
--   4. Insere o registo em alunos_matriculados;
--   5. Incrementa vagas_preenchidas na turma.
-- Se qualquer passo falhar, NADA é gravado (transação única).
-- ============================================================================

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
  -- Apenas staff (mesma verificação da política RLS eh_staff)
  if not public.eh_staff() then
    return query select false, null::text, 'Acesso negado: apenas secretaria/admin.'::text;
    return;
  end if;

  -- 1. Validar inscrição
  select estado, curso_id into v_estado, v_curso_id
    from public.inscricoes
   where id = p_inscricao_id;

  if not found then
    return query select false, null::text, 'Inscrição não encontrada.'::text;
    return;
  end if;

  if v_estado <> 'aprovado' then
    return query select false, null::text,
      format('A inscrição precisa estar aprovada (estado actual: %s).', v_estado)::text;
    return;
  end if;

  -- Já matriculado?
  select exists(select 1 from public.alunos_matriculados where inscricao_id = p_inscricao_id)
    into v_ja_existe;
  if v_ja_existe then
    return query select false, null::text, 'Esta inscrição já foi matriculada.'::text;
    return;
  end if;

  -- 2. Validar turma e vagas (com lock de linha para evitar overbooking concorrente)
  select limite_vagas, vagas_preenchidas, curso_id
    into v_limite, v_preenchidas, v_curso_id
    from public.turmas
   where id = p_turma_id
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
  select coalesce(
           max(nullif(regexp_replace(numero_estudante, '^EST-[0-9]{4}-', ''), '')::bigint),
           0
         ) + 1
    into v_seq
    from public.alunos_matriculados
   where numero_estudante like 'EST-' || v_ano || '-%';

  v_numero := format('EST-%s-%s', v_ano, lpad(v_seq::text, 6, '0'));

  -- 4. Inserir matrícula
  insert into public.alunos_matriculados (inscricao_id, numero_estudante, turma_id, data_matricula, estado_aluno)
  values (p_inscricao_id, v_numero, p_turma_id, current_date, 'ativo');

  -- 5. Incrementar vagas
  update public.turmas
     set vagas_preenchidas = vagas_preenchidas + 1
   where id = p_turma_id;

  return query select true, v_numero, 'Matrícula efectuada com sucesso.'::text;
end;
$$;

revoke all on function public.matricular_aluno(uuid, uuid) from public, anon;
grant execute on function public.matricular_aluno(uuid, uuid) to authenticated;
