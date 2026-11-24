-- ============================================================================
-- 031 — Landing page pública
-- ============================================================================
-- A porta pública da instituição passa a ser uma página em `/` (prospecto +
-- formulário). Para isso o catálogo tem de sair do painel:
--
--  1. Preços e turnos públicos — sem abrir `config_pagamentos` a `anon`, que
--     continua staff-only (013/014/027). O público lê a RPC `catalogo_publico()`.
--  2. A inscrição passa a guardar a TURMA da edição corrente (curso + turno),
--     em vez de ficar só com curso/turno e obrigar a secretaria a alocar tudo.
--  3. O recibo pode chegar escrito ("pago na secretaria"), não só como foto:
--     `documentos_inscricao.texto` + `url_ficheiro` opcional.
--  4. `locais` — as localizações de atendimento passam a ser dados, editáveis em
--     Configurações, e não texto solto no endereço.
--  5. Sementes: duração e descrição dos 14 cursos, mensalidade de 200 MT/dia 5.
--
-- Idempotente: re-executar não duplica locais, cursos, preços nem políticas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket dos documentos de inscrição (privado, 5 MB, imagens + PDF)
-- ---------------------------------------------------------------------------
-- A 014 já criou o bucket e a política de upload anónimo restrita à pasta UUID.
-- Aqui garante-se o limite de tamanho e os tipos permitidos, que até agora
-- dependiam da configuração manual no painel do Supabase.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'documentos-inscricao',
      'documentos-inscricao',
      false,
      5242880,
      array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
    )
    on conflict (id) do update
      set public             = false,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    -- Leitura e eliminação: só a secretaria (os ficheiros são dados pessoais).
    execute 'drop policy if exists "docs_leitura_staff" on storage.objects';
    execute $p$
      create policy "docs_leitura_staff"
        on storage.objects for select
        to authenticated
        using (bucket_id = 'documentos-inscricao' and public.eh_staff())
    $p$;

    execute 'drop policy if exists "docs_eliminar_staff" on storage.objects';
    execute $p$
      create policy "docs_eliminar_staff"
        on storage.objects for delete
        to authenticated
        using (bucket_id = 'documentos-inscricao' and public.eh_staff())
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Inscrição → turma da edição corrente
-- ---------------------------------------------------------------------------
alter table public.inscricoes
  add column if not exists turma_id uuid references public.turmas(id) on delete set null;

create index if not exists idx_inscricoes_turma on public.inscricoes (turma_id);

comment on column public.inscricoes.turma_id is
  'Turma (curso + turno + edição) atribuída na submissão pública. NULL = a secretaria aloca na matrícula.';

-- ---------------------------------------------------------------------------
-- 3. Documentos: recibo em texto, ficheiro opcional
-- ---------------------------------------------------------------------------
alter table public.documentos_inscricao
  add column if not exists texto text;

alter table public.documentos_inscricao
  alter column url_ficheiro drop not null;

comment on column public.documentos_inscricao.texto is
  'Recibo escrito pelo candidato (ex.: "paguei por M-Pesa, ref. 1234"). Mutuamente exclusivo com url_ficheiro.';

