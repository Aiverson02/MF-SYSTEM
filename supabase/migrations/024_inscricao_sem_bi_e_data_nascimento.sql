-- ============================================================================
-- 024 — Inscrição sem data de nascimento, BI opcional, identidade nome+celular
-- ============================================================================
-- Pedido da secretaria (2026-10-20):
--   · o número de BI passa a ser OPCIONAL — "mesmo que a pessoa faça inscrição
--     e não coloque número de BI não tem problema";
--   · remover também o campo data de nascimento do formulário;
--   · escolher até 3 cursos no mesmo formulário (o cliente submete até 3
--     inscrições com os mesmos dados — uma por curso; a regra do servidor
--     continua a ser por inscrição/curso).
--
-- Identidade para o limite de 3 cursos sem BI: **nome completo + telefone**
-- (normalizado, só dígitos), como pedido — "por nome e numero de celular".
-- A comparação é um OU: o BI quando existe, OU o par nome+telefone. Assim a
-- mesma pessoa é encontrada mesmo que uma submissão tenha BI e outra não, e
-- simplesmente não preencher o BI já não contorna o limite.
--
-- Colunas afectadas: `numero_bi` e `data_nascimento` deixam de ser NOT NULL.
-- Nada na UI mostra obrigatórios estes campos nos registos antigos; a ficha
-- mostra "—" quando vazios.
-- ============================================================================

alter table public.inscricoes alter column numero_bi drop not null;
alter table public.inscricoes alter column data_nascimento drop not null;

comment on column public.inscricoes.numero_bi is
  'Opcional desde a 024. Para o limite de 3 cursos a identidade é BI OU nome+telefone.';
comment on column public.inscricoes.data_nascimento is
  'Opcional desde a 024 — o formulário público já não pede a data de nascimento.';

-- ----------------------------------------------------------------------------
-- Trigger: limite de 3 + duplicado do curso, com identidade nome+celular
-- ----------------------------------------------------------------------------
create or replace function public.validar_limite_inscricoes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_bi      text := nullif(upper(btrim(coalesce(new.numero_bi, ''))), '');
  v_nome    text := upper(btrim(coalesce(new.nome_completo, '')));
  v_tel     text := regexp_replace(coalesce(new.telefone_whatsapp, ''), '\D', '', 'g');
  v_activas integer;
begin
  if v_bi is null and (v_nome = '' or v_tel = '') then
    return new;
  end if;

  -- Uma linha rejeitada não ocupa vaga (nem no INSERT nem ao mudar de estado).
  if new.estado = 'rejeitado' then
    return new;
  end if;

  -- Inscrições activas do mesmo aluno (BI ou nome+celular), em cursos distintos.
  -- (new.id já está definido: os defaults correm antes dos triggers BEFORE.)
  select count(distinct i.curso_id)
    into v_activas
    from public.inscricoes i
   where i.estado <> 'rejeitado'
     and i.id <> new.id
     and (
           (v_bi is not null and upper(btrim(i.numero_bi)) = v_bi)
        or (v_tel <> ''
            and v_nome <> ''
            and upper(btrim(i.nome_completo)) = v_nome
            and regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel)
         );

  if v_activas >= 3 then
    raise exception
      'Limite de inscrições atingido: cada aluno pode inscrever-se no máximo 3 cursos em simultâneo.'
      using errcode = 'check_violation';
  end if;

  -- Mesmo aluno no mesmo curso, enquanto activo: duplicado.
  if exists (
    select 1
      from public.inscricoes i
     where i.estado <> 'rejeitado'
       and i.id <> new.id
       and i.curso_id = new.curso_id
       and (
             (v_bi is not null and upper(btrim(i.numero_bi)) = v_bi)
          or (v_tel <> ''
              and v_nome <> ''
              and upper(btrim(i.nome_completo)) = v_nome
              and regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel)
           )
  ) then
    raise exception
      'Já existe uma inscrição activa deste aluno para este curso.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Nome/telefone entram na lista de colunas que disparam a validação: alterar a
-- identidade de uma linha activa também tem de respeitar o limite.
drop trigger if exists trg_validar_limite_inscricoes on public.inscricoes;
create trigger trg_validar_limite_inscricoes
  before insert or update of numero_bi, nome_completo, telefone_whatsapp, curso_id, estado
  on public.inscricoes
  for each row execute function public.validar_limite_inscricoes();

-- A função só serve o trigger (higiene, como nas 014/015/021/023).
revoke all on function public.validar_limite_inscricoes() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- RPC pública: BI e data de nascimento opcionais, limite por nome+celular
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
  v_bi       text := nullif(upper(btrim(coalesce(p_numero_bi, ''))), '');
  v_nome     text := upper(btrim(coalesce(p_nome_completo, '')));
  v_tel      text := regexp_replace(coalesce(p_telefone_whatsapp, ''), '\D', '', 'g');
  v_activas  integer;
begin
  -- Limites de tamanho (anti-abuso: strings gigantes nunca tocam a BD)
  if length(coalesce(p_nome_completo, '')) > 200
     or length(coalesce(p_numero_bi, '')) > 32
     or length(coalesce(p_telefone_whatsapp, '')) > 32
     or length(coalesce(p_email, '')) > 254
     or (p_genero is not null and length(p_genero) > 16)
     or (p_data_nascimento is not null
         and (p_data_nascimento > current_date or p_data_nascimento < date '1900-01-01')) then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Obrigatórios: nome, telefone e curso/turno. BI e data de nascimento
  -- são opcionais desde a 024.
  if v_nome = ''
     or nullif(btrim(p_telefone_whatsapp), '') is null
     or p_curso_id is null
     or p_turno_pretendido is null then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Limite de 3 cursos activos por aluno — identidade: BI OU nome+celular
  -- (o trigger repete a verificação dentro da transacção; aqui falha cedo,
  -- antes do advisory lock).
  select count(distinct i.curso_id)
    into v_activas
    from public.inscricoes i
   where i.estado <> 'rejeitado'
     and (
           (v_bi is not null and upper(btrim(i.numero_bi)) = v_bi)
        or (v_tel <> ''
            and upper(btrim(i.nome_completo)) = v_nome
            and regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel)
         );

  if v_activas >= 3 then
    raise exception
      'Limite de inscrições atingido: cada aluno pode inscrever-se no máximo 3 cursos em simultâneo.'
      using errcode = 'check_violation';
  end if;

  -- Mesmo aluno no mesmo curso, enquanto activo: duplicado.
  if exists (
    select 1
      from public.inscricoes i
     where i.estado <> 'rejeitado'
       and i.curso_id = p_curso_id
       and (
             (v_bi is not null and upper(btrim(i.numero_bi)) = v_bi)
          or (v_tel <> ''
              and upper(btrim(i.nome_completo)) = v_nome
              and regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel)
           )
  ) then
    raise exception
      'Já existe uma inscrição activa deste aluno para este curso.'
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
    (v_numero, btrim(p_nome_completo), v_bi, p_data_nascimento, nullif(btrim(p_genero), ''),
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
