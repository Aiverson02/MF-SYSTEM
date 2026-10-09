-- ============================================================================
-- 014 — HARDENING DE SEGURANÇA (auditoria 2026-10-09)
-- ============================================================================
-- Corrige vulnerabilidades encontradas na auditoria:
--
--  [CRÍTICA] 1. Escalação de privilégios: eh_admin()/eh_staff() e as RPCs de
--             gestão liam `user_metadata.papel`, que é EDITÁVEL PELO PRÓPRIO
--             UTILIZADOR via PUT /auth/v1/user (supabase.auth.updateUser).
--             Qualquer conta podia auto-promover-se a admin.
--             → Papel passa a viver APENAS em `app_metadata` (escrita
--               exclusiva do service_role). Papel existente é migrado e
--               removido de user_metadata.
--
--  [ALTA] 2. Grants excessivos: `anon` tinha INSERT/UPDATE/DELETE/TRUNCATE em
--             pagamentos, config_pagamentos, pos_conclusao, formadores e
--             config_instituicao. O RLS bloqueava os dados, mas os grants
--             violam o princípio do menor privilégio (defesa em profundidade).
--             → Revogados; anon mantém só as leituras públicas necessárias.
--
--  [ALTA] 3. `inscricoes_anon_insert ... with check (true)`: qualquer visitante
--             podia inserir inscrições DIRECTAMENTE na tabela com estado
--             'aprovado' (burlando a revisão). O site usa a RPC (definer).
--             → Insert direto de anon revogado; insert staff mantido.
--
--  [MÉDIA] 4. `documentos_anon_insert with check (true)`: anon podia registar
--             documentos já com estado_validacao = true (falsificação).
--             → with check (estado_validacao = false).
--
--  [MÉDIA] 5. Upload de storage sem restrição de caminho/extensão.
--             → docs_upload_anon exige pasta com UUID da inscrição e
--               extensão png/jpg/jpeg/webp/pdf.
--
--  [MÉDIA] 6. Brute-force do código de finanças via RPC (staff comprometido).
--             → Lockout: 5 falhas → 15 min de bloqueio por utilizador.
--
--  [BAIXA] 7. RPCs públicas sem limites de comprimento (abuso de inputs).
--             → Validação de tamanho/formato em todas as RPCs públicas.
--
--  [BAIXA] 8. Passwords staff com mínimo de 6 caracteres → 8.
--
--  [INFO]  9. set_updated_at sem search_path fixo (advisor WARN).
--             Funções trigger/event revogadas de anon (não são chamáveis
--             directamente, mas limpam o catálogo exposto).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PAPEL APENAS EM app_metadata (fecha escalação de privilégios)
-- ---------------------------------------------------------------------------

-- 1.1 Migrar papel existente de user_metadata → app_metadata
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('papel', raw_user_meta_data ->> 'papel'),
       updated_at = now()
 where coalesce(nullif(raw_user_meta_data ->> 'papel', ''), '') in ('admin', 'secretaria')
   and coalesce(nullif(raw_app_meta_data ->> 'papel', ''), '') = '';

-- 1.2 Remover papel de user_metadata (fonte única: app_metadata)
update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'papel',
       updated_at = now()
 where raw_user_meta_data ? 'papel';

-- 1.3 eh_admin(): só app_metadata
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''), '') = 'admin';
$$;

revoke all on function public.eh_admin() from public, anon;
grant execute on function public.eh_admin() to authenticated;

-- 1.4 eh_staff(): só app_metadata (a policy de SELECT público de cursos/turmas
--     continua a avaliar eh_staff() para anon sem executar com os seus
--     privilégios — inalterado desde 001)
create or replace function public.eh_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'papel', ''), '')
         in ('secretaria', 'admin');
$$;

revoke all on function public.eh_staff() from public;
grant execute on function public.eh_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. GRANTS: princípio do menor privilégio para `anon`
-- ---------------------------------------------------------------------------

-- Tabelas financeiras/administrativas: anon perde TUDO
revoke all on public.pagamentos        from anon;
revoke all on public.config_pagamentos from anon;
revoke all on public.pos_conclusao     from anon;
revoke all on public.config_instituicao from anon;
-- formadores: catálogo público → só SELECT
revoke all on public.formadores from anon;

grant select on public.formadores to anon;
grant select on public.config_instituicao to anon; -- nome/contactos no site público

-- ---------------------------------------------------------------------------
-- 3. POLÍTICAS RLS: fechar inserts anónimos directos
-- ---------------------------------------------------------------------------

-- 3.1 inscricoes: sem insert directo de anon (o site usa a RPC definer);
--     staff autenticado continua a poder inserir (futuras inscrições presenciais)
drop policy if exists "inscricoes_anon_insert" on public.inscricoes;
drop policy if exists "inscricoes_insert_staff" on public.inscricoes;
create policy "inscricoes_insert_staff"
  on public.inscricoes for insert
  to authenticated
  with check (public.eh_staff());

