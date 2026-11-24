-- ============================================================================
-- 036 — Inscrições para a edição seguinte + barreiras de segurança
-- ============================================================================
-- Duas coisas ao mesmo tempo, porque partilham as mesmas funções públicas:
--
--  A. INSCRIÇÕES NA EDIÇÃO SEGUINTE
--     O site anuncia a edição que vai começar (ex.: em Nov/2026 anuncia
--     "edição de 2027", que arranca em Janeiro). A inscrição passa a guardar
--     essa edição e a turma dela, e não a edição que está a terminar. Sem
--     turmas criadas para a edição nova, a inscrição fica sem turma (NULL) —
--     a secretaria aloca na matrícula, como sempre.
--
--  B. BARREIRAS ENTRE O SITE PÚBLICO E O SISTEMA CENTRAL
--     1. `anon` perde todos os privilégios directos nas tabelas internas
--        (inscrições, documentos, cobranças, edições, locais) e passa a ler
--        apenas as colunas públicas de cursos, turmas e instituição. Tudo o
--        que o site precisa chega por RPC (`security definer`, validada).
--     2. A política que deixava `anon` inserir linhas em
--        `documentos_inscricao` desaparece: os anexos entram só pelas RPCs
--        `anexar_documento_inscricao` / `anexar_documento_texto`.
--     3. Tecto de documentos por inscrição (4) — um pedido não pode encher a
--        tabela de anexos.
--     4. Limite de submissões por telemóvel (5 em 30 minutos) — trava o
--        enchimento da lista de candidaturas por script.
--     5. `search_path` fixo em `public, pg_temp` nas funções públicas (o
--        `pg_temp` deixa de ficar à frente de `public` na resolução de nomes).
--     6. TRUNCATE/REFERENCES/TRIGGER retirados de `anon` e `authenticated` em
--        todas as tabelas do schema public (TRUNCATE não passa pela RLS).
--
-- Idempotente: re-executar não duplica preços, não reescreve valores
-- existentes nem falha em políticas já ausentes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Edição que aceita inscrições
-- ---------------------------------------------------------------------------
-- A edição mais próxima que ainda não começou; se não houver nenhuma no
-- futuro (base de dados sem edições geradas), a que está a decorrer.
create or replace function public.edicao_inscricoes()
returns table (id uuid, numero integer, inicio date, fim date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    select e.id, e.numero, e.inicio, e.fim
      from public.edicoes e
     where e.inicio > current_date
     order by e.inicio
     limit 1;

  if not found then
    return query
      select e.id, e.numero, e.inicio, e.fim
        from public.edicoes e
       where current_date between e.inicio and e.fim
       order by e.inicio desc
       limit 1;
  end if;
end;
$$;

comment on function public.edicao_inscricoes() is
  'Edição que o site anuncia e para a qual as inscrições entram: a próxima a começar (ou a corrente, se não houver futura).';

revoke all on function public.edicao_inscricoes() from public, authenticated;
grant execute on function public.edicao_inscricoes() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Preçário da edição que aceita inscrições
-- ---------------------------------------------------------------------------
-- Copia o último valor de cada curso (normalmente 200 MT, dia 5) para o ano da
-- edição anunciada. `do nothing`: um preço já definido para esse ano pela
-- secretaria não é reescrito.
insert into public.config_pagamentos (curso_id, ano_lectivo, valor_mensalidade, dia_limite)
select c.id,
       x.ano,
       coalesce(p.valor_mensalidade, 200),
       coalesce(p.dia_limite, 5)
  from public.cursos c
  cross join lateral (
    select extract(year from ei.inicio)::int as ano
      from public.edicao_inscricoes() ei
  ) x
  left join lateral (
    select pp.valor_mensalidade, pp.dia_limite
      from public.config_pagamentos pp
     where pp.curso_id = c.id
     order by pp.ano_lectivo desc
     limit 1
  ) p on true
 where c.ativo
on conflict (curso_id, ano_lectivo) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Catálogo público: edição anunciada, preço dela, sem ids internos
-- ---------------------------------------------------------------------------
-- Sai o `turma_id` (id interno de uma turma não serve para nada no site) e o
-- preço passa a ser o do ano da edição anunciada.
create or replace function public.catalogo_publico()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with aberta as (
    select * from public.edicao_inscricoes()
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
    'edicao',       (select numero from aberta),
    'edicao_ano',   (select extract(year from inicio)::int from aberta),
    'edicao_inicio',(select inicio from aberta),
    'edicao_fim',   (select fim from aberta),
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
                  'id',        c.id,
                  'nome',      c.nome,
                  'codigo',    c.codigo,
                  'duracao',   c.duracao,
                  'descricao', c.descricao,
                  'mensalidade', (
                    select p.valor_mensalidade
                      from public.config_pagamentos p
                     where p.curso_id = c.id
                       and p.ano_lectivo = (select extract(year from inicio)::int from aberta)
                  ),
                  'turnos', coalesce(
                    (select jsonb_agg(
                              jsonb_build_object(
                                'turno', t.turno,
                                'vagas', greatest(t.limite_vagas - t.vagas_preenchidas, 0)
                              )
                              order by case t.turno
                                         when 'manha' then 1
                                         when 'tarde' then 2
                                         else 3
                                       end)
                       from public.turmas t
                      where t.curso_id = c.id
                        and t.edicao_id = (select id from aberta)),
                    '[]'::jsonb
                  )
                )
                order by c.nome)
         from public.cursos c
        where c.ativo),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.catalogo_publico() from public, authenticated;
