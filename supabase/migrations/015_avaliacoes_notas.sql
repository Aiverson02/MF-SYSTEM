-- ============================================================================
-- 015 — AVALIAÇÕES E NOTAS (lançamento na secretaria + base do portal dos
--        formadores)
-- ============================================================================
-- O que fica criado:
--
--   avaliacoes  — catálogo de itens de avaliação POR CURSO (ex.: "Avaliação 1",
--                 "Exame Final"), com tipo ('avaliacao' | 'exame'), peso e nota
--                 máxima. É a definição; a nota pertence ao aluno.
--   notas       — uma linha por (aluno, item de avaliação) com a nota, a data
--                 da prova, o formador que leccionou e quem lançou no sistema.
--                 UNIQUE (aluno_id, avaliacao_id) → o cliente pode fazer
--                 upsert sem risco de duplicar.
--   notas_resumo_aluno — vista com média das avaliações, nota do exame, nota
--                 final ponderada e estado (completa/aprovado). É a única
--                 fonte da fórmula: a lista de alunos e o futuro portal dos
--                 formadores lêem daqui, para os números nunca divergirem.
--
-- Fórmula (documentada uma só vez, na vista):
--   nota_final = Σ(nota × peso) / Σ(peso)  sobre os itens JÁ lançados, contando
--   avaliações e exame. Assim o exame pesa o que o seu peso disser no catálogo
--   (padrão criado por `criar_avaliacoes_padrao`: 3 avaliações peso 1 + exame
--   peso 2 → exame = 40% da nota final), sem constantes escondidas no código.
--   Aprovado = todos os itens activos lançados E nota final ≥ 10 (escala 0–20).
--
-- Preparação do PORTAL DOS FORMADORES (fase seguinte, sem UI aqui):
--   formadores.user_id liga o formador a uma conta de autenticação. Quando o
--   portal existir, basta (a) criar essas contas e ligá-las, e (b) acrescentar
--   uma policy de `notas` que permita escrita quando o curso do aluno tem
--   `cursos.formador_id = formadores.id and formadores.user_id = auth.uid()`.
--   Nada do que está aqui tem de ser refeito: os lançamentos feitos pelo
--   formador ficam com a mesma autoria (`lancado_por`) e a mesma validação.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. CATÁLOGO DE AVALIAÇÕES (por curso)
-- ---------------------------------------------------------------------------

create table if not exists public.avaliacoes (
  id           uuid primary key default gen_random_uuid(),
  curso_id     uuid not null references public.cursos(id) on delete cascade,
  nome         text not null,
  tipo         text not null default 'avaliacao' check (tipo in ('avaliacao', 'exame')),
  peso         numeric(5,2) not null default 1 check (peso > 0),
  nota_maxima  numeric(4,2) not null default 20 check (nota_maxima > 0),
  ordem        integer not null default 0,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint avaliacoes_nome_por_curso unique (curso_id, nome)
);

comment on table public.avaliacoes is 'Catálogo de itens de avaliação de um curso (avaliações e exame final).';
comment on column public.avaliacoes.peso is 'Peso relativo na nota final (Σ nota×peso / Σ peso).';
comment on column public.avaliacoes.nota_maxima is 'Escala da nota (0–20 por omissão).';

create index if not exists idx_avaliacoes_curso on public.avaliacoes (curso_id, ordem);
create index if not exists idx_avaliacoes_tipo on public.avaliacoes (curso_id, tipo);

-- ---------------------------------------------------------------------------
-- B. NOTAS DOS ALUNOS
-- ---------------------------------------------------------------------------

create table if not exists public.notas (
  id            uuid primary key default gen_random_uuid(),
  aluno_id      uuid not null references public.alunos_matriculados(id) on delete cascade,
  avaliacao_id  uuid not null references public.avaliacoes(id) on delete cascade,
  nota          numeric(4,2) check (nota is null or nota >= 0),
  data_avaliacao date,
  formador_id   uuid references public.formadores(id) on delete set null,
  observacoes   text,
  -- Autoria: preenchida pelo trigger (auth.uid()), nunca pelo cliente.
  lancado_por   uuid,
  lancado_em    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint notas_aluno_avaliacao unique (aluno_id, avaliacao_id)
);