-- 3.2 documentos: anon pode anexar, mas NUNCA já validado
drop policy if exists "documentos_anon_insert" on public.documentos_inscricao;
create policy "documentos_anon_insert"
  on public.documentos_inscricao for insert
  to anon, authenticated
  with check (estado_validacao = false);

-- ---------------------------------------------------------------------------
-- 4. STORAGE: uploads anónimos com caminho e extensão controlados
-- ---------------------------------------------------------------------------

drop policy if exists "docs_upload_anon" on storage.objects;
create policy "docs_upload_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'documentos-inscricao'
    and (storage.foldername(name))[1] ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and lower(coalesce(storage.extension(name), '')) in ('png', 'jpg', 'jpeg', 'webp', 'pdf')
  );

-- ---------------------------------------------------------------------------
-- 5. BRUTE-FORCE DO CÓDIGO DE FINANÇAS: lockout por utilizador
-- ---------------------------------------------------------------------------

create table if not exists public.financas_tentativas (
  user_id         uuid primary key,
  falhas          int not null default 0,
  primeira_falha  timestamptz not null default now(),
  bloqueado_ate   timestamptz
);

alter table public.financas_tentativas enable row level security;
alter table public.financas_tentativas force row level security;
-- Sem policies: sem acesso via API. Só pelas RPCs (security definer).
revoke all on public.financas_tentativas from anon, authenticated;