-- Um documento tem ficheiro OU texto — nunca os dois, nunca nenhum.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'documentos_inscricao_conteudo_check'
       and conrelid = 'public.documentos_inscricao'::regclass
  ) then
    alter table public.documentos_inscricao
      add constraint documentos_inscricao_conteudo_check
      check (
        (url_ficheiro is not null and texto is null)
        or (texto is not null and url_ficheiro is null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Locais de atendimento
-- ---------------------------------------------------------------------------
create table if not exists public.locais (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  referencia text,
  ordem      integer not null default 0,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.locais is
  'Localizações de atendimento mostradas no site público (Configurações → Locais).';

alter table public.locais enable row level security;

drop policy if exists "locais_leitura_publica" on public.locais;
create policy "locais_leitura_publica"
  on public.locais for select
  to anon, authenticated
  using (ativo);

drop policy if exists "locais_leitura_staff" on public.locais;
create policy "locais_leitura_staff"
  on public.locais for select
  to authenticated
  using (public.eh_staff());

drop policy if exists "locais_escrita_admin" on public.locais;
create policy "locais_escrita_admin"
  on public.locais for all
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

grant select on public.locais to anon, authenticated;
grant select, insert, update, delete on public.locais to authenticated;

drop trigger if exists trg_set_updated_at on public.locais;
create trigger trg_set_updated_at before update on public.locais
  for each row execute function public.set_updated_at();

create index if not exists idx_locais_ordem on public.locais (ordem, nome);

-- As duas localizações indicadas pela instituição (idempotente por nome).
insert into public.locais (nome, referencia, ordem)
select v.nome, v.referencia, v.ordem
  from (values
          ('Malhazine',   'Paragem Fim do Murro', 1),
          ('João Mateus', null,                   2)
       ) as v(nome, referencia, ordem)
 where not exists (select 1 from public.locais l where l.nome = v.nome);

-- ---------------------------------------------------------------------------
-- 5. Catálogo público (instituição, edição, locais, cursos com preço e turnos)
-- ---------------------------------------------------------------------------
-- Uma só chamada: a página não faz 4 pedidos nem precisa de acesso directo a
-- tabelas administrativas. `config_pagamentos` continua fechado a `anon`.
create or replace function public.catalogo_publico()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with edicao as (
    select coalesce(max(t.ano_lectivo), extract(year from now())::int) as ano
      from public.turmas t
  )
  select jsonb_build_object(
    'instituicao', coalesce(
      (select jsonb_build_object(
                'nome',     coalesce(nullif(btrim(ci.nome), ''), 'Associação de Formação Profissional Moz Future'),
                'telefone', ci.telefone,
                'email',    ci.email,
                'endereco', ci.endereco,
                'logo_url', ci.logo_url)
         from public.config_instituicao ci
        where ci.id = 1),
      jsonb_build_object('nome', 'Associação de Formação Profissional Moz Future')
    ),
    'edicao', (select ano from edicao),
    'locais', coalesce(
      (select jsonb_agg(
                jsonb_build_object('id', l.id, 'nome', l.nome, 'referencia', l.referencia)
                order by l.ordem, l.nome)
         from public.locais l
        where l.ativo),
      '[]'::jsonb
    ),
    'cursos', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id',         c.id,
                  'nome',       c.nome,
                  'codigo',     c.codigo,
                  'duracao',    c.duracao,
                  'descricao',  c.descricao,
                  'mensalidade', (
                    select p.valor_mensalidade
                      from public.config_pagamentos p
                     where p.curso_id = c.id
                       and p.ano_lectivo = e.ano
                  ),
                  'turnos', coalesce(
                    (select jsonb_agg(
                              jsonb_build_object(
                                'turno',    t.turno,
                                'turma_id', t.id,
                                'vagas',    greatest(t.limite_vagas - t.vagas_preenchidas, 0)
                              )
                              order by case t.turno
                                         when 'manha' then 1
                                         when 'tarde' then 2
                                         else 3
                                       end)
                       from public.turmas t
                      where t.curso_id = c.id
                        and t.ano_lectivo = e.ano),
                    '[]'::jsonb
                  )
                )
                order by c.nome)
         from public.cursos c
         cross join edicao e
        where c.ativo),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.catalogo_publico() from public, authenticated;
grant execute on function public.catalogo_publico() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Submissão pública: grava também a turma da edição corrente
-- ---------------------------------------------------------------------------
-- Mesma assinatura da 024 (o painel e a importação continuam a chamá-la igual).
-- A turma é a da edição corrente (maior ano lectivo) para o curso+turno, com
-- vagas. Sem turma compatível, fica NULL e a secretaria aloca na matrícula —
-- nunca se inventa uma turma cheia.
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
  v_edicao   integer;
  v_turma    uuid;
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
              and v_nome <> ''
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

  -- Turma da edição corrente (maior ano lectivo) para o curso+turno pedidos,
  -- preferindo uma com vagas. Sem candidata, a inscrição fica sem turma.
  select max(t.ano_lectivo) into v_edicao from public.turmas t;

  if v_edicao is not null then
    select t.id
      into v_turma
      from public.turmas t
     where t.curso_id = p_curso_id
       and t.turno = p_turno_pretendido
       and t.ano_lectivo = v_edicao
     order by (t.vagas_preenchidas < t.limite_vagas) desc, t.nome_turma
     limit 1;
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
     email, telefone_whatsapp, curso_id, turno_pretendido, turma_id, estado, origem)
  values
    (v_numero, btrim(p_nome_completo), v_bi, p_data_nascimento, nullif(btrim(p_genero), ''),
     nullif(btrim(p_email), ''), btrim(p_telefone_whatsapp), p_curso_id, p_turno_pretendido,
     v_turma, 'pendente', v_origem)
  returning id into v_id;

  return query select v_numero, v_id;
