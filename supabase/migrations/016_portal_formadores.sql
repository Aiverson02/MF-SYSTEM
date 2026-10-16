-- ============================================================================
-- 016 — PORTAL DOS FORMADORES (+ exame de recurso, pautas e histórico de notas)
-- ============================================================================
-- Contexto das decisões tomadas com a escola (2026-10-15):
--   · 3 avaliações + exame por curso; o FORMADOR lança o exame;
--   · um curso pode ter vários formadores (turnos diferentes) → atribuição por
--     TURMA, não por curso;
--   · existe exame de RECURSO (custo adicional ainda por definir; aqui só a
--     parte académica — a cobrança entra no módulo de pagamentos quando o valor
--     for definido);
--   · os formadores têm email pessoal e recebem palavra-passe entregue em mão.
--
-- Modelo de acesso: os formadores NÃO ganham leitura directa de tabelas (não
-- vêem BI, telefone, documentos nem finanças). Tudo passa por RPCs `security
-- definer` que devolvem o mínimo — número de estudante e nome — e validam no
-- servidor: formador ↔ turma, pauta aberta, prazo e escala da nota.
--
-- CONTEÚDO
--   A. Exame de recurso (novo tipo de item + substituição da nota do exame)
--   B. Atribuição de formadores por turma (turma_formadores)
--   C. Pautas: aberta/fechada, prazo, atribuição opcional a um formador
--   D. Histórico de notas (notas_historico + trigger)
--   E. Helpers de autorização do formador
--   F. RPCs do portal
--   G. RPCs de secretaria
--   H. Contas de formador (+ correcção do `criar_utilizador_staff` da 014)
--   I. RLS + grants + higiene
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. EXAME DE RECURSO
-- ---------------------------------------------------------------------------
-- O recurso é um item como os outros (peso próprio), mas substitui a nota do
-- exame quando for melhor — é isso que a vista de resumo calcula.

alter table public.avaliacoes drop constraint if exists avaliacoes_tipo_check;
alter table public.avaliacoes
  add constraint avaliacoes_tipo_check check (tipo in ('avaliacao', 'exame', 'recurso'));

comment on column public.avaliacoes.tipo is
  'avaliacao | exame | recurso. O recurso substitui a nota do exame quando maior.';

-- Vista de resumo reescrita: média das avaliações, exame efectivo (já com o
-- recurso aplicado), a nota crua do recurso e a nota final ponderada.
create or replace view public.notas_resumo_aluno
  with (security_invoker = on)
as
with recursos as (
  select n.aluno_id, max(n.nota) as nota_recurso
    from public.notas n
    join public.avaliacoes av on av.id = n.avaliacao_id
   where av.ativo and av.tipo = 'recurso'
   group by n.aluno_id
),
itens as (
  -- Itens que contam para a nota final (o recurso não é um item extra: ele
  -- melhora o exame). GREATEST ignora NULLs, portanto o recurso também
  -- substitui um exame ainda por lançar.
  select am.id as aluno_id,
         av.id as avaliacao_id,
         av.tipo,
         av.peso,
         case when av.tipo = 'exame' then greatest(n.nota, r.nota_recurso) else n.nota end as nota
    from public.alunos_matriculados am
    join public.turmas t on t.id = am.turma_id
    join public.avaliacoes av on av.curso_id = t.curso_id and av.ativo and av.tipo <> 'recurso'
    left join public.notas n on n.aluno_id = am.id and n.avaliacao_id = av.id
    left join recursos r on r.aluno_id = am.id
),
agregado as (
  select b.aluno_id,
         count(*) filter (where b.nota is not null)::int as itens_lancados,
         count(*)::int as itens_total,
         round(sum(b.nota * b.peso) filter (where b.nota is not null and b.tipo = 'avaliacao')
               / nullif(sum(b.peso) filter (where b.nota is not null and b.tipo = 'avaliacao'), 0), 2)
           as media_avaliacoes,
         round(sum(b.nota * b.peso) filter (where b.nota is not null and b.tipo = 'exame')
               / nullif(sum(b.peso) filter (where b.nota is not null and b.tipo = 'exame'), 0), 2)
           as nota_exame,
         round(sum(b.nota * b.peso) filter (where b.nota is not null)
               / nullif(sum(b.peso) filter (where b.nota is not null), 0), 2)
           as nota_final
    from itens b
   group by b.aluno_id
)
-- Nota sobre a ordem das colunas: `create or replace view` não permite
-- reordenar nem renomear colunas, por isso `nota_recurso` entra no FIM (a 015
-- já criou a vista com as outras oito). Assim mantêm-se os grants e os
-- consumidores actuais (a lista de alunos lê por nome).
select a.aluno_id,
       a.itens_lancados,
       a.itens_total,
       a.media_avaliacoes,
       a.nota_exame,
       a.nota_final,
       (a.itens_total > 0 and a.itens_lancados = a.itens_total) as avaliacao_completa,
       (a.itens_total > 0 and a.itens_lancados = a.itens_total
        and coalesce(a.nota_final >= public.nota_minima_aprovacao(), false)) as aprovado,
       r.nota_recurso
  from agregado a
  left join recursos r on r.aluno_id = a.aluno_id;