drop function if exists public.verificar_codigo_financas(text);
create function public.verificar_codigo_financas(p_codigo text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid := auth.uid();
  v_hash      text;
  v_bloqueado timestamptz;
begin
  if v_uid is null or not public.eh_staff() then
    return false;
  end if;

  -- Inputs absurdos nem chegam ao bcrypt (protege contra DoS por crypt)
  if p_codigo is null or length(btrim(p_codigo)) = 0 or length(btrim(p_codigo)) > 128 then
    return false;
  end if;

  select t.bloqueado_ate into v_bloqueado
    from public.financas_tentativas t
   where t.user_id = v_uid;

  -- Em lockout: falha calada (não confirma nem infere estado do código)
  if v_bloqueado is not null and v_bloqueado > now() then
    return false;
  end if;

  select f.codigo_hash into v_hash
    from public.financas_seguranca f
   where f.id = 1;

  if v_hash is not null and v_hash <> '' and v_hash = extensions.crypt(btrim(p_codigo), v_hash) then
    delete from public.financas_tentativas where user_id = v_uid;
    return true;
  end if;

  -- Falhou: regista a tentativa (janela de 1 hora)
  if not exists (select 1 from public.financas_tentativas where user_id = v_uid) then
    insert into public.financas_tentativas (user_id, falhas) values (v_uid, 1);
  else
    update public.financas_tentativas t
       set falhas = case when t.primeira_falha < now() - interval '1 hour'
                         then 1 else t.falhas + 1 end,
           primeira_falha = case when t.primeira_falha < now() - interval '1 hour'
                         then now() else t.primeira_falha end,
           bloqueado_ate = null
     where t.user_id = v_uid;
  end if;

  -- 5 falhas → 15 minutos de lockout
  if (select falhas from public.financas_tentativas where user_id = v_uid) >= 5 then
    update public.financas_tentativas
       set bloqueado_ate = now() + interval '15 minutes',
           falhas = 0,
           primeira_falha = now()
     where user_id = v_uid;
  end if;

  return false;
end;
$$;

revoke all on function public.verificar_codigo_financas(text) from public, anon;
grant execute on function public.verificar_codigo_financas(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPCs PÚBLICAS: limites de input (anti-abuso)
-- ---------------------------------------------------------------------------

-- 6.1 submeter_inscricao_publica: comprimentos máximos
drop function if exists public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno);
create function public.submeter_inscricao_publica(
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

  insert into public.inscricoes
    (numero_inscricao, nome_completo, numero_bi, data_nascimento, genero,
     email, telefone_whatsapp, curso_id, turno_pretendido, estado, origem)
  values
    (v_numero, btrim(p_nome_completo), upper(btrim(p_numero_bi)), p_data_nascimento, nullif(btrim(p_genero), ''),
     nullif(btrim(p_email), ''), btrim(p_telefone_whatsapp), p_curso_id, p_turno_pretendido, 'pendente', 'online')
  returning id into v_id;

  return query select v_numero, v_id;
end;
$$;

revoke all on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  from public, authenticated;
grant execute on function public.submeter_inscricao_publica(text, text, date, text, text, text, uuid, public.turno)
  to anon, authenticated;

-- 6.2 anexar_documento_inscricao: formato do caminho do ficheiro
drop function if exists public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text);
create function public.anexar_documento_inscricao(
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
  -- Caminho deve ser relativo, sem traversal nem esquemas (javascript:, data:, http:)
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

  insert into public.documentos_inscricao (inscricao_id, tipo_documento, url_ficheiro, estado_validacao)
  values (p_inscricao_id, p_tipo_documento, p_url_ficheiro, false)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text)
  from public, authenticated;
grant execute on function public.anexar_documento_inscricao(uuid, public.tipo_documento_enum, text)
  to anon, authenticated;

-- 6.3 localizar/consultar: limites de comprimento
drop function if exists public.localizar_inscricao_para_docs(text, text);
create function public.localizar_inscricao_para_docs(
  p_numero_inscricao text,
  p_numero_bi text
)
returns table (inscricao_id uuid, estado text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.estado::text
    from public.inscricoes i
   where length(coalesce(p_numero_inscricao, '')) <= 32
     and length(coalesce(p_numero_bi, '')) <= 32
     and upper(i.numero_inscricao) = upper(btrim(p_numero_inscricao))
     and upper(i.numero_bi) = upper(btrim(p_numero_bi));
$$;

revoke all on function public.localizar_inscricao_para_docs(text, text) from public, authenticated;
grant execute on function public.localizar_inscricao_para_docs(text, text) to anon, authenticated;

drop function if exists public.consultar_inscricao_publica(text, text);
create function public.consultar_inscricao_publica(
  p_numero text,
  p_bi text
)
returns table (
  numero_inscricao text,
  nome_completo text,
  curso text,
  estado text,
  motivo_rejeicao text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.numero_inscricao, i.nome_completo, c.nome, i.estado::text, i.motivo_rejeicao, i.created_at
    from public.inscricoes i
   join public.cursos c on c.id = i.curso_id
   where length(coalesce(p_numero, '')) <= 32
     and length(coalesce(p_bi, '')) <= 32
     and upper(i.numero_inscricao) = upper(btrim(p_numero))
     and i.numero_bi = btrim(p_bi)
   limit 1;
$$;

revoke all on function public.consultar_inscricao_publica(text, text) from public;
grant execute on function public.consultar_inscricao_publica(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. GESTÃO DE STAFF: app_metadata, password mínimo 8, email validado
-- ---------------------------------------------------------------------------

drop function if exists public.criar_utilizador_staff(text, text, text);
create function public.criar_utilizador_staff(p_email text, p_password text, p_papel text)
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

  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email);
  if found then
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
    lower(p_email), crypt(p_password, gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_array_build_text('email'))
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

revoke all on function public.criar_utilizador_staff(text, text, text) from public, anon;
grant execute on function public.criar_utilizador_staff(text, text, text) to authenticated;

drop function if exists public.redefinir_password_staff(uuid, text);
create function public.redefinir_password_staff(p_user_id uuid, p_nova_password text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.eh_admin() then
    return query select false, 'Apenas o admin pode redefinir passwords.'::text;
    return;
  end if;
  if length(coalesce(p_nova_password, '')) < 8 then
    return query select false, 'A password deve ter pelo menos 8 caracteres.'::text;
    return;
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_nova_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, 'Password redefinida com sucesso.'::text;
end;
$$;

revoke all on function public.redefinir_password_staff(uuid, text) from public, anon;
grant execute on function public.redefinir_password_staff(uuid, text) to authenticated;

drop function if exists public.alterar_papel_staff(uuid, text);
create function public.alterar_papel_staff(p_user_id uuid, p_papel text)
returns table (sucesso boolean, mensagem text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.eh_admin() then
    return query select false, 'Apenas o admin pode alterar papéis.'::text;
    return;
  end if;
  if p_papel not in ('secretaria', 'admin') then
    return query select false, 'Papel inválido.'::text;
    return;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('papel', p_papel),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'papel',
         updated_at = now()
   where id = p_user_id;

  if not found then
    return query select false, 'Utilizador não encontrado.'::text;
    return;
  end if;

  return query select true, format('Papel alterado para %s.', p_papel)::text;
end;
$$;

revoke all on function public.alterar_papel_staff(uuid, text) from public, anon;
grant execute on function public.alterar_papel_staff(uuid, text) to authenticated;

-- listar_utilizadores_staff: lê o papel de app_metadata (fonte da verdade)
drop function if exists public.listar_utilizadores_staff();
create function public.listar_utilizadores_staff()
returns table (
  id uuid,
  email text,
  papel text,
  ultimo_login timestamptz,
  criado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         u.email::text,
         coalesce(
           nullif(u.raw_app_meta_data ->> 'papel', ''),
           nullif(u.raw_user_meta_data ->> 'papel', ''),
           'secretaria') as papel,
         u.last_sign_in_at,
         u.created_at
    from auth.users u
   order by u.created_at;
$$;

revoke all on function public.listar_utilizadores_staff() from public, anon;
grant execute on function public.listar_utilizadores_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. HYGIENE: search_path fixo + funções internas fora do catálogo exposto
-- ---------------------------------------------------------------------------

alter function public.set_updated_at() set search_path = public;

revoke all on function public.validar_limite_cursos() from public, anon, authenticated;
revoke all on function public.criar_pos_conclusao()    from public, anon, authenticated;
revoke all on function public.rls_auto_enable()        from public, anon, authenticated;
