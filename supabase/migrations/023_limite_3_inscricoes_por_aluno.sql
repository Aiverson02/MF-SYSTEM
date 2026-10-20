-- ============================================================================
-- 023 — Limite de 3 inscrições activas por aluno (BI)
-- ============================================================================
-- Pedido da secretaria (2026-10-19): "na inscrição, permita que cada aluno
-- faça no máximo 3 cursos ao mesmo tempo".
--
-- Antes desta migração a RPC pública recusava QUALQUER segunda inscrição do
-- mesmo BI (regra antiga de "BI único"). Agora um candidato concorre a até 3
-- cursos em simultâneo; a 4ª inscrição activa é recusada com mensagem clara.
--
--   · Contam as inscrições com estado diferente de 'rejeitado'
--     (pendente, em_analise, aprovado, com_pendencia).
--   · Inscrições rejeitadas libertam a vaga — o candidato pode tentar de novo.
--   · Duplicado do MESMO curso continua bloqueado enquanto activo.
--
-- Regra viva no servidor, em dois níveis (defesa em profundidade, à moda da
-- 014): trigger em `inscricoes` — cobre escrita directa e qualquer via futura
-- — e pré-verificação na RPC `submeter_inscricao_publica`, que falha cedo,
-- antes de ocupar o advisory lock do número de inscrição. As duas verificações
-- correm fora de lock; por isso o trigger volta a validar dentro da transacção
-- da escrita e fecha a janela de corrida.
-- ============================================================================

create or replace function public.validar_limite_inscricoes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_bi      text := upper(btrim(new.numero_bi));
  v_activas integer;
begin
  if v_bi = '' then
    return new;
  end if;

  -- Uma linha rejeitada não ocupa vaga (nem no INSERT nem ao mudar de estado).
  if new.estado = 'rejeitado' then
    return new;
  end if;

  -- Inscrições activas já existentes deste BI, em cursos distintos.
  -- (new.id já está definido: os defaults correm antes dos triggers BEFORE.)
  select count(distinct i.curso_id)
    into v_activas
    from public.inscricoes i
   where upper(btrim(i.numero_bi)) = v_bi
     and i.estado <> 'rejeitado'
     and i.id <> new.id;

  if v_activas >= 3 then
    raise exception
      'Limite de inscrições atingido: cada aluno pode inscrever-se no máximo 3 cursos em simultâneo.'
      using errcode = 'check_violation';
  end if;

  -- Mesmo BI no mesmo curso, enquanto activo: duplicado.
  if exists (
    select 1
      from public.inscricoes i
     where upper(btrim(i.numero_bi)) = v_bi
       and i.curso_id = new.curso_id
       and i.estado <> 'rejeitado'
       and i.id <> new.id
  ) then
    raise exception
      'Já existe uma inscrição activa deste BI para este curso.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_limite_inscricoes on public.inscricoes;
create trigger trg_validar_limite_inscricoes
  before insert or update of numero_bi, curso_id, estado on public.inscricoes
  for each row execute function public.validar_limite_inscricoes();

-- A função só serve o trigger (higiene, como nas 014/015/021).
revoke all on function public.validar_limite_inscricoes() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- RPC pública: substituir a regra antiga de "BI único" pelo limite de 3
-- ----------------------------------------------------------------------------
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
  v_activas  integer;
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

  -- Limite de 3 cursos activos por BI (o trigger repete a verificação dentro
  -- da transacção; aqui falha cedo, antes do advisory lock).
  select count(distinct i.curso_id)
    into v_activas
    from public.inscricoes i
   where upper(btrim(i.numero_bi)) = upper(btrim(p_numero_bi))
     and i.estado <> 'rejeitado';

  if v_activas >= 3 then
    raise exception
      'Limite de inscrições atingido: cada aluno pode inscrever-se no máximo 3 cursos em simultâneo.'
      using errcode = 'check_violation';
  end if;

  -- Mesmo BI no mesmo curso, enquanto activo: duplicado.
  if exists (
    select 1
      from public.inscricoes i
     where upper(btrim(i.numero_bi)) = upper(btrim(p_numero_bi))
       and i.curso_id = p_curso_id
       and i.estado <> 'rejeitado'
  ) then
    raise exception
      'Já existe uma inscrição activa deste BI para este curso.'
      using errcode = 'check_violation';
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