comment on view public.notas_resumo_aluno is
  'Média das avaliações, exame efectivo (recurso aplicado), nota do recurso, nota final e estado por aluno.';

-- ---------------------------------------------------------------------------
-- B. ATRIBUIÇÃO DE FORMADORES POR TURMA
-- ---------------------------------------------------------------------------
-- Um curso pode ter formadores diferentes por turno/turma; a mesma turma pode
-- ter mais do que um (um por módulo/item). `cursos.formador_id` (004) fica como
-- estava — é a atribuição ao nível do curso, informativa.

create table if not exists public.turma_formadores (
  turma_id     uuid not null references public.turmas(id) on delete cascade,
  formador_id  uuid not null references public.formadores(id) on delete cascade,
  atribuido_em timestamptz not null default now(),
  atribuido_por uuid,
  primary key (turma_id, formador_id)
);

comment on table public.turma_formadores is
  'Formadores que leccionam uma turma (permite turnos/formadores diferentes e co-docência).';

create index if not exists idx_turma_formadores_formador on public.turma_formadores (formador_id);

-- ---------------------------------------------------------------------------
-- C. PAUTAS (aberta/fechada)
-- ---------------------------------------------------------------------------
-- Pauta = (turma, item). Só o que a secretaria abre pode ser preenchido pelo
-- formador. `formador_id` nulo = qualquer formador atribuído à turma; preenchido
-- = só aquele (útil quando o exame é lançado por um formador específico).

create table if not exists public.pautas (
  id           uuid primary key default gen_random_uuid(),
  turma_id     uuid not null references public.turmas(id) on delete cascade,
  avaliacao_id uuid not null references public.avaliacoes(id) on delete cascade,
  formador_id  uuid references public.formadores(id) on delete set null,
  estado       text not null default 'aberta' check (estado in ('aberta', 'fechada')),
  prazo        date,
  aberta_em    timestamptz not null default now(),
  aberta_por   uuid,
  fechada_em   timestamptz,
  fechada_por  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint pautas_turma_item unique (turma_id, avaliacao_id)
);

comment on table public.pautas is
  'Lançamento controlado: a secretaria abre a pauta (turma + item) ao formador e fecha-a quando termina.';

create index if not exists idx_pautas_turma on public.pautas (turma_id);
create index if not exists idx_pautas_formador on public.pautas (formador_id);

-- Quem abriu/fechou fica registado no servidor (auth.uid()), nunca pelo cliente.
create or replace function public.marcar_estado_pauta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.aberta_por := coalesce(new.aberta_por, auth.uid());
    new.aberta_em  := coalesce(new.aberta_em, now());
    if new.estado = 'fechada' then
      new.fechada_por := coalesce(new.fechada_por, auth.uid());
      new.fechada_em  := coalesce(new.fechada_em, now());
    end if;
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if new.estado = 'fechada' then
      new.fechada_por := auth.uid();
      new.fechada_em  := now();
    else
      new.aberta_por  := auth.uid();
      new.aberta_em   := now();
      new.fechada_por := null;
      new.fechada_em  := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_marcar_estado_pauta on public.pautas;