comment on table public.notas is 'Notas de um aluno por item de avaliação (avaliações intermédias e exame).';
comment on column public.notas.formador_id is 'Formador que leccionou/avaliou o item (portal dos formadores).';
comment on column public.notas.lancado_por is 'Conta que registou a nota no sistema (secretaria ou formador).';

create index if not exists idx_notas_aluno on public.notas (aluno_id);
create index if not exists idx_notas_avaliacao on public.notas (avaliacao_id);
create index if not exists idx_notas_formador on public.notas (formador_id);

-- ---------------------------------------------------------------------------
-- C. INTEGRIDADE: escala da nota e coerência aluno ↔ curso da avaliação
-- ---------------------------------------------------------------------------

create or replace function public.validar_nota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max         numeric;
  v_curso_item  uuid;
  v_curso_aluno uuid;
begin
  select av.nota_maxima, av.curso_id
    into v_max, v_curso_item
    from public.avaliacoes av
   where av.id = new.avaliacao_id;

  if v_max is null then
    raise exception 'Item de avaliação inexistente.'; 
  end if;

  if new.nota is not null and new.nota > v_max then
    raise exception 'Nota inválida: o máximo deste item é %.', v_max;
  end if;

  select t.curso_id
    into v_curso_aluno
    from public.alunos_matriculados am
    join public.turmas t on t.id = am.turma_id
   where am.id = new.aluno_id;

  if v_curso_aluno is null then
    raise exception 'Aluno inexistente.';
  end if;

  if v_curso_aluno is distinct from v_curso_item then
    raise exception 'O item de avaliação não pertence ao curso deste aluno.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_nota on public.notas;
create trigger trg_validar_nota
  before insert or update on public.notas
  for each row execute function public.validar_nota();

-- Autoria do lançamento: sempre o utilizador autenticado na escrita.
create or replace function public.marcar_autoria_nota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.lancado_por := coalesce(auth.uid(), new.lancado_por);
    new.lancado_em  := coalesce(new.lancado_em, now());
  else
    new.lancado_por := coalesce(auth.uid(), new.lancado_por);
    new.lancado_em  := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_autoria_nota on public.notas;
create trigger trg_autoria_nota
  before insert or update on public.notas
  for each row execute function public.marcar_autoria_nota();

drop trigger if exists trg_notas_updated on public.notas;
create trigger trg_notas_updated
  before update on public.notas
  for each row execute function public.set_updated_at();

drop trigger if exists trg_avaliacoes_updated on public.avaliacoes;
create trigger trg_avaliacoes_updated
  before update on public.avaliacoes
  for each row execute function public.set_updated_at();

-- Funções de trigger: não são chamáveis pela API (higiene, como na 014).
revoke all on function public.validar_nota()        from public, anon, authenticated;
revoke all on function public.marcar_autoria_nota() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. NOTA MÍNIMA DE APROVAÇÃO (um só sítio para ajustar)
-- ---------------------------------------------------------------------------

create or replace function public.nota_minima_aprovacao()
returns numeric
language sql
immutable
as $$ select 10::numeric $$;

comment on function public.nota_minima_aprovacao() is
  'Nota mínima de aprovação na escala 0–20. Alterar aqui muda a vista e a UI.';

revoke all on function public.nota_minima_aprovacao() from anon;
grant execute on function public.nota_minima_aprovacao() to authenticated;

-- ---------------------------------------------------------------------------
-- E. VISTA DE RESUMO (fonte única da fórmula)
-- ---------------------------------------------------------------------------

create or replace view public.notas_resumo_aluno
  with (security_invoker = on)
