-- 006 — RPC pública para submissão do site + origem da inscrição
-- (aplicada via MCP; espelho do que foi executado no MFsiga)

alter table public.inscricoes
  add column if not exists origem text not null default 'presencial';

create or replace function public.submeter_inscricao_publica(
  p_nome_completo      text default null,
  p_numero_bi          text default null,
  p_data_nascimento    date default null,
  p_genero             text default null,
  p_email              text default null,
  p_telefone_whatsapp  text default null,
  p_curso_id           uuid default null,
  p_turno_pretendido   public.turno default null
)
returns table (numero_inscricao text, inscricao_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_seq      bigint;
  v_ano      integer := extract(year from now())::int;
  v_numero   text;
begin
  if nullif(btrim(p_nome_completo), '') is null
     or nullif(btrim(p_numero_bi), '') is null
     or nullif(btrim(p_telefone_whatsapp), '') is null
     or p_data_nascimento is null
     or p_curso_id is null
     or p_turno_pretendido is null then
    return query select null::text, null::uuid;
    return;
  end if;

  -- BI único: um candidato não se inscreve duas vezes com o mesmo BI
  if exists (select 1 from public.inscricoes i where upper(i.numero_bi) = upper(p_numero_bi)) then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Curso tem de existir e estar activo
  if not exists (select 1 from public.cursos c where c.id = p_curso_id and c.ativo) then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Mesmo lock do trigger para serializar a geração do número
  perform pg_advisory_xact_lock(hashtext('gerar_numero_inscricao'));

  select coalesce(
           max(nullif(regexp_replace(i.numero_inscricao, '^INS-[0-9]{4}-', ''), '')::bigint),
           0
         ) + 1
    into v_seq
    from public.inscricoes i
   where i.numero_inscricao like 'INS-' || v_ano || '-%';

  v_numero := format('INS-%s-%s', v_ano, lpad(v_seq::text, 6, '0'));

  insert into public.inscricoes
    (numero_inscricao, nome_completo, numero_bi, data_nascimento, genero,
     email, telefone_whatsapp, curso_id, turno_pretendido, estado, origem)
  values
    (v_numero, btrim(p_nome_completo), upper(btrim(p_numero_bi)), p_data_nascimento, p_genero,
     nullif(btrim(p_email), ''), btrim(p_telefone_whatsapp), p_curso_id, p_turno_pretendido, 'pendente', 'online')
  returning id into v_id;

  return query select v_numero, v_id;
end;
$$;

revoke all on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  from public, authenticated;
grant execute on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  to anon, authenticated;