create trigger trg_marcar_estado_pauta
  before insert or update on public.pautas
  for each row execute function public.marcar_estado_pauta();

drop trigger if exists trg_pautas_updated on public.pautas;
create trigger trg_pautas_updated
  before update on public.pautas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- D. HISTÓRICO DE NOTAS (registo académico)
-- ---------------------------------------------------------------------------
-- Notas são registo académico: com formadores a lançar, uma alteração tem de
-- deixar rasto (quem, quando, valor anterior → novo). Sem grants nem policies:
-- lê-se apenas pela RPC `historico_notas_aluno` (secretaria/admin).
--
-- Nota: sem FORCE ROW LEVEL SECURITY de propósito — o dono da tabela (as RPCs
-- `security definer`) tem de a poder ler e escrever; os outros papéis ficam sem
-- acesso por falta de grants.

create table if not exists public.notas_historico (
  id            bigserial primary key,
  nota_id       uuid,
  aluno_id      uuid not null,
  avaliacao_id  uuid not null,
  accao         text not null check (accao in ('insert', 'update', 'delete')),
  nota_anterior numeric(4,2),
  nota_nova     numeric(4,2),
  formador_id   uuid,
  quem          uuid,
  quando        timestamptz not null default now()
);

comment on table public.notas_historico is
  'Rasto de todas as alterações às notas (a quem, quando, de que valor para que valor).';

create index if not exists idx_notas_historico_aluno on public.notas_historico (aluno_id, quando desc);

create or replace function public.registar_historico_nota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notas_historico (nota_id, aluno_id, avaliacao_id, accao, nota_nova, formador_id, quem)
    values (new.id, new.aluno_id, new.avaliacao_id, 'insert', new.nota, new.formador_id, auth.uid());
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.nota is distinct from old.nota
       or new.observacoes is distinct from old.observacoes
       or new.data_avaliacao is distinct from old.data_avaliacao then
      insert into public.notas_historico
        (nota_id, aluno_id, avaliacao_id, accao, nota_anterior, nota_nova, formador_id, quem)
      values (new.id, new.aluno_id, new.avaliacao_id, 'update',
              old.nota, new.nota, new.formador_id, auth.uid());
    end if;
    return new;
  end if;

  insert into public.notas_historico
    (nota_id, aluno_id, avaliacao_id, accao, nota_anterior, formador_id, quem)
  values (old.id, old.aluno_id, old.avaliacao_id, 'delete', old.nota, old.formador_id, auth.uid());
  return old;
end;
$$;

drop trigger if exists trg_historico_notas on public.notas;
create trigger trg_historico_notas
  after insert or update or delete on public.notas
  for each row execute function public.registar_historico_nota();

-- ---------------------------------------------------------------------------
-- E. HELPERS DE AUTORIZAÇÃO DO FORMADOR
-- ---------------------------------------------------------------------------

/** Id do formador correspondente ao utilizador autenticado (null se não for formador). */
create or replace function public.formador_actual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.id from public.formadores f
   where f.user_id = auth.uid() and f.ativo
   limit 1;
$$;

/** Verdadeiro quando a conta autenticada é um formador activo. */
create or replace function public.eh_formador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.formador_actual() is not null;
$$;

/** Verdadeiro quando o formador autenticado lecciona esta turma. */
create or replace function public.formador_pode_na_turma(p_turma_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.turma_formadores tf
     where tf.turma_id = p_turma_id
       and tf.formador_id = public.formador_actual()
  );
$$;

