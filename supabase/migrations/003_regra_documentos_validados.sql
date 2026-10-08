-- ============================================================================
-- 003 — REGRA DE NEGÓCIO: aprovação exige todos os documentos validados
-- ============================================================================
-- Regra: uma inscrição só pode passar a estado 'aprovado' se TODOS os seus
-- documentos em `documentos_inscricao` tiverem estado_validacao = true.
-- (Inscrições sem documentos anexados podem ser aprovadas — a secretaria
--  decide; para exigir documentos, ver comentário no fim do ficheiro.)
-- Funciona via UI (update directo) e via futuras RPCs.
-- ============================================================================

create or replace function public.validar_aprovacao_documentos()
returns trigger
language plpgsql
as $$
declare
  v_total    integer;
  v_validados integer;
begin
  if new.estado = 'aprovado' and (tg_op = 'INSERT' or old.estado <> 'aprovado') then
    select count(*),
           count(*) filter (where estado_validacao)
      into v_total, v_validados
      from public.documentos_inscricao
     where inscricao_id = new.id;

    if v_total > 0 and v_validados < v_total then
      raise exception
        'Aprovação bloqueada: % de % documento(s) ainda sem validação. Valide todos os documentos antes de aprovar.',
        (v_total - v_validados), v_total
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_aprovacao_documentos on public.inscricoes;
create trigger trg_validar_aprovacao_documentos
  before insert or update of estado on public.inscricoes
  for each row execute function public.validar_aprovacao_documentos();

-- ----------------------------------------------------------------------------
-- OPCIONAL: exigir pelo menos 1 documento para aprovar. Para activar, descomente:
-- ----------------------------------------------------------------------------
-- create or replace function public.exigir_documento_minimo()
-- returns trigger language plpgsql as $$
-- begin
--   if new.estado = 'aprovado' then
--     if not exists (select 1 from public.documentos_inscricao where inscricao_id = new.id) then
--       raise exception 'Aprovação bloqueada: a inscrição não tem documentos anexados.';
--     end if;
--   end if;
--   return new;
-- end;
-- $$;
-- create trigger trg_exigir_documento_minimo
--   before insert or update of estado on public.inscricoes
--   for each row execute function public.exigir_documento_minimo();
