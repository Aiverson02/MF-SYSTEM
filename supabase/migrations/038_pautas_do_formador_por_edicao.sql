-- ============================================================================
-- 038 — PAUTAS DO FORMADOR POR EDIÇÃO
-- ============================================================================
-- O painel passou a trabalhar por edições de três meses (032) e o portal do
-- formador era o último ecrã que misturava turmas de todas as edições: a RPC
-- devolvia tudo o que estava atribuído ao formador, sem selector.
--
-- Agora recebe a edição do cabeçalho (`p_edicao_id`) e devolve só as pautas das
-- turmas dessa edição. Sem argumento (ou com null) mantém o comportamento
-- anterior — todas as edições —, para outros consumidores e testes antigos
-- continuarem a funcionar.
--
-- Idempotente.
-- ============================================================================

-- A assinatura muda: sem remover a antiga ficariam duas funções `pautas_do_formador`
-- e o PostgREST recusaria a chamada por ambiguidade.
drop function if exists public.pautas_do_formador();

create function public.pautas_do_formador(p_edicao_id uuid default null)
returns table (
  pauta_id      uuid,
  turma_id      uuid,
  turma         text,
  curso         text,
  turno         public.turno,
  ano_lectivo   integer,
  avaliacao_id  uuid,
  item          text,
  tipo          text,
  peso          numeric,
  nota_maxima   numeric,
  estado        text,
  prazo         date,
  pode_editar   boolean,
  notas_lancadas integer,
  total_alunos  integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_formador uuid := public.formador_actual();
begin
  if v_formador is null then
    return;
  end if;

  return query
    select p.id,
           t.id,
           t.nome_turma,
           c.nome,
           t.turno,
           t.ano_lectivo,
           av.id,
           av.nome,
           av.tipo,
           av.peso,
           av.nota_maxima,
           p.estado,
           p.prazo,
           (p.estado = 'aberta' and (p.prazo is null or p.prazo >= current_date)) as pode_editar,
           (select count(*)::int
              from public.notas n
              join public.alunos_matriculados am on am.id = n.aluno_id
             where n.avaliacao_id = av.id and am.turma_id = t.id and n.nota is not null) as notas_lancadas,
           (select count(*)::int
              from public.alunos_matriculados am2
             where am2.turma_id = t.id
               and am2.estado_aluno <> 'trancado') as total_alunos
      from public.pautas p
      join public.turmas t on t.id = p.turma_id
      join public.cursos c on c.id = t.curso_id
      join public.avaliacoes av on av.id = p.avaliacao_id
     where (p_edicao_id is null or t.edicao_id = p_edicao_id)
       and (p.formador_id = v_formador
            or (p.formador_id is null
                and exists (select 1 from public.turma_formadores tf
                             where tf.turma_id = t.id and tf.formador_id = v_formador)))
     order by t.ano_lectivo desc, t.nome_turma, av.ordem, av.nome;
end;
$$;

comment on function public.pautas_do_formador(uuid) is
  'Pautas atribuídas ao formador autenticado; com p_edicao_id só as turmas dessa edição.';

revoke all on function public.pautas_do_formador(uuid) from public, anon;
grant execute on function public.pautas_do_formador(uuid) to authenticated;