grant execute on function public.catalogo_publico() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Submissão pública: edição anunciada + limite por telemóvel
-- ---------------------------------------------------------------------------
-- Mesma assinatura da 031 (o painel continua a chamar igual). A diferença é a
-- edição: a anunciada no site, não a que está a decorrer.
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
set search_path = public, pg_temp
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
  v_edicao   uuid;
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

  -- Obrigatórios: nome, telefone e curso/turno.
  if v_nome = ''
     or nullif(btrim(p_telefone_whatsapp), '') is null
     or p_curso_id is null
     or p_turno_pretendido is null then
    return query select null::text, null::uuid;
    return;
  end if;

  -- Barreira anti-abuso: no máximo 5 submissões do mesmo telemóvel em 30
  -- minutos. Um candidato aos 3 cursos usa 3; um script não enche a lista.
  if exists (
    select 1
      from public.inscricoes i
     where regexp_replace(coalesce(i.telefone_whatsapp, ''), '\D', '', 'g') = v_tel
       and i.created_at > now() - interval '30 minutes'
    having count(*) >= 5
  ) then
    raise exception
      'Recebemos vários pedidos deste número. Aguarde 30 minutos ou inscreva-se na secretaria.'
      using errcode = 'check_violation';
  end if;

  -- Limite de 3 cursos activos por aluno — identidade: BI OU nome+celular
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

  -- Edição anunciada no site (a próxima a começar). Sem turma compatível, a
  -- inscrição fica sem turma — nunca se inventa uma turma cheia.
  select ei.id into v_edicao from public.edicao_inscricoes() ei;

  if v_edicao is not null then
    select t.id
      into v_turma
      from public.turmas t
     where t.curso_id = p_curso_id
       and t.turno = p_turno_pretendido
       and t.edicao_id = v_edicao
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
     email, telefone_whatsapp, curso_id, turno_pretendido, turma_id, edicao_id,
     estado, origem)
  values
    (v_numero, btrim(p_nome_completo), v_bi, p_data_nascimento, nullif(btrim(p_genero), ''),
     nullif(btrim(p_email), ''), btrim(p_telefone_whatsapp), p_curso_id, p_turno_pretendido,
     v_turma, v_edicao, 'pendente', v_origem)
  returning id into v_id;

  return query select v_numero, v_id;
end;
$$;

