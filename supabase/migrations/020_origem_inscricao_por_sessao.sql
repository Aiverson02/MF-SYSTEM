-- ============================================================================
-- 020 — Origem da inscrição decidida pela sessão + correcção da inscrição manual
-- ============================================================================
-- Bug relatado (2026-10-16): uma inscrição registada à mão pela secretaria
-- apareceu no grupo "Do site" (Candidaturas Online).
--
-- Causa: o botão *Nova Inscrição* do painel reutiliza o mesmo formulário do
-- site, que submete pela RPC `submeter_inscricao_publica` — e essa RPC gravava
-- sempre `origem = 'online'` (006/014). O valor certo depende de quem chama:
--
--   · visitante sem sessão (site)            → 'online'
--   · conta com papel staff a registar       → 'presencial'
--
-- A decisão passa a ser tomada no servidor por `public.eh_staff()`, que lê o
-- papel de `app_metadata` — o cliente não escolhe nem consegue falsificar a
-- origem. Formadores (e qualquer outra conta não-staff) continuam 'online'.
-- ============================================================================

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
  v_origem   text;
begin
  -- Limites de tamanho (anti-abuso: strings gigantes nunca tocam a BD)
  if length(coalesce(p_nome_completo, '')) > 200
     or length(coalesce(p_numero_bi, '')) > 32
     or length(coalesce(p_telefone_whatsapp, '')) > 32
     or length(coalesce(p_email, '')) > 254
     or (p_genero is not null and length(p_genero) > 16) then
    return query select null::text, null::uuid;
    return;
  end if;

  if nullif(btrim(p_nome_completo), '') is null
     or nullif(btrim(p_numero_bi), '') is null
     or nullif(btrim(p_telefone_whatsapp), '') is null
     or p_data_nascimento is null
     or p_curso_id is null
     or p_turno_pretendido is null then
    return query select null::text, null::uuid;
    return;
  end if;

  -- BI duplicado
  if exists (select 1 from public.inscricoes i where upper(i.numero_bi) = upper(btrim(p_numero_bi))) then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Curso activo
  if not exists (select 1 from public.cursos c where c.id = p_curso_id and c.ativo) then
    return query select null::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('gerar_numero_inscricao'));

  select coalesce(
           max(nullif(regexp_replace(i.numero_inscricao, '^INS-[0-9]{4}-', ''), '')::bigint),
           0
         ) + 1
    into v_seq
    from public.inscricoes i
   where i.numero_inscricao like 'INS-' || v_ano || '-%';

  v_numero := format('INS-%s-%s', v_ano, lpad(v_seq::text, 6, '0'));

  -- Quem está a registar decide a origem: staff = presencial, visitante = online.
  v_origem := case when public.eh_staff() then 'presencial' else 'online' end;

  insert into public.inscricoes
    (numero_inscricao, nome_completo, numero_bi, data_nascimento, genero,
     email, telefone_whatsapp, curso_id, turno_pretendido, estado, origem)
  values
    (v_numero, btrim(p_nome_completo), upper(btrim(p_numero_bi)), p_data_nascimento, nullif(btrim(p_genero), ''),
     nullif(btrim(p_email), ''), btrim(p_telefone_whatsapp), p_curso_id, p_turno_pretendido,
     'pendente', v_origem)
  returning id into v_id;

  return query select v_numero, v_id;
end;
$$;

revoke all on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  from public, authenticated;
grant execute on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Correcção pontual: a inscrição registada à mão que ficou gravada como 'online'
-- ---------------------------------------------------------------------------
-- Só existe uma inscrição anterior a esta migração e é a que foi criada no
-- painel (o formulário do site não teve tráfego). A correcção é explícita e
-- inofensiva se o número não existir noutro ambiente.
update public.inscricoes
   set origem = 'presencial'
 where numero_inscricao = 'INS-2026-000001'
   and origem = 'online';