end;
$$;

revoke all on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  from public, authenticated;
grant execute on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Anexar recibo escrito
-- ---------------------------------------------------------------------------
create or replace function public.anexar_documento_texto(
  p_inscricao_id   uuid,
  p_tipo_documento public.tipo_documento_enum,
  p_texto          text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_texto text := btrim(coalesce(p_texto, ''));
begin
  -- 1000 caracteres chegam para "paguei 200 MT por M-Pesa, referência …";
  -- acima disso é abuso, não informação.
  if v_texto = '' or length(v_texto) > 1000 then
    return null;
  end if;

  if not exists (
    select 1 from public.inscricoes i
     where i.id = p_inscricao_id
       and i.estado in ('pendente', 'com_pendencia', 'em_analise')
  ) then
    return null;
  end if;

  insert into public.documentos_inscricao
    (inscricao_id, tipo_documento, url_ficheiro, texto, estado_validacao)
  values
    (p_inscricao_id, p_tipo_documento, null, v_texto, false)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.anexar_documento_texto(uuid, public.tipo_documento_enum, text)
  from public, authenticated;
grant execute on function public.anexar_documento_texto(uuid, public.tipo_documento_enum, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Sementes do site: duração, descrições e mensalidade
-- ---------------------------------------------------------------------------
update public.cursos
   set duracao = '3 meses'
 where ativo
   and (duracao is null or btrim(duracao) = '');

update public.cursos c
   set descricao = v.descricao
  from (values
    ('ATC-CC',   'Balcão, caixa, cobranças e como resolver reclamações sem perder o cliente.'),
    ('BEL-EST',  'Cuidados de rosto, corpo e unhas, com prática em sala.'),
    ('CON-G',    'Lançamentos, conciliação bancária e contas de um pequeno negócio.'),
    ('CUL-DSB',  'Pastelaria e cozinha: doces, salgados e bolos para vender ou servir.'),
    ('EDU-INF',  'Como cuidar e acompanhar crianças em creche e jardim de infância.'),
    ('ELET-INS', 'Instalação eléctrica doméstica: quadros, tomadas, avarias e segurança.'),
    ('GRH',      'Recrutar, contratar, controlar assiduidade e organizar pessoal.'),
    ('MEST-CER', 'Conduzir cerimónias, protocolo e falar em público com segurança.'),
    ('ING',      'Inglês para atender, trabalhar e continuar a estudar.'),
    ('JORNAL',   'Reportagem, entrevista, redacção e produção de notícias.'),
    ('SEC-EX',   'Agenda, correspondência, arquivo e apoio directo à direcção.'),
    ('NOC-RP',   'Imagem da instituição, comunicação com o público e eventos.'),
    ('DES-VE',   'Peças gráficas e edição de vídeo para redes sociais e empresas.'),
    ('IMP-EXP',  'Documentos, custos e logística de compra e venda internacional.')
  ) as v(codigo, descricao)
 where c.codigo = v.codigo
   and (c.descricao is null or btrim(c.descricao) = '');

-- Mensalidade de 200 MT, dia 5, para todos os cursos activos no ano corrente.
-- `do nothing`: um preçário já definido pela secretaria não é reescrito.
insert into public.config_pagamentos (curso_id, ano_lectivo, valor_mensalidade, dia_limite)
select c.id, extract(year from now())::int, 200, 5
  from public.cursos c
 where c.ativo
on conflict (curso_id, ano_lectivo) do nothing;