revoke all on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  from public, authenticated;
grant execute on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Anexos: tecto por inscrição + search_path fixo
-- ---------------------------------------------------------------------------
create or replace function public.anexar_documento_inscricao(
  p_inscricao_id   uuid,
  p_tipo_documento public.tipo_documento_enum,
  p_url_ficheiro   text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_url_ficheiro is null
     or length(p_url_ficheiro) > 300
     or p_url_ficheiro !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     or position('..' in p_url_ficheiro) > 0 then
    return null;
  end if;

  if not exists (
    select 1 from public.inscricoes i
     where i.id = p_inscricao_id
       and i.estado in ('pendente', 'com_pendencia', 'em_analise')
  ) then
    return null;
  end if;

  -- Tecto por inscrição: BI + comprovativo (e uma repetição) bastam.
  if (select count(*) from public.documentos_inscricao d where d.inscricao_id = p_inscricao_id) >= 4 then
    return null;
  end if;

  insert into public.documentos_inscricao
    (inscricao_id, tipo_documento, url_ficheiro, estado_validacao)
  values
    (p_inscricao_id, p_tipo_documento, p_url_ficheiro, false)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text)
  from public, authenticated;
grant execute on function public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text)
  to anon, authenticated;

create or replace function public.anexar_documento_texto(
  p_inscricao_id   uuid,
  p_tipo_documento public.tipo_documento_enum,
  p_texto          text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
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

  if (select count(*) from public.documentos_inscricao d where d.inscricao_id = p_inscricao_id) >= 4 then
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
-- 6. `anon` deixa de escrever em tabelas internas
-- ---------------------------------------------------------------------------
-- O site só precisa de LER o catálogo. Tudo o resto passa por RPC. Os GRANTs
-- por omissão do Supabase davam a `anon` INSERT/UPDATE/DELETE/TRUNCATE em
-- várias tabelas: a RLS travava as escritas, mas o privilégio não devia
-- existir. TRUNCATE, em particular, não passa pela RLS.
revoke all on public.inscricoes           from anon;
revoke all on public.documentos_inscricao from anon;
revoke all on public.cobrancas            from anon;
revoke all on public.cobrancas_alunos     from anon;
revoke all on public.edicoes              from anon;
revoke all on public.locais               from anon;
revoke all on public.cursos               from anon;
revoke all on public.turmas               from anon;
revoke all on public.config_instituicao   from anon;
revoke all on public.config_pagamentos    from anon;

-- Leitura pública mínima, coluna a coluna.
grant select (id, nome, referencia, ordem)          on public.locais              to anon;
grant select (id, numero, inicio, fim)              on public.edicoes             to anon;
grant select (id, nome, codigo, duracao, descricao, ativo) on public.cursos       to anon;
grant select (id, curso_id, turno, ano_lectivo, limite_vagas, vagas_preenchidas)
                                                    on public.turmas              to anon;
grant select (id, nome, telefone, email, endereco, logo_url)
                                                    on public.config_instituicao  to anon;

-- Anexos entram apenas pelas RPCs (a política directa desaparece).
drop policy if exists "documentos_anon_insert" on public.documentos_inscricao;

-- Sem TRUNCATE/REFERENCES/TRIGGER para os papéis da API em tabelas do schema.
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon', t.relname);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Higiene das funções públicas mais antigas (004/009/014/032/034)
-- ---------------------------------------------------------------------------
-- As duas consultas públicas continuam abertas (o candidato precisa delas para
-- ver o estado da inscrição e anexar documentos), mas com `pg_temp` no fim do
-- search_path. As funções de trigger e a geração de cobranças deixam de ser
-- executáveis pelo site: só o painel as chama, e as de trigger nem isso.
alter function public.consultar_inscricao_publica(text, text) set search_path = public, pg_temp;
alter function public.localizar_inscricao_para_docs(text, text) set search_path = public, pg_temp;
alter function public.edicao_por_data(date) set search_path = public, pg_temp;

revoke all on function public.definir_edicao_inscricao() from public, anon, authenticated;
revoke all on function public.definir_edicao_turma() from public, anon, authenticated;
-- `execute` nasce concedido a PUBLIC em PostgreSQL: revogar só de `anon` não
-- chega. Tira-se de PUBLIC e concede-se explicitamente ao painel.
revoke all on function public.gerar_cobrancas_pos_conclusao(uuid) from public, anon;
grant execute on function public.gerar_cobrancas_pos_conclusao(uuid) to authenticated;