as
select r.aluno_id,
       r.itens_lancados,
       r.itens_total,
       r.media_avaliacoes,
       r.nota_exame,
       r.nota_final,
       (r.itens_total > 0 and r.itens_lancados = r.itens_total) as avaliacao_completa,
       (r.itens_total > 0 and r.itens_lancados = r.itens_total
        and coalesce(r.nota_final >= public.nota_minima_aprovacao(), false)) as aprovado
  from (
    select b.aluno_id,
           count(*) filter (where b.nota is not null)::int  as itens_lancados,
           count(*)::int                                    as itens_total,
           round(sum(b.nota * b.peso) filter (where b.nota is not null and b.tipo = 'avaliacao')
                 / nullif(sum(b.peso) filter (where b.nota is not null and b.tipo = 'avaliacao'), 0), 2)
             as media_avaliacoes,
           round(sum(b.nota * b.peso) filter (where b.nota is not null and b.tipo = 'exame')
                 / nullif(sum(b.peso) filter (where b.nota is not null and b.tipo = 'exame'), 0), 2)
             as nota_exame,
           round(sum(b.nota * b.peso) filter (where b.nota is not null)
                 / nullif(sum(b.peso) filter (where b.nota is not null), 0), 2)
             as nota_final
      from (
        select am.id as aluno_id, av.id as avaliacao_id, av.tipo, av.peso, n.nota
          from public.alunos_matriculados am
          join public.turmas t on t.id = am.turma_id
          join public.avaliacoes av on av.curso_id = t.curso_id and av.ativo
          left join public.notas n on n.aluno_id = am.id and n.avaliacao_id = av.id
      ) b
     group by b.aluno_id
  ) r;

comment on view public.notas_resumo_aluno is
  'Média das avaliações, nota do exame, nota final ponderada e estado por aluno.';

-- ---------------------------------------------------------------------------
-- F. RPC: CRIA O CONJUNTO PADRÃO DE AVALIAÇÕES DE UM CURSO
-- ---------------------------------------------------------------------------

create or replace function public.criar_avaliacoes_padrao(p_curso_id uuid)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existentes int;
begin
  if not public.eh_staff() then
    return query select false, 'Sem permissão para definir avaliações.'::text;
    return;
  end if;

  if p_curso_id is null or not exists (select 1 from public.cursos c where c.id = p_curso_id) then
    return query select false, 'Curso inexistente.'::text;
    return;
  end if;

  select count(*) into v_existentes
    from public.avaliacoes av
   where av.curso_id = p_curso_id;

  if v_existentes > 0 then
    return query select false,
      format('Este curso já tem %s itens de avaliação definidos.', v_existentes)::text;
    return;
  end if;

  insert into public.avaliacoes (curso_id, nome, tipo, peso, ordem) values
    (p_curso_id, 'Avaliação 1', 'avaliacao', 1, 1),
    (p_curso_id, 'Avaliação 2', 'avaliacao', 1, 2),
    (p_curso_id, 'Avaliação 3', 'avaliacao', 1, 3),
    (p_curso_id, 'Exame Final',  'exame',     2, 4);

  return query select true,
    'Criadas 3 avaliações (peso 1) e 1 exame final (peso 2).'::text;
end;
$$;

revoke all on function public.criar_avaliacoes_padrao(uuid) from public, anon;
grant execute on function public.criar_avaliacoes_padrao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- G. RLS + GRANTS
-- ---------------------------------------------------------------------------

alter table public.avaliacoes enable row level security;
alter table public.notas      enable row level security;

drop policy if exists "avaliacoes_staff_all" on public.avaliacoes;
create policy "avaliacoes_staff_all"
  on public.avaliacoes for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

drop policy if exists "notas_staff_all" on public.notas;
create policy "notas_staff_all"
  on public.notas for all
  to authenticated
  using (public.eh_staff())
  with check (public.eh_staff());

revoke all on public.avaliacoes from anon;
revoke all on public.notas      from anon;
revoke all on public.notas_resumo_aluno from anon;

grant select, insert, update, delete on public.avaliacoes to authenticated;
grant select, insert, update, delete on public.notas      to authenticated;
grant select on public.notas_resumo_aluno                 to authenticated;

-- ---------------------------------------------------------------------------
-- H. PORTAL DOS FORMADORES: ligação do formador a uma conta de autenticação
-- ---------------------------------------------------------------------------
-- A coluna fica vazia até existirem contas de formador (fase seguinte). O
-- portal, quando for construído, usa `formadores.user_id = auth.uid()` para
-- saber quem está a lançar e `cursos.formador_id` para saber o que pode lançar.

alter table public.formadores add column if not exists user_id uuid;

create unique index if not exists idx_formadores_user
  on public.formadores (user_id) where user_id is not null;

comment on column public.formadores.user_id is
  'Conta de autenticação do formador (portal do formador, fase seguinte).';
