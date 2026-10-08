-- 009 — Anexar documentos a inscrição pendente/incompleta (página pública)
-- (aplicada via MCP; espelho do que foi executado no MFsiga)

create or replace function public.localizar_inscricao_para_docs(
  p_numero_inscricao text,
  p_numero_bi text
)
returns table (inscricao_id uuid, estado text)
language sql
security definer
set search_path = public
as $$
  select i.id, i.estado::text
    from public.inscricoes i
   where upper(i.numero_inscricao) = upper(btrim(p_numero_inscricao))
     and upper(i.numero_bi) = upper(btrim(p_numero_bi));
$$;

revoke all on function public.localizar_inscricao_para_docs(text, text) from public, authenticated;
grant execute on function public.localizar_inscricao_para_docs(text, text) to anon, authenticated;

create or replace function public.anexar_documento_inscricao(
  p_inscricao_id uuid,
  p_tipo_documento public.tipo_documento_enum,
  p_url_ficheiro text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A inscrição tem de existir e estar num estado que aceite documentos
  if not exists (
    select 1 from public.inscricoes i
     where i.id = p_inscricao_id
       and i.estado in ('pendente', 'com_pendencia', 'em_analise')
  ) then
    return null;
  end if;

  insert into public.documentos_inscricao (inscricao_id, tipo_documento, url_ficheiro, estado_validacao)
  values (p_inscricao_id, p_tipo_documento, p_url_ficheiro, false)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text) from public, authenticated;
grant execute on function public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text) to anon, authenticated;