revoke all on function public.formador_actual() from public, anon;
revoke all on function public.eh_formador() from public, anon;
revoke all on function public.formador_pode_na_turma(uuid) from public, anon;
grant execute on function public.formador_actual() to authenticated;
grant execute on function public.eh_formador() to authenticated;
grant execute on function public.formador_pode_na_turma(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- F. RPCs DO PORTAL
-- ---------------------------------------------------------------------------

/** As pautas atribuídas ao formador autenticado (ou abertas às suas turmas). */
create or replace function public.pautas_do_formador()
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
     where p.formador_id = v_formador
        or (p.formador_id is null
            and exists (select 1 from public.turma_formadores tf
                         where tf.turma_id = t.id and tf.formador_id = v_formador))
     order by t.ano_lectivo desc, t.nome_turma, av.ordem, av.nome;
end;
$$;

/** Alunos de uma turma com a nota já lançada naquele item (secretaria ou formador autorizado). */
create or replace function public.pauta_da_turma(p_turma_id uuid, p_avaliacao_id uuid)
returns table (
  aluno_id        uuid,
  numero_estudante text,
  nome_completo   text,
  nota            numeric,
  data_avaliacao  date,
  observacoes     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_formador uuid := public.formador_actual();
begin
  if not public.eh_staff() then
    if v_formador is null then
      return;
    end if;
    if not exists (
      select 1 from public.pautas p
       where p.turma_id = p_turma_id
         and p.avaliacao_id = p_avaliacao_id
         and (p.formador_id = v_formador
              or (p.formador_id is null and public.formador_pode_na_turma(p_turma_id)))
    ) then
      return;
    end if;
  end if;

  return query
    select am.id,
           am.numero_estudante,
           i.nome_completo,
           n.nota,
           n.data_avaliacao,
           n.observacoes
      from public.alunos_matriculados am
      left join public.inscricoes i on i.id = am.inscricao_id
      left join public.notas n on n.aluno_id = am.id and n.avaliacao_id = p_avaliacao_id
     where am.turma_id = p_turma_id
     order by am.numero_estudante;
end;
$$;

/**
 * Gravação em lote vinda do portal do formador.
 * `p_notas` = [{"aluno_id": "...", "nota": 14.5, "data_avaliacao": "2026-10-08", "observacoes": ""}]
 * Nota `null` apaga a nota (campo esvaziado); entradas omitidas ficam como estão.
 * Valida tudo antes de escrever: se algo falhar, nada é gravado.
 */
create or replace function public.guardar_notas_pauta(
  p_turma_id uuid,
  p_avaliacao_id uuid,
  p_notas jsonb
)
returns table (sucesso boolean, mensagem text, guardadas integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_formador  uuid := public.formador_actual();
  v_pauta     public.pautas%rowtype;
  v_item      public.avaliacoes%rowtype;
  v_curso     uuid;
  v_entradas  int;
  v_guardadas int := 0;
  v_reg       record;
begin
  if v_formador is null then
    return query select false, 'Apenas formadores registados podem lançar notas por aqui.'::text, 0;
    return;
  end if;

  if p_notas is null or jsonb_typeof(p_notas) <> 'array' then
    return query select false, 'Dados inválidos.'::text, 0;
    return;
  end if;

  v_entradas := jsonb_array_length(p_notas);
  if v_entradas = 0 then
    return query select true, 'Nada para guardar.'::text, 0;
    return;
  end if;
  if v_entradas > 500 then
    return query select false, 'Demasiadas notas numa só operação.'::text, 0;
    return;
  end if;

  select av.* into v_item
    from public.avaliacoes av
   where av.id = p_avaliacao_id and av.ativo;

  if v_item.id is null then
    return query select false, 'Item de avaliação inexistente.'::text, 0;
    return;
  end if;

  select t.curso_id into v_curso from public.turmas t where t.id = p_turma_id;
  if v_curso is null then
    return query select false, 'Turma inexistente.'::text, 0;
    return;
  end if;

  if v_item.curso_id is distinct from v_curso then
    return query select false, 'O item de avaliação não pertence ao curso desta turma.'::text, 0;
    return;
  end if;

  select p.* into v_pauta
    from public.pautas p
   where p.turma_id = p_turma_id and p.avaliacao_id = p_avaliacao_id;

  if v_pauta.id is null then
    return query select false, 'Esta pauta ainda não foi aberta pela secretaria.'::text, 0;
    return;
  end if;

  if v_pauta.estado <> 'aberta' then
    return query select false, 'Pauta fechada pela secretaria — já não pode ser alterada.'::text, 0;
    return;
  end if;

  if v_pauta.prazo is not null and v_pauta.prazo < current_date then
    return query select false,
      format('O prazo desta pauta terminou a %s.', to_char(v_pauta.prazo, 'DD/MM/YYYY'))::text, 0;
    return;
  end if;

  if v_pauta.formador_id is not null then
    if v_pauta.formador_id <> v_formador then
      return query select false, 'Esta pauta está atribuída a outro formador.'::text, 0;
      return;
    end if;
  elsif not public.formador_pode_na_turma(p_turma_id) then
    return query select false, 'Não lecciona esta turma.'::text, 0;
    return;
  end if;

  -- 1) validar tudo (sem escrever nada)
  for v_reg in
    select * from jsonb_to_recordset(p_notas)
      as x(aluno_id uuid, nota numeric, data_avaliacao date, observacoes text)
  loop
    if v_reg.aluno_id is null then
      return query select false, 'Entrada sem aluno.'::text, 0;
      return;
    end if;

    if not exists (
      select 1 from public.alunos_matriculados am
       where am.id = v_reg.aluno_id and am.turma_id = p_turma_id
    ) then
      return query select false, 'Um dos alunos não pertence a esta turma.'::text, 0;
      return;
    end if;

    if v_reg.nota is not null and (v_reg.nota < 0 or v_reg.nota > v_item.nota_maxima) then
      return query select false,
        format('Nota fora do intervalo (0 a %s).', v_item.nota_maxima)::text, 0;
      return;
    end if;

    if length(coalesce(v_reg.observacoes, '')) > 500 then
      return query select false, 'Observações demasiado longas (máximo 500 caracteres).'::text, 0;
      return;
    end if;
  end loop;

  -- 2) escrever
  for v_reg in
    select * from jsonb_to_recordset(p_notas)
      as x(aluno_id uuid, nota numeric, data_avaliacao date, observacoes text)
  loop
    if v_reg.nota is null then
      delete from public.notas n
       where n.aluno_id = v_reg.aluno_id and n.avaliacao_id = p_avaliacao_id;
    else
      insert into public.notas (aluno_id, avaliacao_id, nota, data_avaliacao, observacoes, formador_id)
      values (v_reg.aluno_id, p_avaliacao_id, v_reg.nota, v_reg.data_avaliacao,
              nullif(btrim(coalesce(v_reg.observacoes, '')), ''), v_formador)
      on conflict (aluno_id, avaliacao_id) do update
        set nota           = excluded.nota,
            data_avaliacao = excluded.data_avaliacao,
            observacoes    = excluded.observacoes,
            formador_id    = excluded.formador_id;
    end if;

    v_guardadas := v_guardadas + 1;
  end loop;

  return query select true, format('%s nota(s) guardada(s).', v_guardadas)::text, v_guardadas;

exception
  -- Nota enviada com formato inválido (ex.: "15,5" em vez de 15.5)
  when invalid_text_representation or numeric_value_out_of_range then
    return query select false, 'Nota inválida — use apenas números (ex.: 14.5).'::text, 0;
end;
$$;

/** Nota final e situação dos alunos de uma turma (formador da turma ou secretaria). */
create or replace function public.resumo_turma(p_turma_id uuid)
returns table (
  aluno_id          uuid,
  numero_estudante   text,
  nome_completo     text,
  media_avaliacoes  numeric,
  nota_exame        numeric,
  nota_recurso      numeric,
  nota_final        numeric,
  avaliacao_completa boolean,
  aprovado          boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_formador uuid := public.formador_actual();
begin
  if not public.eh_staff() then
    if v_formador is null or not public.formador_pode_na_turma(p_turma_id) then
      return;
    end if;
  end if;

  return query
    select r.aluno_id,
           am.numero_estudante,
           i.nome_completo,
           r.media_avaliacoes,
           r.nota_exame,
           r.nota_recurso,
           r.nota_final,
           r.avaliacao_completa,
           r.aprovado
      from public.notas_resumo_aluno r
      join public.alunos_matriculados am on am.id = r.aluno_id
      left join public.inscricoes i on i.id = am.inscricao_id
     where am.turma_id = p_turma_id
     order by am.numero_estudante;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. RPCs DE SECRETARIA
-- ---------------------------------------------------------------------------

/** Histórico de alterações às notas de um aluno (só staff). */
create or replace function public.historico_notas_aluno(p_aluno_id uuid)
returns table (
  quando         timestamptz,
  accao          text,
  item           text,
  nota_anterior  numeric,
  nota_nova      numeric,
  autor          text,
  formador       text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.eh_staff() then
    return;
  end if;

  return query
    select h.quando,
           h.accao,
           coalesce(av.nome, '—'),
           h.nota_anterior,
           h.nota_nova,
           coalesce(u.email::text, '—'),
           coalesce(f.nome, '—')
      from public.notas_historico h
      left join public.avaliacoes av on av.id = h.avaliacao_id
      left join auth.users u on u.id = h.quem
      left join public.formadores f on f.id = h.formador_id
     where h.aluno_id = p_aluno_id
     order by h.quando desc, h.id desc
     limit 200;
end;
$$;

/** Formadores e a conta de acesso ligada (ou não) a cada um. */
create or replace function public.listar_formadores_contas()
returns table (
  formador_id  uuid,
  nome         text,
  ativo        boolean,
  user_id      uuid,
  email        text,
  ultimo_login timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.eh_staff() then
    return;
  end if;

  return query
    select f.id,
           f.nome,
           f.ativo,
           f.user_id,
           u.email::text,
           u.last_sign_in_at
      from public.formadores f
      left join auth.users u on u.id = f.user_id
     order by f.nome;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. CONTAS DE FORMADOR
-- ---------------------------------------------------------------------------

/**
 * Cria a conta de acesso do formador (email pessoal + palavra-passe entregue
 * em mão, como combinado) e liga-a ao registo do formador.
 * Alternativa sem RPC: criar em Authentication → Users e usar `ligar_conta_formador`.
 */
create or replace function public.criar_conta_formador(
  p_formador_id uuid,
  p_email text,
  p_password text
)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.eh_admin() then
    return query select false, 'Apenas o admin pode criar contas de formador.'::text;
    return;
  end if;

  if p_formador_id is null or not exists (select 1 from public.formadores f where f.id = p_formador_id) then
    return query select false, 'Formador inexistente.'::text;
    return;
  end if;

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'Email inválido.'::text;
    return;
  end if;

  if length(coalesce(p_password, '')) < 8 then
    return query select false, 'A password deve ter pelo menos 8 caracteres.'::text;
    return;
  end if;

  if exists (
    select 1 from public.formadores f
     where f.id <> p_formador_id and f.user_id is not null
       and exists (select 1 from auth.users u where u.id = f.user_id and lower(u.email) = v_email)
  ) then
    return query select false, 'Esta conta já está ligada a outro formador.'::text;
    return;
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return query select false, 'Já existe uma conta com este email — use "ligar conta existente".'::text;
    return;
  end if;

  v_uid := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'))
      || jsonb_build_object('papel', 'formador'),
    '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    provider_id, provider, user_id, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid::text, 'email', v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', false),
    now(), now(), now()
  );

  update public.formadores f set user_id = v_uid where f.id = p_formador_id;

  return query select true, format('Conta %s criada e ligada ao formador.', v_email)::text;
end;
$$;

/** Liga a um formador uma conta já existente (criada no painel Auth), garantindo o papel. */
create or replace function public.ligar_conta_formador(p_formador_id uuid, p_email text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.eh_admin() then
    return query select false, 'Apenas o admin pode ligar contas de formador.'::text;
    return;
  end if;

  if p_formador_id is null or not exists (select 1 from public.formadores f where f.id = p_formador_id) then
    return query select false, 'Formador inexistente.'::text;
    return;
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = v_email;
  if v_uid is null then
    return query select false, 'Não existe nenhuma conta com este email.'::text;
    return;
  end if;

  if exists (select 1 from public.formadores f where f.user_id = v_uid and f.id <> p_formador_id) then
    return query select false, 'Esta conta já está ligada a outro formador.'::text;
    return;
  end if;

  update auth.users u
     set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('papel', 'formador'),
         updated_at = now()
   where u.id = v_uid;

  update public.formadores f set user_id = v_uid where f.id = p_formador_id;

  return query select true, 'Conta ligada ao formador com o papel formador.'::text;
end;
$$;

/**
 * CORRECÇÃO DA 014: `criar_utilizador_staff` chamava `jsonb_array_build_text`,
 * que não existe no PostgreSQL — a criação de contas pelo painel Utilizadores
 * falhava sempre em execução. Aqui fica com `jsonb_build_array` e a recusa de
 * emails já existentes.
 */
create or replace function public.criar_utilizador_staff(p_email text, p_password text, p_papel text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  if not public.eh_admin() then
    return query select false, 'Apenas o admin pode criar utilizadores.'::text;
    return;
  end if;
  if p_papel not in ('secretaria', 'admin') then
    return query select false, 'Papel inválido (secretaria ou admin).'::text;
    return;
  end if;
  if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'Email inválido.'::text;
    return;
  end if;
  if length(coalesce(p_password, '')) < 8 then
    return query select false, 'A password deve ter pelo menos 8 caracteres.'::text;
    return;
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = lower(p_email)) then
    return query select false, 'Já existe um utilizador com este email.'::text;
    return;
  end if;

  v_uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'))
      || jsonb_build_object('papel', p_papel),
    '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    provider_id, provider, user_id, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid::text, 'email', v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(p_email), 'email_verified', false),
    now(), now(), now()
  );

  return query select true, format('Utilizador %s criado com papel %s.', lower(p_email), p_papel)::text;
end;
$$;

revoke all on function public.criar_conta_formador(uuid, text, text) from public, anon;
revoke all on function public.ligar_conta_formador(uuid, text) from public, anon;
grant execute on function public.criar_conta_formador(uuid, text, text) to authenticated;
grant execute on function public.ligar_conta_formador(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- I. RLS + GRANTS + HIGIENE
-- ---------------------------------------------------------------------------

alter table public.turma_formadores enable row level security;
alter table public.pautas          enable row level security;
alter table public.notas_historico enable row level security;

drop policy if exists "turma_formadores_staff_all" on public.turma_formadores;
create policy "turma_formadores_staff_all"
  on public.turma_formadores for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

drop policy if exists "pautas_staff_all" on public.pautas;
create policy "pautas_staff_all"
  on public.pautas for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

-- notas_historico: sem policies nem grants (só pelas RPCs definer).
revoke all on public.notas_historico from anon, authenticated;

revoke all on public.turma_formadores from anon;
revoke all on public.pautas          from anon;

grant select, insert, update, delete on public.turma_formadores to authenticated;
grant select, insert, update, delete on public.pautas          to authenticated;

-- RPCs do portal e de secretaria (as permissões reais são validadas dentro).
revoke all on function public.pautas_do_formador() from public, anon;
revoke all on function public.pauta_da_turma(uuid, uuid) from public, anon;
revoke all on function public.guardar_notas_pauta(uuid, uuid, jsonb) from public, anon;
revoke all on function public.resumo_turma(uuid) from public, anon;
revoke all on function public.historico_notas_aluno(uuid) from public, anon;
revoke all on function public.listar_formadores_contas() from public, anon;

grant execute on function public.pautas_do_formador() to authenticated;
grant execute on function public.pauta_da_turma(uuid, uuid) to authenticated;
grant execute on function public.guardar_notas_pauta(uuid, uuid, jsonb) to authenticated;
grant execute on function public.resumo_turma(uuid) to authenticated;
grant execute on function public.historico_notas_aluno(uuid) to authenticated;
grant execute on function public.listar_formadores_contas() to authenticated;

-- Funções de trigger não são chamáveis pela API.
revoke all on function public.marcar_estado_pauta() from public, anon, authenticated;
revoke all on function public.registar_historico_nota() from public, anon, authenticated;
